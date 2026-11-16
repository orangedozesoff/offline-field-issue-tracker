// Application layer the UI talks to: wires store + engine + local operations + scheduler,
// and adds the server-facing reads (refresh, timeline) and coordinator status changes.
// Framework-free, so it is tested without React.

import { createLocalReports } from './reports.js';
import { createSyncEngine } from './engine.js';
import { startAutoSync } from './autoSync.js';

const byTimeThenId = (a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : 1);
const SYNC_RESET = { attempts: 0, next_retry_at: 0, last_error: null };

export function createAppState({ store, api, now, uuid, syncIntervalMs = 30000, env }) {
  const listeners = new Set();
  const notify = () => { for (const fn of [...listeners]) fn(); };
  let scheduler = null;

  // Any local change tells the UI and asks the scheduler for an immediate sync attempt.
  const reports = createLocalReports({ store, now, uuid, onChange: () => { notify(); scheduler?.trigger(); } });
  const engine = createSyncEngine({ store, api, now, uuid, onChange: notify });

  const fromServer = (s) => ({ ...s, expected_version: s.version, sync_state: 'Synchronized', ...SYNC_RESET });

  return {
    store, reports, engine,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    start() {
      if (!scheduler) scheduler = startAutoSync({ engine, intervalMs: syncIntervalMs, env });
    },
    stop() {
      scheduler?.stop();
      scheduler = null;
    },
    syncNow: () => (scheduler ? scheduler.trigger({ force: true }) : engine.syncOnce({ force: true })),

    async snapshot() {
      const all = await store.listReports();
      all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
      const counts = { drafts: 0, pending: 0, synchronized: 0, failed: 0 };
      for (const r of all) {
        if (r.status === 'Draft') counts.drafts++;
        else if (r.sync_state === 'Failed') counts.failed++;
        else if (r.sync_state === 'Pending') counts.pending++;
        else counts.synchronized++;
      }
      return { reports: all, counts };
    },

    // Pull the server's view (statuses set by coordinators, reports from other devices).
    // Never overwrites a report that has unsent changes or is Failed.
    async refreshFromServer(identity) {
      let res;
      try {
        res = await api.listReports({}, identity);
      } catch (_) {
        return { ok: false, offline: true };
      }
      if (res.status !== 200 || !Array.isArray(res.body)) return { ok: false, status: res.status };
      const busy = new Set((await store.listOutbox()).map((o) => o.report_id));
      const writes = [];
      for (const s of res.body) {
        const local = await store.getReport(s.id);
        if (!local) writes.push(fromServer(s));
        else if (!busy.has(s.id) && local.sync_state !== 'Failed' && s.version >= local.version) writes.push({ ...local, ...fromServer(s) });
      }
      if (writes.length) await store.commit({ reports: writes });
      notify();
      return { ok: true, updated: writes.length };
    },

    // Coordinator workflow change. Online only: the server is the authority.
    async changeStatus(id, body, identity) {
      let res;
      try {
        res = await api.changeStatus(id, body, identity);
      } catch (_) {
        return { ok: false, offline: true };
      }
      if (res.status !== 200) return { ok: false, status: res.status, error: res.body };
      const busy = (await store.listOutbox()).some((o) => o.report_id === id);
      if (!busy) {
        const local = await store.getReport(id);
        await store.commit({ reports: [local ? { ...local, ...fromServer(res.body) } : fromServer(res.body)] });
      }
      notify();
      return { ok: true, report: res.body };
    },

    // History for one report: server events merged with events still only on this device.
    async timeline(id, identity) {
      const local = await store.listEvents(id);
      let remote = [];
      let offline = false;
      try {
        const res = await api.listEvents(id, identity);
        if (res.status === 200 && Array.isArray(res.body)) remote = res.body;
      } catch (_) {
        offline = true;
      }
      const seen = new Set();
      const events = [];
      for (const e of remote) {
        seen.add(e.id);
        events.push({ id: e.id, type: e.type, message: e.message ?? null, actor: e.actor ?? null,
          from_status: e.from_status ?? null, to_status: e.to_status ?? null, occurred_at: new Date(e.occurred_at).toISOString(), pendingUpload: false });
      }
      for (const e of local) {
        if (seen.has(e.id)) continue;
        events.push({ id: e.id, type: e.type, message: e.message ?? null, actor: null,
          from_status: null, to_status: null, occurred_at: e.occurred_at, pendingUpload: !e.uploaded });
      }
      events.sort(byTimeThenId);
      return { events, offline };
    },
  };
}
