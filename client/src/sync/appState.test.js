import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../storage/memoryStore.js';
import { makeServer, FIELDS } from './testKit.js';
import { createAppState } from './appState.js';

const tick = () => new Promise((r) => setImmediate(r));
const COORD = { role: 'coordinator', actor: 'Hana' };

function setup() {
  const server = makeServer();
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const app = createAppState({
    store: createMemoryStore(), api: server.api, uuid, syncIntervalMs: 1e9,
    env: { window: null, document: null, locks: null, setInterval: () => 1, clearInterval: () => {} },
  });
  return { app, server };
}
async function submit(app, over = {}) {
  const d = await app.reports.createDraft({ ...FIELDS, ...over });
  await app.reports.submitDraft(d.id);
  return d.id;
}

test('submitting triggers a sync right away once the scheduler is started', async () => {
  const { app, server } = setup();
  app.start();
  await tick();
  const id = await submit(app);
  await tick(); await tick();
  assert.equal((await app.store.getReport(id)).sync_state, 'Synchronized');
  assert.equal(server.reports.size, 1);
  app.stop();
});

test('without a connection the report stays Pending and counts show it', async () => {
  const { app, server } = setup();
  server.plan.push('network');
  app.start();
  await tick();
  await app.reports.createDraft({ description: 'unfinished' });
  await submit(app);
  await tick(); await tick();
  const { reports, counts } = await app.snapshot();
  assert.deepEqual(counts, { drafts: 1, pending: 1, synchronized: 0, failed: 0 });
  assert.equal(reports.length, 2);
  app.stop();
});

test('subscribers are told about changes until they unsubscribe', async () => {
  const { app } = setup();
  let calls = 0;
  const off = app.subscribe(() => { calls++; });
  await app.reports.createDraft({ description: 'x' });
  assert.equal(calls, 1);
  off();
  await app.reports.createDraft({ description: 'y' });
  assert.equal(calls, 1);
});

test('refresh: adds reports from other devices and updates statuses, but never overwrites unsent work', async () => {
  const { app, server } = setup();
  const synced = await submit(app);
  await app.engine.syncOnce();
  const unsent = await submit(app, { description: 'Second problem here' });
  server.plan.push('network');
  await app.engine.syncOnce(); // second report stays Pending
  server.coordinator(synced, { status: 'Assigned', assigned_to: 'Dawit' });
  server.reports.set('other-device', { ...server.reports.get(synced), id: 'other-device', description: 'Seen only on the server', version: 1, status: 'Submitted' });

  const res = await app.refreshFromServer(COORD);
  assert.deepEqual([res.ok, res.updated], [true, 2]);
  assert.equal((await app.store.getReport(synced)).status, 'Assigned');
  const other = await app.store.getReport('other-device');
  assert.deepEqual([other.sync_state, other.description], ['Synchronized', 'Seen only on the server']);
  assert.equal((await app.store.getReport(unsent)).sync_state, 'Pending');
});

test('refresh: offline and server errors are reported, nothing is changed', async () => {
  const { app, server } = setup();
  server.plan.push('network');
  assert.deepEqual(await app.refreshFromServer(COORD), { ok: false, offline: true });
  server.plan.push(500);
  assert.deepEqual(await app.refreshFromServer(COORD), { ok: false, status: 500 });
  assert.equal((await app.store.listReports()).length, 0);
});

test('refresh: a Failed report keeps the local text until the user resolves it', async () => {
  const { app, server } = setup();
  const id = await submit(app);
  await app.engine.syncOnce();
  server.coordinator(id, { status: 'Assigned', assigned_to: 'Dawit' });
  await app.reports.editSubmitted(id, { description: 'My late correction here' });
  await app.engine.syncOnce();
  assert.equal((await app.store.getReport(id)).sync_state, 'Failed');
  await app.refreshFromServer(COORD);
  const r = await app.store.getReport(id);
  assert.deepEqual([r.sync_state, r.description], ['Failed', 'My late correction here']);
});

test('coordinator status change: success updates the local copy; refusal and offline are reported', async () => {
  const { app, server } = setup();
  const id = await submit(app);
  await app.engine.syncOnce();
  const ok = await app.changeStatus(id, { to: 'Assigned', assigned_to: 'Dawit' }, COORD);
  assert.equal(ok.ok, true);
  const r = await app.store.getReport(id);
  assert.deepEqual([r.status, r.assigned_to, r.version, r.sync_state], ['Assigned', 'Dawit', 2, 'Synchronized']);
  const bad = await app.changeStatus(id, { to: 'Assigned', assigned_to: 'X' }, COORD);
  assert.deepEqual([bad.ok, bad.status, bad.error.code], [false, 409, 'INVALID_TRANSITION']);
  server.plan.push('network');
  assert.deepEqual(await app.changeStatus(id, { to: 'Assigned' }, COORD), { ok: false, offline: true });
});

test('timeline: merges server and device events without duplicates and marks unsent ones', async () => {
  const { app } = setup();
  const id = await submit(app);
  await app.engine.syncOnce(); // created + synced reach the server
  await app.reports.editSubmitted(id, { description: 'Handle and pipe are broken' }); // not sent yet
  const { events, offline } = await app.timeline(id, COORD);
  assert.equal(offline, false);
  const ids = events.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(events.map((e) => e.type).sort(), ['created', 'edited', 'synced']);
  assert.deepEqual(events.map((e) => [e.type, e.pendingUpload]).sort(), [['created', false], ['edited', true], ['synced', false]]);
});

test('timeline: server-side status changes appear with their actor data', async () => {
  const { app } = setup();
  const id = await submit(app);
  await app.engine.syncOnce();
  await app.changeStatus(id, { to: 'Assigned', assigned_to: 'Dawit' }, COORD);
  const { events } = await app.timeline(id, COORD);
  const change = events.find((e) => e.type === 'status_changed');
  assert.deepEqual([change.from_status, change.to_status, change.message, change.pendingUpload], ['Submitted', 'Assigned', 'Assigned to Dawit', false]);
});

test('timeline: offline shows device events only and says so', async () => {
  const { app, server } = setup();
  server.plan.push('network');
  const id = await submit(app);
  server.plan.push('network');
  const { events, offline } = await app.timeline(id, COORD);
  assert.equal(offline, true);
  assert.deepEqual(events.map((e) => [e.type, e.pendingUpload]), [['created', true]]);
});
