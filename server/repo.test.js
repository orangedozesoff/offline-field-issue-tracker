// Integration tests against a REAL database, in the 'test' schema only.
// Needs TEST_DATABASE_URL in server/.env (the Session pooler string). Skipped if missing.
// report_events is append-only, so tests never clean up: each test uses fresh UUIDs.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPool } = require('./db');
const { createRepo } = require('./repo');

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const it = enabled ? test : test.skip;
const pool = enabled ? createPool({ connectionString: process.env.TEST_DATABASE_URL, schema: 'test' }) : null;
const repo = enabled ? createRepo(pool) : null;
test.after(async () => { if (pool) await pool.end(); });

// One connection check first: if it fails, the 17 tests below do not run, so a bad
// URL or password causes ONE failed login instead of many (the pooler blocks repeats).
test.before(async () => {
  if (!enabled) return;
  try {
    await pool.query('SELECT 1 FROM reports LIMIT 1');
  } catch (err) {
    throw new Error(
      `Cannot use the test database (${err.code || 'no code'}): ${err.message}. ` +
      'Check TEST_DATABASE_URL (Session pooler) and that schema.sql was run in the "test" schema.'
    );
  }
});

const mk = (over = {}) => ({
  id: crypto.randomUUID(), category: 'Water point', description: 'Pump handle is broken',
  location_text: 'Kebele 04 well', latitude: null, longitude: null, priority: 'High',
  reporter_name: 'Selam', reported_at: new Date().toISOString(), events: [], ...over,
});
const devEvent = (type, message = null) => ({ id: crypto.randomUUID(), type, message, occurred_at: new Date().toISOString() });
const types = async (id) => (await repo.listEvents(id)).map((e) => e.type);

it('create: new report is Submitted, version 1, with one server-written created event', async () => {
  const input = mk();
  const r = await repo.createReport(input, 'Selam');
  assert.equal(r.result, 'created');
  assert.equal(r.report.status, 'Submitted');
  assert.equal(r.report.version, 1);
  assert.deepEqual(await types(input.id), ['created']);
});

it('create: an uploaded created event is kept and not duplicated', async () => {
  const ev = devEvent('created');
  const input = mk({ events: [ev] });
  await repo.createReport(input, 'Selam');
  const events = await repo.listEvents(input.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, ev.id);
});

it('create: retry with the same payload is idempotent (one report, no extra events)', async () => {
  const input = mk({ events: [devEvent('created')] });
  assert.equal((await repo.createReport(input, 'Selam')).result, 'created');
  const again = await repo.createReport(input, 'Selam');
  assert.equal(again.result, 'exists');
  assert.equal(again.report.version, 1);
  assert.equal((await repo.listEvents(input.id)).length, 1);
});

it('create: same id with different content is an ID conflict and changes nothing', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  const r = await repo.createReport({ ...input, description: 'A totally different problem' }, 'Selam');
  assert.equal(r.result, 'id_conflict');
  assert.equal((await repo.getReport(input.id)).description, 'Pump handle is broken');
});

it('create: a retry after a later edit still reports success', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  await repo.editReport(input.id, { base_version: 1, priority: 'Low', events: [] }, 'Selam', 'field_worker');
  const again = await repo.createReport(input, 'Selam');
  assert.equal(again.result, 'exists');
  assert.equal(again.report.version, 2);
});

it('create: coordinates and null coordinates round-trip', async () => {
  const withGps = mk({ latitude: 9.0300001, longitude: 38.74 });
  await repo.createReport(withGps, 'Selam');
  const row = await repo.getReport(withGps.id);
  assert.equal(row.latitude, 9.0300001);
  assert.equal((await repo.createReport(withGps, 'Selam')).result, 'exists');
});

it('edit: success bumps version and logs exactly one edited event', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  const r = await repo.editReport(input.id, { base_version: 1, description: 'Handle and pipe are broken', events: [] }, 'Selam', 'field_worker');
  assert.equal(r.result, 'ok');
  assert.equal(r.report.version, 2);
  assert.deepEqual(await types(input.id), ['created', 'edited']);
});

it('edit: an uploaded edited event is used instead of a second server one', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  const ev = devEvent('edited', 'Edited offline');
  await repo.editReport(input.id, { base_version: 1, priority: 'Critical', events: [ev] }, 'Selam', 'field_worker');
  const edited = (await repo.listEvents(input.id)).filter((e) => e.type === 'edited');
  assert.equal(edited.length, 1);
  assert.equal(edited[0].id, ev.id);
});

it('edit: stale base_version is a conflict, changes nothing, writes no event', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  await repo.editReport(input.id, { base_version: 1, priority: 'Low', events: [] }, 'Selam', 'field_worker');
  const r = await repo.editReport(input.id, { base_version: 1, description: 'Stale change here', events: [] }, 'Selam', 'field_worker');
  assert.equal(r.result, 'version_conflict');
  assert.equal(r.current.version, 2);
  assert.equal((await repo.getReport(input.id)).description, 'Pump handle is broken');
  assert.equal((await repo.listEvents(input.id)).length, 2);
});

it('edit: locked after Assigned for a worker, but a coordinator may still change priority', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  await repo.changeStatus(input.id, { to: 'Assigned', assigned_to: 'Dawit' }, 'Hana');
  const worker = await repo.editReport(input.id, { base_version: 2, description: 'Too late to change', events: [] }, 'Selam', 'field_worker');
  assert.equal(worker.result, 'locked');
  const coordDesc = await repo.editReport(input.id, { base_version: 2, description: 'Coordinator rewrite', events: [] }, 'Hana', 'coordinator');
  assert.equal(coordDesc.result, 'locked');
  const coordPriority = await repo.editReport(input.id, { base_version: 2, priority: 'Critical', events: [] }, 'Hana', 'coordinator');
  assert.equal(coordPriority.result, 'ok');
  assert.equal(coordPriority.report.version, 3);
});

it('edit: unknown id returns not_found; invalid id text returns null from getReport', async () => {
  assert.equal((await repo.editReport(crypto.randomUUID(), { base_version: 1, priority: 'Low', events: [] }, 'A', 'coordinator')).result, 'not_found');
  assert.equal(await repo.getReport('abc'), null);
  assert.equal(await repo.getReport(crypto.randomUUID()), null);
});

it('status: full happy path writes one event per change with from/to', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  await repo.changeStatus(input.id, { to: 'Assigned', assigned_to: 'Dawit' }, 'Hana');
  await repo.changeStatus(input.id, { to: 'In Progress' }, 'Dawit');
  const done = await repo.changeStatus(input.id, { to: 'Resolved', resolution_note: 'Handle replaced' }, 'Dawit');
  assert.equal(done.report.status, 'Resolved');
  assert.equal(done.report.version, 4);
  const events = await repo.listEvents(input.id);
  assert.deepEqual(events.map((e) => e.type), ['created', 'status_changed', 'status_changed', 'status_changed']);
  assert.deepEqual(events.slice(1).map((e) => [e.from_status, e.to_status]),
    [['Submitted', 'Assigned'], ['Assigned', 'In Progress'], ['In Progress', 'Resolved']]);
});

it('status: rejection reason and reopen reason are saved in the event message', async () => {
  const a = mk();
  await repo.createReport(a, 'Selam');
  await repo.changeStatus(a.id, { to: 'Rejected', reason: 'Duplicate of an older report' }, 'Hana');
  const ev = (await repo.listEvents(a.id)).pop();
  assert.equal(ev.type, 'rejected');
  assert.equal(ev.message, 'Duplicate of an older report');

  const b = mk();
  await repo.createReport(b, 'Selam');
  await repo.changeStatus(b.id, { to: 'Assigned', assigned_to: 'Dawit' }, 'Hana');
  await repo.changeStatus(b.id, { to: 'In Progress' }, 'Dawit');
  await repo.changeStatus(b.id, { to: 'Resolved', resolution_note: 'Fixed' }, 'Dawit');
  const reopened = await repo.changeStatus(b.id, { to: 'In Progress', reason: 'Leaking again' }, 'Hana');
  assert.equal(reopened.event.type, 'reopened');
  assert.equal(reopened.report.resolution_note, 'Fixed');
  assert.equal((await repo.listEvents(b.id)).pop().message, 'Leaking again');
});

it('status: invalid transition and missing field change nothing and write no event', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  const bad = await repo.changeStatus(input.id, { to: 'Resolved', resolution_note: 'x' }, 'Hana');
  assert.equal(bad.result, 'invalid_transition');
  assert.equal(bad.error.code, 'INVALID_TRANSITION');
  const missing = await repo.changeStatus(input.id, { to: 'Assigned' }, 'Hana');
  assert.equal(missing.result, 'invalid_transition');
  assert.equal(missing.error.code, 'MISSING_FIELD');
  const row = await repo.getReport(input.id);
  assert.equal(row.status, 'Submitted');
  assert.equal(row.version, 1);
  assert.equal((await repo.listEvents(input.id)).length, 1);
});

it('status: two simultaneous assignments, exactly one wins', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  const [a, b] = await Promise.all([
    repo.changeStatus(input.id, { to: 'Assigned', assigned_to: 'Dawit' }, 'Hana'),
    repo.changeStatus(input.id, { to: 'Assigned', assigned_to: 'Meron' }, 'Hana'),
  ]);
  assert.deepEqual([a.result, b.result].sort(), ['invalid_transition', 'ok']);
  const row = await repo.getReport(input.id);
  assert.equal(row.version, 2);
  assert.equal(row.assigned_to, (a.result === 'ok' ? 'Dawit' : 'Meron'));
  assert.equal((await repo.listEvents(input.id)).length, 2);
});

it('list: filters work and the newest report is included', async () => {
  const input = mk({ priority: 'Critical', category: 'Safety' });
  await repo.createReport(input, 'Selam');
  const all = await repo.listReports({});
  assert.ok(all.some((r) => r.id === input.id));
  const filtered = await repo.listReports({ status: 'Submitted', priority: 'Critical', category: 'Safety' });
  assert.ok(filtered.every((r) => r.status === 'Submitted' && r.priority === 'Critical' && r.category === 'Safety'));
  assert.ok(filtered.some((r) => r.id === input.id));
  assert.ok(!('student_email' in all[0]) && !('reporter_email' in all[0]));
});

it('history is append-only: UPDATE, DELETE and TRUNCATE are refused', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  const [ev] = await repo.listEvents(input.id);
  await assert.rejects(pool.query('UPDATE report_events SET message = $1 WHERE id = $2', ['x', ev.id]), /append-only/);
  await assert.rejects(pool.query('DELETE FROM report_events WHERE id = $1', [ev.id]), /append-only/);
  await assert.rejects(pool.query('TRUNCATE report_events'), /append-only/);
  await assert.rejects(pool.query('DELETE FROM reports WHERE id = $1', [input.id]), /foreign key|violates/);
});

it('appendEvents: adds device events, ignores known ids, and refuses unknown reports', async () => {
  const input = mk();
  await repo.createReport(input, 'Selam');
  const ev = devEvent('synced', 'Report accepted by the server');
  assert.equal((await repo.appendEvents(input.id, [ev], 'Selam')).result, 'ok');
  assert.equal((await repo.appendEvents(input.id, [ev], 'Selam')).result, 'ok'); // same id: ignored
  assert.deepEqual(await types(input.id), ['created', 'synced']);
  assert.equal((await repo.appendEvents(crypto.randomUUID(), [devEvent('synced')], 'Selam')).result, 'not_found');
});
