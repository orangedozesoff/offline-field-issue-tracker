import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, submit } from './testKit.js';

const types = async (env, id) => (await env.store.listEvents(id)).map((e) => e.type);
const serverTypes = (env, id) => env.server.eventsFor(id).map((e) => e.type).sort();

test('offline: the report stays Pending, survives a restart, and is not lost', async () => {
  const env = makeEnv();
  env.server.plan.push('network');
  const id = await submit(env);
  const summary = await env.engine.syncOnce();
  assert.equal(summary.retrying, 1);
  const r = await env.store.getReport(id); // read back as after a restart
  assert.deepEqual([r.sync_state, r.attempts, r.last_error.code], ['Pending', 1, 'NETWORK']);
  assert.equal((await env.store.listOutbox()).length, 1);
  assert.equal(env.server.reports.size, 0);
  assert.deepEqual(await types(env, id), ['created', 'sync_failed']);
});

test('retries wait for the backoff delay, then go through', async () => {
  const env = makeEnv();
  env.server.plan.push('network');
  const id = await submit(env);
  await env.engine.syncOnce();
  env.advance(1999);
  assert.equal((await env.engine.syncOnce()).waiting, 1);
  assert.equal(env.server.calls.length, 1);
  env.advance(1);
  assert.equal((await env.engine.syncOnce()).succeeded, 1);
  assert.equal((await env.store.getReport(id)).sync_state, 'Synchronized');
});

test('success: Synchronized, outbox empty, every event uploaded exactly once', async () => {
  const env = makeEnv();
  env.server.plan.push('network');
  const id = await submit(env);
  await env.engine.syncOnce();
  env.advance(5000);
  const s = await env.engine.syncOnce();
  assert.deepEqual([s.succeeded, s.flushed], [1, 1]);
  const r = await env.store.getReport(id);
  assert.deepEqual([r.sync_state, r.version, r.status, r.last_error], ['Synchronized', 1, 'Submitted', null]);
  assert.equal((await env.store.listOutbox()).length, 0);
  assert.equal((await env.store.listUnuploadedEvents()).length, 0);
  assert.deepEqual(serverTypes(env, id), ['created', 'sync_failed', 'synced']);
  const before = env.server.calls.length;
  await env.engine.syncOnce();
  assert.equal(env.server.calls.length, before); // nothing left to send
});

test('lost response: the retry is idempotent, so there is no duplicate', async () => {
  const env = makeEnv();
  env.server.plan.push('lost');
  const id = await submit(env);
  assert.equal((await env.engine.syncOnce()).retrying, 1);
  assert.equal(env.server.reports.size, 1); // the server did save it
  env.advance(5000);
  assert.equal((await env.engine.syncOnce()).succeeded, 1);
  assert.equal(env.server.reports.size, 1);
  assert.equal((await env.store.getReport(id)).sync_state, 'Synchronized');
  assert.equal(env.server.eventsFor(id).filter((e) => e.type === 'created').length, 1);
});

test('a refused report becomes Failed at once, keeps its data, and is not retried automatically', async () => {
  const env = makeEnv();
  env.server.plan.push({ status: 400, body: { error: 'Validation failed', fields: { description: 'Too short' } } });
  const id = await submit(env);
  assert.equal((await env.engine.syncOnce()).failed, 1);
  const r = await env.store.getReport(id);
  assert.deepEqual([r.sync_state, r.last_error.fields], ['Failed', { description: 'Too short' }]);
  assert.equal((await env.store.listOutbox()).length, 1);
  env.advance(24 * 3600 * 1000);
  await env.engine.syncOnce();
  assert.equal(env.server.calls.length, 1);
  const failedEvent = (await env.store.listEvents(id)).find((e) => e.type === 'sync_failed');
  assert.match(failedEvent.message, /description: Too short/);
});

test('fixing a refused create queues the corrected data and it syncs', async () => {
  const env = makeEnv();
  env.server.plan.push({ status: 400, body: { error: 'Validation failed', fields: { description: 'Too short' } } });
  const id = await submit(env);
  await env.engine.syncOnce();
  const fix = await env.reports.editSubmitted(id, { description: 'Pump handle is completely broken' });
  assert.equal(fix.ok, true);
  assert.equal((await env.store.getReport(id)).sync_state, 'Pending');
  assert.equal((await env.engine.syncOnce()).succeeded, 1);
  assert.equal(env.server.reports.get(id).description, 'Pump handle is completely broken');
  assert.equal((await env.store.getReport(id)).sync_state, 'Synchronized');
});

test('one report failing does not block another', async () => {
  const env = makeEnv();
  env.server.plan.push({ status: 400, body: { error: 'Validation failed', fields: { description: 'x' } } });
  const a = await submit(env);
  const b = await submit(env, { description: 'A second, different problem' });
  const s = await env.engine.syncOnce();
  assert.deepEqual([s.failed, s.succeeded], [1, 1]);
  assert.equal((await env.store.getReport(a)).sync_state, 'Failed');
  assert.equal((await env.store.getReport(b)).sync_state, 'Synchronized');
});

test('server errors: gives up as Failed after 8 attempts, logs twice, and Retry works', async () => {
  const env = makeEnv();
  for (let i = 0; i < 8; i++) env.server.plan.push(500);
  const id = await submit(env);
  for (let i = 0; i < 8; i++) {
    await env.engine.syncOnce();
    env.advance(61000);
  }
  const r = await env.store.getReport(id);
  assert.deepEqual([r.sync_state, r.attempts], ['Failed', 8]);
  assert.equal((await types(env, id)).filter((t) => t === 'sync_failed').length, 2); // first failure + gave up
  assert.equal((await env.engine.syncOnce()).waiting, 1);
  assert.equal((await env.reports.retryFailed(id)).ok, true);
  assert.equal((await env.engine.syncOnce()).succeeded, 1);
});

test('being offline never turns a report into Failed', async () => {
  const env = makeEnv();
  for (let i = 0; i < 30; i++) env.server.plan.push('network');
  const id = await submit(env);
  for (let i = 0; i < 30; i++) {
    await env.engine.syncOnce();
    env.advance(61000);
  }
  const r = await env.store.getReport(id);
  assert.deepEqual([r.sync_state, r.attempts], ['Pending', 30]);
  assert.equal((await types(env, id)).filter((t) => t === 'sync_failed').length, 1); // once per streak, no spam
  assert.equal((await env.engine.syncOnce()).succeeded, 1);
});

test('crash recovery: an op still leased by a dead session is retried after the lease expires', async () => {
  const env = makeEnv();
  await submit(env);
  const [op] = await env.store.listOutbox();
  await env.store.commit({ ops: [{ ...op, lease_until: env.clock.t + 60000 }] });
  assert.equal((await env.engine.syncOnce()).waiting, 1);
  assert.equal(env.server.calls.length, 0);
  env.advance(60001);
  assert.equal((await env.engine.syncOnce()).succeeded, 1);
});

test('two overlapping syncs never send the same operation twice', async () => {
  const env = makeEnv();
  await submit(env);
  const [a, b] = await Promise.all([env.engine.syncOnce(), env.engine.syncOnce()]);
  assert.equal([a, b].filter((x) => x.skipped).length, 1);
  assert.equal(env.server.calls.filter((c) => c === 'create').length, 1);
});

test('operations for one report are sent in order: create, then each edit', async () => {
  const env = makeEnv();
  const id = await submit(env);
  await env.reports.editSubmitted(id, { description: 'Handle and pipe are broken' });
  await env.reports.editSubmitted(id, { priority: 'Critical' });
  const s = await env.engine.syncOnce();
  assert.equal(s.succeeded, 3);
  assert.deepEqual(env.server.calls.filter((c) => c !== 'events'), ['create', 'edit', 'edit']);
  const srv = env.server.reports.get(id);
  assert.deepEqual([srv.version, srv.description, srv.priority], [3, 'Handle and pipe are broken', 'Critical']);
  const r = await env.store.getReport(id);
  assert.deepEqual([r.sync_state, r.version, r.expected_version], ['Synchronized', 3, 3]);
  assert.deepEqual(serverTypes(env, id), ['created', 'edited', 'edited', 'synced', 'synced', 'synced']);
});

test('an edit never overtakes a create that has not reached the server', async () => {
  const env = makeEnv();
  env.server.plan.push('network');
  const id = await submit(env);
  await env.reports.editSubmitted(id, { priority: 'Critical' });
  const s = await env.engine.syncOnce();
  assert.deepEqual([s.retrying, s.waiting], [1, 1]);
  assert.deepEqual(env.server.calls, ['create']);
});

test('drafts are never sent', async () => {
  const env = makeEnv();
  await env.reports.createDraft({ description: 'half written' });
  const s = await env.engine.syncOnce();
  assert.deepEqual(env.server.calls, []);
  assert.equal(s.succeeded + s.waiting + s.failed, 0);
});

test('a failed event upload is kept and retried, not lost', async () => {
  const env = makeEnv();
  env.server.plan.push(undefined, 'network'); // create works, the follow-up events call fails
  const id = await submit(env);
  assert.equal((await env.engine.syncOnce()).flushed, 0);
  assert.equal((await env.store.listUnuploadedEvents()).length, 1);
  assert.equal((await env.store.getReport(id)).sync_state, 'Synchronized');
  assert.equal((await env.engine.syncOnce()).flushed, 1);
  assert.equal((await env.store.listUnuploadedEvents()).length, 0);
  assert.deepEqual(serverTypes(env, id), ['created', 'synced']);
});

test('edit refused because a coordinator already assigned the report: Failed, kept, resolvable', async () => {
  const env = makeEnv();
  const id = await submit(env);
  await env.engine.syncOnce();
  env.server.coordinator(id, { status: 'Assigned', assigned_to: 'Dawit' });
  await env.reports.editSubmitted(id, { description: 'My late correction here' }); // device still thinks Submitted
  await env.engine.syncOnce();
  let r = await env.store.getReport(id);
  assert.deepEqual([r.sync_state, r.last_error.code, r.last_error.current.status], ['Failed', 'LOCKED', 'Assigned']);
  assert.equal(r.description, 'My late correction here'); // the user's text is still there
  env.advance(3600 * 1000);
  const calls = env.server.calls.length;
  await env.engine.syncOnce();
  assert.equal(env.server.calls.length, calls); // a refused edit is not retried automatically

  const res = await env.reports.resolveConflict(id, 'copy');
  assert.equal(res.ok, true);
  r = await env.store.getReport(id);
  assert.deepEqual([r.sync_state, r.status, r.version, r.description], ['Synchronized', 'Assigned', 2, 'Pump handle is broken']);
  assert.equal(res.draft.description, 'My late correction here');
  assert.equal(res.draft.status, 'Draft');
  assert.equal((await env.store.listOutbox()).length, 0);
  await env.engine.syncOnce();
  assert.ok(!serverTypes(env, id).includes('edited')); // the refused change never reaches the history
  assert.ok(serverTypes(env, id).includes('sync_failed')); // but the failure itself does
});

test('stale version: Failed with VERSION_CONFLICT, discard restores the server copy', async () => {
  const env = makeEnv();
  const id = await submit(env);
  await env.engine.syncOnce();
  env.server.coordinator(id, { priority: 'Critical' }); // still Submitted, version 2
  await env.reports.editSubmitted(id, { description: 'Edited with an old copy' });
  await env.engine.syncOnce();
  assert.equal((await env.store.getReport(id)).last_error.code, 'VERSION_CONFLICT');
  const res = await env.reports.resolveConflict(id, 'discard');
  assert.equal(res.draft, null);
  const r = await env.store.getReport(id);
  assert.deepEqual([r.sync_state, r.priority, r.description, r.version], ['Synchronized', 'Critical', 'Pump handle is broken', 2]);
});
