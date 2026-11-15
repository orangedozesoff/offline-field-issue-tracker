// Local report operations (everything the UI does to reports). Each change is one atomic
// store.commit: the report, its outbox entry and its history event are saved together.

import { validateReportFields } from '../lib/fieldValidation.js';

const EDITABLE = ['description', 'location_text', 'latitude', 'longitude', 'priority'];
const DAY_MS = 24 * 60 * 60 * 1000;
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function createLocalReports({ store, now = () => Date.now(), uuid = () => crypto.randomUUID(), onChange = () => {} }) {
  const iso = () => new Date(now()).toISOString();

  const makeDraft = (f) => ({
    id: uuid(),
    category: f.category ?? '', description: f.description ?? '', location_text: f.location_text ?? '',
    latitude: f.latitude ?? null, longitude: f.longitude ?? null, priority: f.priority ?? 'Medium',
    reporter_name: f.reporter_name ?? '',
    status: 'Draft', assigned_to: null, resolution_note: null,
    reported_at: iso(), received_at: null, updated_at: iso(),
    version: 0, expected_version: 0, sync_state: null, attempts: 0, next_retry_at: 0, last_error: null,
  });

  const makeEvent = (reportId, opId, type, message) => ({
    id: uuid(), report_id: reportId, op_id: opId, type, message, occurred_at: iso(), uploaded: false,
  });

  async function nextSeq() {
    const ops = await store.listOutbox();
    return ops.length ? Math.max(...ops.map((o) => o.seq)) + 1 : 1;
  }

  const done = async (result) => {
    onChange();
    return result;
  };

  return {
    async createDraft(fields) {
      const draft = makeDraft(fields);
      await store.commit({ reports: [draft] });
      return done(draft);
    },

    async updateDraft(id, fields) {
      const r = await store.getReport(id);
      if (!r) return { ok: false, error: 'NOT_FOUND' };
      if (r.status !== 'Draft') return { ok: false, error: 'NOT_A_DRAFT' };
      const next = { ...r, updated_at: iso() };
      for (const k of ['category', 'description', 'location_text', 'latitude', 'longitude', 'priority', 'reporter_name']) {
        if (k in fields) next[k] = fields[k];
      }
      await store.commit({ reports: [next] });
      return done({ ok: true, report: next });
    },

    async deleteDraft(id) {
      const r = await store.getReport(id);
      if (!r || r.status !== 'Draft') return { ok: false, error: 'NOT_A_DRAFT' };
      await store.commit({ deleteReports: [id] });
      return done({ ok: true });
    },

    // Same category, location and description reported in the last 24 hours.
    async findPossibleDuplicate(fields, excludeId = null) {
      const key = [norm(fields.category), norm(fields.location_text), norm(fields.description)].join('|');
      const hit = (await store.listReports()).find((r) =>
        r.id !== excludeId && now() - Date.parse(r.reported_at) <= DAY_MS &&
        [norm(r.category), norm(r.location_text), norm(r.description)].join('|') === key);
      return hit || null;
    },

    async submitDraft(id) {
      const r = await store.getReport(id);
      if (!r) return { ok: false, error: 'NOT_FOUND' };
      if (r.status !== 'Draft') return { ok: false, error: 'NOT_A_DRAFT' };
      const v = validateReportFields(r, now());
      if (!v.ok) return { ok: false, error: 'VALIDATION', fields: v.fields };
      const op = { op_id: uuid(), report_id: id, type: 'create', payload: v.value, seq: await nextSeq(), lease_until: 0 };
      const event = makeEvent(id, op.op_id, 'created', null);
      const report = {
        ...r, ...v.value, status: 'Submitted', sync_state: 'Pending', version: 0, expected_version: 1,
        attempts: 0, next_retry_at: 0, last_error: null, updated_at: iso(),
      };
      await store.commit({ reports: [report], ops: [op], events: [event] });
      return done({ ok: true, report });
    },

    // Edit a submitted report. Allowed only while its status is Submitted.
    async editSubmitted(id, changes) {
      const r = await store.getReport(id);
      if (!r) return { ok: false, error: 'NOT_FOUND' };
      if (r.status !== 'Submitted') return { ok: false, error: 'LOCKED', message: `This report is ${r.status} and can no longer be edited.` };

      const keys = EDITABLE.filter((k) => k in changes && changes[k] !== r[k]);
      if (!keys.length) return { ok: false, error: 'NO_CHANGES' };
      const merged = { ...r };
      for (const k of keys) merged[k] = changes[k];
      const v = validateReportFields(merged, now());
      if (!v.ok) return { ok: false, error: 'VALIDATION', fields: v.fields };
      const clean = {};
      for (const k of keys) clean[k] = v.value[k];
      if (keys.includes('latitude') || keys.includes('longitude')) {
        clean.latitude = v.value.latitude;
        clean.longitude = v.value.longitude;
      }

      const ops = (await store.listOutbox()).filter((o) => o.report_id === id);
      if (r.sync_state === 'Failed') {
        const head = ops[0];
        if (!head || head.type !== 'create') return { ok: false, error: 'RESOLVE_FIRST' };
        // Fixing a create the server refused: correct the queued payload and try again.
        const fixed = { ...head, payload: { ...head.payload, ...clean }, lease_until: 0 };
        const report = { ...r, ...clean, sync_state: 'Pending', attempts: 0, next_retry_at: 0, last_error: null, updated_at: iso() };
        await store.commit({ reports: [report], ops: [fixed] });
        return done({ ok: true, report });
      }

      const op = {
        op_id: uuid(), report_id: id, type: 'edit',
        payload: { base_version: r.expected_version, changes: clean }, seq: await nextSeq(), lease_until: 0,
      };
      const event = makeEvent(id, op.op_id, 'edited', `Changed: ${Object.keys(clean).join(', ')}`);
      const report = {
        ...r, ...clean, expected_version: r.expected_version + 1, sync_state: 'Pending', updated_at: iso(),
      };
      await store.commit({ reports: [report], ops: [op], events: [event] });
      return done({ ok: true, report });
    },

    // "Retry" for a report that gave up after server errors.
    async retryFailed(id) {
      const r = await store.getReport(id);
      if (!r || r.sync_state !== 'Failed') return { ok: false, error: 'NOT_FAILED' };
      await store.commit({ reports: [{ ...r, sync_state: 'Pending', attempts: 0, next_retry_at: 0, last_error: null }] });
      return done({ ok: true });
    },

    // A queued edit the server refused (locked or stale). Keep nothing silently:
    // 'discard' restores the server copy; 'copy' also saves the user's text as a new draft.
    async resolveConflict(id, choice) {
      const r = await store.getReport(id);
      if (!r) return { ok: false, error: 'NOT_FOUND' };
      if (r.sync_state !== 'Failed') return { ok: false, error: 'NOT_FAILED' };
      if (!['discard', 'copy'].includes(choice)) return { ok: false, error: 'BAD_CHOICE' };
      const ops = (await store.listOutbox()).filter((o) => o.report_id === id);
      if (!ops[0] || ops[0].type !== 'edit') return { ok: false, error: 'NOT_A_CONFLICT' };
      const server = r.last_error?.current;
      if (!server) return { ok: false, error: 'NO_SERVER_COPY' };

      const drop = new Set(ops.map((o) => o.op_id));
      const pending = (await store.listUnuploadedEvents()).filter((e) => e.type === 'edited' && drop.has(e.op_id));
      const restored = {
        ...r, ...server, expected_version: server.version, sync_state: 'Synchronized',
        attempts: 0, next_retry_at: 0, last_error: null,
      };
      const reports = [restored];
      let draft = null;
      if (choice === 'copy') {
        draft = makeDraft(r);
        reports.push(draft);
      }
      await store.commit({
        reports,
        deleteOps: [...drop],
        events: pending.map((e) => ({ ...e, uploaded: true })), // never sent: the change did not happen
      });
      return done({ ok: true, report: restored, draft });
    },
  };
}
