// HTTP mapping tests with a fake repository: no database, no Express.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandlers } = require('./handlers');

const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const REPORT = { id: ID, status: 'Submitted', version: 1 };
const WORKER = { 'x-role': 'field_worker', 'x-actor': 'Selam' };
const COORD = { 'x-role': 'coordinator', 'x-actor': 'Hana' };
const NEW_BODY = {
  id: ID, category: 'Water point', description: 'Pump handle is broken', location_text: 'Kebele 04 well',
  priority: 'High', reporter_name: 'Selam', reported_at: new Date().toISOString(),
};

function setup(overrides = {}) {
  const calls = [];
  const spy = (name, value) => async (...args) => { calls.push([name, ...args]); return typeof value === 'function' ? value(...args) : value; };
  const repo = {
    getReport: spy('getReport', REPORT),
    listEvents: spy('listEvents', []),
    listReports: spy('listReports', []),
    createReport: spy('createReport', { result: 'created', report: REPORT }),
    editReport: spy('editReport', { result: 'ok', report: { ...REPORT, version: 2 } }),
    changeStatus: spy('changeStatus', { result: 'ok', report: { ...REPORT, status: 'Assigned', version: 2 } }),
    appendEvents: spy('appendEvents', { result: 'ok' }),
  };
  for (const [k, v] of Object.entries(overrides)) repo[k] = spy(k, v);
  return { h: createHandlers(repo), calls, wrote: () => calls.some(([n]) => ['createReport', 'editReport', 'changeStatus', 'appendEvents'].includes(n)) };
}

test('health check', async () => {
  const { h } = setup();
  assert.deepEqual(await h.health(), { status: 200, body: { status: 'ok' } });
});

test('list: valid filters are passed on; bad or repeated filters are 400', async () => {
  const { h, calls } = setup();
  const ok = await h.listReports({ query: { status: 'Submitted', priority: 'High', category: '' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0], ['listReports', { status: 'Submitted', priority: 'High' }]);
  const bad = await h.listReports({ query: { status: 'Done', priority: ['High', 'Low'] } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.status && bad.body.fields.priority);
});

test('get: bad id 400, unknown 404, found 200', async () => {
  assert.equal((await setup().h.getReport({ params: { id: 'abc' } })).status, 400);
  assert.equal((await setup({ getReport: null }).h.getReport({ params: { id: ID } })).status, 404);
  assert.equal((await setup().h.getReport({ params: { id: ID } })).status, 200);
});

test('events: 404 when the report is unknown, otherwise the history', async () => {
  assert.equal((await setup({ getReport: null }).h.listEvents({ params: { id: ID } })).status, 404);
  assert.equal((await setup().h.listEvents({ params: { id: 'nope' } })).status, 400);
  const r = await setup({ listEvents: [{ type: 'created' }] }).h.listEvents({ params: { id: ID } });
  assert.deepEqual(r, { status: 200, body: [{ type: 'created' }] });
});

test('create: identity headers are required (400) and only field workers may create (403)', async () => {
  const s = setup();
  assert.equal((await s.h.createReport({ headers: {}, body: NEW_BODY })).status, 400);
  const forbidden = await s.h.createReport({ headers: COORD, body: NEW_BODY });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, 'FORBIDDEN');
  assert.equal(s.wrote(), false);
});

test('create: invalid body is 400 with fields and never reaches the database', async () => {
  const s = setup();
  const r = await s.h.createReport({ headers: WORKER, body: { ...NEW_BODY, description: 'no', category: 'Roads' } });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.description && r.body.fields.category);
  assert.equal(s.wrote(), false);
  assert.equal((await s.h.createReport({ headers: WORKER, body: undefined })).status, 400);
});

test('create: 201 when new, 200 on retry, 409 ID_CONFLICT on different content', async () => {
  const call = (res) => setup({ createReport: res }).h.createReport({ headers: WORKER, body: NEW_BODY });
  assert.equal((await call({ result: 'created', report: REPORT })).status, 201);
  assert.equal((await call({ result: 'exists', report: REPORT })).status, 200);
  const c = await call({ result: 'id_conflict', report: REPORT });
  assert.equal(c.status, 409);
  assert.equal(c.body.code, 'ID_CONFLICT');
  assert.deepEqual(c.body.current, REPORT);
});

test('create: the actor header is passed to the repository', async () => {
  const s = setup();
  await s.h.createReport({ headers: WORKER, body: NEW_BODY });
  assert.equal(s.calls[0][0], 'createReport');
  assert.equal(s.calls[0][2], 'Selam');
});

test('edit: id, headers and body are checked before the database', async () => {
  const s = setup();
  const body = { base_version: 1, priority: 'Low' };
  assert.equal((await s.h.editReport({ params: { id: '1' }, headers: WORKER, body })).status, 400);
  assert.equal((await s.h.editReport({ params: { id: ID }, headers: {}, body })).status, 400);
  assert.equal((await s.h.editReport({ params: { id: ID }, headers: WORKER, body: { priority: 'Low' } })).status, 400);
  assert.equal(s.wrote(), false);
});

test('edit: ok 200, role is passed on, and every failure result maps correctly', async () => {
  const run = (res, headers = WORKER) =>
    setup({ editReport: res }).h.editReport({ params: { id: ID }, headers, body: { base_version: 1, priority: 'Low' } });
  assert.equal((await run({ result: 'ok', report: REPORT })).status, 200);
  assert.equal((await run({ result: 'not_found' })).status, 404);
  const locked = await run({ result: 'locked', message: 'Report is Assigned', current: REPORT });
  assert.deepEqual([locked.status, locked.body.code, locked.body.error], [409, 'LOCKED', 'Report is Assigned']);
  const stale = await run({ result: 'version_conflict', current: REPORT });
  assert.deepEqual([stale.status, stale.body.code], [409, 'VERSION_CONFLICT']);
  assert.deepEqual(stale.body.current, REPORT);
  const s = setup();
  await s.h.editReport({ params: { id: ID }, headers: COORD, body: { base_version: 1, priority: 'Low' } });
  assert.deepEqual([s.calls[0][3], s.calls[0][4]], ['Hana', 'coordinator']);
});

test('status: only coordinators (403), body shape checked, workers never reach the database', async () => {
  const s = setup();
  const r = await s.h.changeStatus({ params: { id: ID }, headers: WORKER, body: { to: 'Assigned', assigned_to: 'Dawit' } });
  assert.equal(r.status, 403);
  assert.equal((await s.h.changeStatus({ params: { id: ID }, headers: COORD, body: {} })).status, 400);
  assert.equal((await s.h.changeStatus({ params: { id: 'x' }, headers: COORD, body: { to: 'Assigned' } })).status, 400);
  assert.equal(s.wrote(), false);
});

test('status: ok 200, 404, invalid transition 409 with allowed, missing field 400', async () => {
  const run = (res) => setup({ changeStatus: res }).h.changeStatus({ params: { id: ID }, headers: COORD, body: { to: 'Resolved' } });
  assert.equal((await run({ result: 'ok', report: REPORT })).status, 200);
  assert.equal((await run({ result: 'not_found' })).status, 404);
  const inv = await run({ result: 'invalid_transition', error: { httpStatus: 409, code: 'INVALID_TRANSITION', message: 'Cannot move', from: 'Submitted', to: 'Resolved', allowed: ['Assigned', 'Rejected'] } });
  assert.deepEqual([inv.status, inv.body.code, inv.body.allowed], [409, 'INVALID_TRANSITION', ['Assigned', 'Rejected']]);
  const miss = await run({ result: 'invalid_transition', error: { httpStatus: 400, code: 'MISSING_FIELD', message: 'reason is required', fields: { reason: 'Required' } } });
  assert.deepEqual([miss.status, miss.body.fields], [400, { reason: 'Required' }]);
});

test('unexpected repository errors are thrown, not swallowed', async () => {
  const s = setup({ getReport: () => { throw new Error('db down'); } });
  await assert.rejects(s.h.getReport({ params: { id: ID } }), /db down/);
});

const EVENT = { id: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f', type: 'synced', occurred_at: '2026-11-14T10:00:00Z' };

test('events upload: id, headers and body are checked before the database', async () => {
  const s = setup();
  assert.equal((await s.h.postEvents({ params: { id: 'x' }, headers: WORKER, body: { events: [EVENT] } })).status, 400);
  assert.equal((await s.h.postEvents({ params: { id: ID }, headers: {}, body: { events: [EVENT] } })).status, 400);
  for (const body of [undefined, {}, { events: [] }, { events: 'no' }]) {
    assert.equal((await s.h.postEvents({ params: { id: ID }, headers: WORKER, body })).status, 400);
  }
  const forged = await s.h.postEvents({ params: { id: ID }, headers: WORKER, body: { events: [{ ...EVENT, type: 'status_changed' }] } });
  assert.equal(forged.status, 400);
  assert.ok(forged.body.fields['events[0].type']);
  assert.equal(s.wrote(), false);
});

test('events upload: 200 with a count, actor passed on, 404 for an unknown report', async () => {
  const s = setup();
  const ok = await s.h.postEvents({ params: { id: ID }, headers: WORKER, body: { events: [EVENT] } });
  assert.deepEqual([ok.status, ok.body], [200, { received: 1 }]);
  assert.equal(s.calls[0][0], 'appendEvents');
  assert.equal(s.calls[0][3], 'Selam');
  const missing = setup({ appendEvents: { result: 'not_found' } });
  assert.equal((await missing.h.postEvents({ params: { id: ID }, headers: WORKER, body: { events: [EVENT] } })).status, 404);
});
