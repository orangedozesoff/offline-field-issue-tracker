// Test helpers: a fake server that behaves like the real API contract, a controllable
// clock, and one-call setup. Failure injection: server.plan.push(instruction) where an
// instruction is 'network' (nothing applied, request throws), 'lost' (applied, but the
// response is lost), a status number (e.g. 500), or { status, body } returned as is.

import { createMemoryStore } from '../storage/memoryStore.js';
import { createLocalReports } from './reports.js';
import { createSyncEngine } from './engine.js';

export const FIELDS = {
  category: 'Water point', description: 'Pump handle is broken', location_text: 'Kebele 04 well',
  priority: 'High', reporter_name: 'Selam',
};

const CONTENT = ['category', 'description', 'location_text', 'latitude', 'longitude', 'priority', 'reporter_name', 'reported_at'];

export function makeServer() {
  const reports = new Map();
  const events = new Map();
  const calls = [];
  const plan = [];

  const addEvents = (reportId, list = []) => {
    for (const e of list) if (!events.has(e.id)) events.set(e.id, { ...e, report_id: reportId });
  };
  function handle(name, apply) {
    calls.push(name);
    const instr = plan.shift();
    if (instr === 'network') throw new TypeError('fetch failed');
    if (typeof instr === 'number') return { status: instr, body: { error: 'Boom' } };
    if (instr && typeof instr === 'object') return instr;
    const res = apply();
    if (instr === 'lost') throw new TypeError('fetch failed');
    return res;
  }

  const api = {
    async createReport(p) {
      return handle('create', () => {
        const ex = reports.get(p.id);
        if (!ex) {
          const now = new Date().toISOString();
          const r = { id: p.id, status: 'Submitted', assigned_to: null, resolution_note: null, received_at: now, updated_at: now, version: 1 };
          for (const k of CONTENT) r[k] = p[k] ?? null;
          reports.set(p.id, r);
          addEvents(p.id, p.events);
          return { status: 201, body: structuredClone(r) };
        }
        if (ex.version === 1 && CONTENT.some((k) => (ex[k] ?? null) !== (p[k] ?? null))) {
          return { status: 409, body: { error: 'A different report already uses this id', code: 'ID_CONFLICT', current: structuredClone(ex) } };
        }
        addEvents(p.id, p.events);
        return { status: 200, body: structuredClone(ex) };
      });
    },
    async editReport(id, p) {
      return handle('edit', () => {
        const ex = reports.get(id);
        if (!ex) return { status: 404, body: { error: 'Report not found' } };
        if (ex.status !== 'Submitted') {
          return { status: 409, body: { error: `This report is ${ex.status}; its content can no longer be edited.`, code: 'LOCKED', current: structuredClone(ex) } };
        }
        if (ex.version !== p.base_version) {
          return { status: 409, body: { error: 'The report was changed by someone else.', code: 'VERSION_CONFLICT', current: structuredClone(ex) } };
        }
        for (const k of ['description', 'location_text', 'latitude', 'longitude', 'priority']) if (k in p) ex[k] = p[k];
        ex.version += 1;
        ex.updated_at = new Date().toISOString();
        addEvents(id, p.events);
        return { status: 200, body: structuredClone(ex) };
      });
    },
    async postEvents(id, list) {
      return handle('events', () => {
        if (!reports.has(id)) return { status: 404, body: { error: 'Report not found' } };
        addEvents(id, list);
        return { status: 200, body: { received: list.length } };
      });
    },
  };

  return {
    api, reports, calls, plan,
    eventsFor: (id) => [...events.values()].filter((e) => e.report_id === id),
    // Simulates a coordinator acting on the server while the device is offline.
    coordinator(id, changes) {
      const r = reports.get(id);
      Object.assign(r, changes);
      r.version += 1;
      return r;
    },
  };
}

export function makeEnv(start = 1_700_000_000_000) {
  const clock = { t: start };
  const now = () => clock.t;
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const store = createMemoryStore();
  const server = makeServer();
  const reports = createLocalReports({ store, now, uuid });
  const engine = createSyncEngine({ store, api: server.api, now, uuid, random: () => 0.5 });
  return { clock, store, server, reports, engine, advance: (ms) => { clock.t += ms; } };
}

// Creates a draft and submits it; returns the report id.
export async function submit(env, overrides = {}) {
  const draft = await env.reports.createDraft({ ...FIELDS, ...overrides });
  const r = await env.reports.submitDraft(draft.id);
  if (!r.ok) throw new Error('submit failed: ' + JSON.stringify(r));
  return draft.id;
}
