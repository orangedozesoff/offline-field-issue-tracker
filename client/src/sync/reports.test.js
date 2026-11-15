import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, FIELDS, submit } from './testKit.js';

test('drafts may be incomplete, can be edited and deleted, and never create outbox work', async () => {
  const env = makeEnv();
  const d = await env.reports.createDraft({ description: 'half' });
  assert.deepEqual([d.status, d.sync_state, d.version], ['Draft', null, 0]);
  assert.equal((await env.reports.updateDraft(d.id, { location_text: 'Market' })).ok, true);
  assert.equal((await env.store.getReport(d.id)).location_text, 'Market');
  assert.equal((await env.store.listOutbox()).length, 0);
  assert.equal((await env.reports.deleteDraft(d.id)).ok, true);
  assert.equal(await env.store.getReport(d.id), null);
});

test('submit: invalid drafts are refused with field messages and queue nothing', async () => {
  const env = makeEnv();
  const d = await env.reports.createDraft({ description: 'no' });
  const r = await env.reports.submitDraft(d.id);
  assert.equal(r.ok, false);
  assert.ok(r.fields.description && r.fields.category && r.fields.location_text && r.fields.reporter_name);
  assert.equal((await env.store.listOutbox()).length, 0);
  assert.equal((await env.store.getReport(d.id)).status, 'Draft');
});

test('submit: report, outbox entry and created event are saved together', async () => {
  const env = makeEnv();
  const id = await submit(env);
  const r = await env.store.getReport(id);
  assert.deepEqual([r.status, r.sync_state, r.expected_version], ['Submitted', 'Pending', 1]);
  const ops = await env.store.listOutbox();
  assert.equal(ops.length, 1);
  assert.deepEqual([ops[0].type, ops[0].report_id], ['create', id]);
  assert.equal(ops[0].payload.description, FIELDS.description);
  assert.deepEqual((await env.store.listEvents(id)).map((e) => e.type), ['created']);
  assert.equal((await env.reports.submitDraft(id)).error, 'NOT_A_DRAFT'); // cannot submit twice
});

test('edit: versions count up across queued edits and the lock follows the status', async () => {
  const env = makeEnv();
  const id = await submit(env);
  await env.reports.editSubmitted(id, { description: 'Handle and pipe are broken' });
  await env.reports.editSubmitted(id, { priority: 'Low' });
  const ops = await env.store.listOutbox();
  assert.deepEqual(ops.map((o) => [o.type, o.payload.base_version]), [['create', undefined], ['edit', 1], ['edit', 2]]);
  assert.equal((await env.store.getReport(id)).expected_version, 3);
  const r = await env.store.getReport(id);
  await env.store.commit({ reports: [{ ...r, status: 'Assigned' }] });
  const locked = await env.reports.editSubmitted(id, { priority: 'High' });
  assert.deepEqual([locked.ok, locked.error], [false, 'LOCKED']);
});

test('edit: unchanged values, invalid values and unknown reports are refused', async () => {
  const env = makeEnv();
  const id = await submit(env);
  assert.equal((await env.reports.editSubmitted(id, { priority: FIELDS.priority })).error, 'NO_CHANGES');
  const bad = await env.reports.editSubmitted(id, { description: 'no' });
  assert.deepEqual([bad.error, Boolean(bad.fields.description)], ['VALIDATION', true]);
  assert.equal((await env.reports.editSubmitted('missing', { priority: 'Low' })).error, 'NOT_FOUND');
  assert.equal((await env.store.listOutbox()).length, 1); // only the create
});

test('edit: location text and coordinates travel together', async () => {
  const env = makeEnv();
  const id = await submit(env);
  assert.equal((await env.reports.editSubmitted(id, { latitude: 9.03 })).error, 'VALIDATION');
  const ok = await env.reports.editSubmitted(id, { latitude: 9.03, longitude: 38.74 });
  assert.equal(ok.ok, true);
  const op = (await env.store.listOutbox()).pop();
  assert.deepEqual(op.payload.changes, { latitude: 9.03, longitude: 38.74 });
});

test('possible duplicates: same problem within 24 hours, ignoring case and spacing', async () => {
  const env = makeEnv();
  const id = await submit(env);
  const same = { ...FIELDS, description: '  PUMP handle   is broken ', location_text: 'kebele 04 well' };
  assert.equal((await env.reports.findPossibleDuplicate(same))?.id, id);
  assert.equal(await env.reports.findPossibleDuplicate(same, id), null);
  assert.equal(await env.reports.findPossibleDuplicate({ ...same, category: 'Safety' }), null);
  env.advance(25 * 3600 * 1000);
  assert.equal(await env.reports.findPossibleDuplicate(same), null);
});

test('retry and conflict helpers refuse reports that are not in the right state', async () => {
  const env = makeEnv();
  const id = await submit(env);
  assert.equal((await env.reports.retryFailed(id)).error, 'NOT_FAILED');
  assert.equal((await env.reports.resolveConflict(id, 'discard')).error, 'NOT_FAILED');
  const r = await env.store.getReport(id);
  await env.store.commit({ reports: [{ ...r, sync_state: 'Failed' }] });
  assert.equal((await env.reports.resolveConflict(id, 'discard')).error, 'NOT_A_CONFLICT'); // head op is a create
});
