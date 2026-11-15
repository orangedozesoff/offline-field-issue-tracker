// In-memory store with the same interface as the IndexedDB store. Used by tests.
// Values are cloned on the way in and out, so it behaves like real persistence.

export function createMemoryStore() {
  const reports = new Map();
  const ops = new Map();
  const events = new Map();
  const clone = (x) => (x === undefined ? undefined : structuredClone(x));
  const byTime = (a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : 1);

  return {
    async getReport(id) {
      return clone(reports.get(id)) ?? null;
    },
    async listReports() {
      return [...reports.values()].map(clone);
    },
    async listOutbox() {
      return [...ops.values()].map(clone).sort((a, b) => a.seq - b.seq);
    },
    async listEvents(reportId) {
      return [...events.values()].filter((e) => e.report_id === reportId).map(clone).sort(byTime);
    },
    async listUnuploadedEvents() {
      return [...events.values()].filter((e) => !e.uploaded).map(clone).sort(byTime);
    },
    // One atomic write (the IndexedDB store uses a single transaction across stores).
    // Everything is cloned first, so a value that cannot be stored aborts the whole commit.
    async commit({ reports: r = [], ops: o = [], deleteOps = [], deleteReports = [], events: e = [] } = {}) {
      const cr = r.map(clone);
      const co = o.map(clone);
      const ce = e.map(clone);
      for (const x of cr) reports.set(x.id, x);
      for (const x of co) ops.set(x.op_id, x);
      for (const x of ce) events.set(x.id, x);
      for (const id of deleteOps) ops.delete(id);
      for (const id of deleteReports) reports.delete(id);
    },
  };
}
