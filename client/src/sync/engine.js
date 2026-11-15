// Sync engine: delivers the outbox to the server safely.
// Rules: nothing leaves the outbox until the server confirms it; creates are idempotent
// (client UUID); ops for one report go in order; a rejected report becomes Failed and is
// never deleted; being offline never turns a report into Failed.

import { backoffMs } from './backoff.js';

const DEFAULTS = { maxAttempts: 8, leaseMs: 60000, batchLimit: 50 };
const CONTENT = ['category', 'description', 'location_text', 'latitude', 'longitude', 'priority', 'reporter_name', 'reported_at'];

export function createSyncEngine({
  store, api, now = () => Date.now(), random = Math.random, uuid = () => crypto.randomUUID(),
  onChange = () => {}, config = {},
}) {
  const cfg = { ...DEFAULTS, ...config };
  let running = false;

  const iso = () => new Date(now()).toISOString();
  // Offline outbox ops always act as the field worker who wrote the report.
  const identityFor = (report) => ({ role: 'field_worker', actor: report.reporter_name });
  const wire = (e) => ({ id: e.id, type: e.type, message: e.message ?? null, occurred_at: e.occurred_at });
  const makeEvent = (reportId, opId, type, message) => ({
    id: uuid(), report_id: reportId, op_id: opId, type, message, occurred_at: iso(), uploaded: false,
  });

  function classify(outcome) {
    if (outcome.error) return { kind: 'network', code: 'NETWORK', message: 'Cannot reach the server' };
    const { status, body } = outcome.res;
    if (status === 200 || status === 201) return { kind: 'ok' };
    if (status >= 500 || status === 429 || status === 408) {
      return { kind: 'server', code: `HTTP_${status}`, message: body?.error || `Server error (${status})` };
    }
    return {
      kind: 'permanent', code: body?.code || `HTTP_${status}`, message: body?.error || `Request failed (${status})`,
      fields: body?.fields, current: body?.current,
    };
  }

  async function onSuccess(op, report, serverReport, sentEvents) {
    const remaining = (await store.listOutbox()).filter((o) => o.report_id === report.id && o.op_id !== op.op_id);
    const merged = {
      ...report,
      status: serverReport.status,
      assigned_to: serverReport.assigned_to,
      resolution_note: serverReport.resolution_note,
      received_at: serverReport.received_at,
      updated_at: serverReport.updated_at,
      version: serverReport.version,
      attempts: 0,
      next_retry_at: 0,
      last_error: null,
    };
    if (remaining.length === 0) {
      for (const k of CONTENT) merged[k] = serverReport[k];
      merged.sync_state = 'Synchronized';
      merged.expected_version = serverReport.version;
    } else {
      merged.sync_state = 'Pending'; // later queued changes keep their local content
    }
    const synced = makeEvent(report.id, op.op_id, 'synced',
      op.type === 'create' ? 'Report accepted by the server' : 'Change accepted by the server');
    await store.commit({
      reports: [merged],
      deleteOps: [op.op_id],
      events: [...sentEvents.map((e) => ({ ...e, uploaded: true })), synced],
    });
    return 'succeeded';
  }

  async function onFailure(op, report, c) {
    const events = [];
    const updated = { ...report, last_error: { code: c.code, message: c.message } };
    const released = { ...op, lease_until: 0 };

    if (c.kind === 'permanent') {
      updated.sync_state = 'Failed';
      updated.last_error = { code: c.code, message: c.message, fields: c.fields, current: c.current };
      const detail = c.fields ? ` (${Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`).join('; ')})` : '';
      events.push(makeEvent(report.id, op.op_id, 'sync_failed', `Rejected by the server: ${c.message}${detail}`));
    } else {
      updated.attempts = report.attempts + 1;
      updated.next_retry_at = now() + backoffMs(updated.attempts, random);
      const gaveUp = c.kind === 'server' && updated.attempts >= cfg.maxAttempts;
      if (gaveUp) {
        updated.sync_state = 'Failed';
        events.push(makeEvent(report.id, op.op_id, 'sync_failed', `Gave up after ${updated.attempts} attempts: ${c.message}`));
      } else if (report.last_error?.code !== c.code || updated.attempts === 1) {
        events.push(makeEvent(report.id, op.op_id, 'sync_failed', `${c.message}; will retry automatically`)); // once per streak
      }
    }
    await store.commit({ reports: [updated], ops: [released], events });
    return c.kind === 'permanent' || updated.sync_state === 'Failed' ? 'failed' : 'retrying';
  }

  async function sendOne(op, report) {
    await store.commit({ ops: [{ ...op, lease_until: now() + cfg.leaseMs }] }); // lease: crash recovery
    const mine = (await store.listUnuploadedEvents()).filter((e) => e.op_id === op.op_id).slice(0, cfg.batchLimit);
    const events = mine.map(wire);
    let outcome;
    try {
      const who = identityFor(report);
      const res = op.type === 'create'
        ? await api.createReport({ id: report.id, ...op.payload, events }, who)
        : await api.editReport(report.id, { base_version: op.payload.base_version, ...op.payload.changes, events }, who);
      outcome = { res };
    } catch (error) {
      outcome = { error };
    }
    const c = classify(outcome);
    return c.kind === 'ok' ? onSuccess(op, report, outcome.res.body, mine) : onFailure(op, report, c);
  }

  // Uploads events that are not riding on an operation (e.g. 'synced' after the last op).
  async function flushEvents() {
    const unuploaded = await store.listUnuploadedEvents();
    if (!unuploaded.length) return 0;
    const ops = await store.listOutbox();
    const pendingOps = new Set(ops.map((o) => o.op_id));
    const notOnServer = new Set(ops.filter((o) => o.type === 'create').map((o) => o.report_id));
    const byReport = new Map();
    for (const e of unuploaded) {
      if (notOnServer.has(e.report_id)) continue;
      if (e.type !== 'sync_failed' && e.op_id && pendingOps.has(e.op_id)) continue; // travels with its op
      if (!byReport.has(e.report_id)) byReport.set(e.report_id, []);
      byReport.get(e.report_id).push(e);
    }
    let flushed = 0;
    for (const [reportId, list] of byReport) {
      const report = await store.getReport(reportId);
      if (!report || report.status === 'Draft') continue;
      const batch = list.slice(0, cfg.batchLimit);
      try {
        const res = await api.postEvents(reportId, batch.map(wire), identityFor(report));
        if (res.status === 200 || res.status === 201) {
          await store.commit({ events: batch.map((e) => ({ ...e, uploaded: true })) });
          flushed += batch.length;
        }
      } catch (_) {
        /* stays local; tried again next cycle */
      }
    }
    return flushed;
  }

  async function syncOnce() {
    if (running) return { skipped: true };
    running = true;
    const summary = { succeeded: 0, failed: 0, retrying: 0, waiting: 0, flushed: 0 };
    try {
      const blocked = new Set();
      for (const op of await store.listOutbox()) {
        if (blocked.has(op.report_id)) {
          summary.waiting++;
          continue;
        }
        const report = await store.getReport(op.report_id);
        if (!report) {
          await store.commit({ deleteOps: [op.op_id] }); // orphan op
          continue;
        }
        if (report.sync_state === 'Failed' || report.next_retry_at > now() || op.lease_until > now()) {
          blocked.add(op.report_id);
          summary.waiting++;
          continue;
        }
        const outcome = await sendOne(op, report);
        summary[outcome]++;
        if (outcome !== 'succeeded') blocked.add(op.report_id);
      }
      summary.flushed = await flushEvents();
      return summary;
    } finally {
      running = false;
      onChange();
    }
  }

  return { syncOnce, isRunning: () => running };
}
