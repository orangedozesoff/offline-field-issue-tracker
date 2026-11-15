// IndexedDB store: same interface as the memory store. Reports, outbox and events live in
// one database, and commit() writes across all three in ONE transaction (all or nothing).

import { openDB } from 'idb';

export async function openIdbStore({ name = 'field-tracker' } = {}) {
  const db = await openDB(name, 1, {
    upgrade(d) {
      d.createObjectStore('reports', { keyPath: 'id' });
      d.createObjectStore('outbox', { keyPath: 'op_id' });
      const events = d.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('report_id', 'report_id');
    },
  });
  const byTime = (a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : 1);

  return {
    async getReport(id) {
      return (await db.get('reports', id)) ?? null;
    },
    async listReports() {
      return db.getAll('reports');
    },
    async listOutbox() {
      return (await db.getAll('outbox')).sort((a, b) => a.seq - b.seq);
    },
    async listEvents(reportId) {
      return (await db.getAllFromIndex('events', 'report_id', reportId)).sort(byTime);
    },
    async listUnuploadedEvents() {
      return (await db.getAll('events')).filter((e) => !e.uploaded).sort(byTime);
    },
    async commit({ reports = [], ops = [], deleteOps = [], deleteReports = [], events = [] } = {}) {
      const tx = db.transaction(['reports', 'outbox', 'events'], 'readwrite');
      const requests = []; // idb returns a promise per request; keep them so none goes unhandled
      try {
        for (const x of reports) requests.push(tx.objectStore('reports').put(x));
        for (const x of ops) requests.push(tx.objectStore('outbox').put(x));
        for (const x of events) requests.push(tx.objectStore('events').put(x));
        for (const id of deleteOps) requests.push(tx.objectStore('outbox').delete(id));
        for (const id of deleteReports) requests.push(tx.objectStore('reports').delete(id));
      } catch (err) {
        // A value that cannot be stored: abort so nothing from this commit is kept. The requests
        // already queued reject with AbortError, which is expected, so it is swallowed here.
        for (const r of requests) r.catch(() => {});
        try { tx.abort(); } catch (_) { /* already finished */ }
        await tx.done.catch(() => {});
        throw err;
      }
      await Promise.all([...requests, tx.done]);
    },
    close() {
      db.close();
    },
  };
}

// Ask the browser not to clear our data under storage pressure (best effort).
export async function requestPersistentStorage() {
  try {
    if (globalThis.navigator?.storage?.persist) return await globalThis.navigator.storage.persist();
  } catch (_) {
    /* ignore */
  }
  return false;
}
