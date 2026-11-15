// Behaviour every store must have. Run against the memory store and the IndexedDB store.
import test from 'node:test';
import assert from 'node:assert/strict';

const report = (id, extra = {}) => ({ id, status: 'Submitted', description: 'd', ...extra });
const ev = (id, reportId, at, extra = {}) => ({ id, report_id: reportId, type: 'created', occurred_at: at, uploaded: false, ...extra });
const op = (id, seq, reportId = 'r1') => ({ op_id: id, report_id: reportId, type: 'create', seq, lease_until: 0 });

export function defineStoreContract(name, makeStore) {
  test(`${name}: reports round-trip, missing is null, and stored copies are isolated`, async () => {
    const s = await makeStore();
    assert.equal(await s.getReport('nope'), null);
    const r = report('r1', { nested: { a: 1 } });
    await s.commit({ reports: [r] });
    r.nested.a = 99; // changing the caller's object must not change what is stored
    const got = await s.getReport('r1');
    assert.equal(got.nested.a, 1);
    got.nested.a = 5;
    assert.equal((await s.getReport('r1')).nested.a, 1);
    assert.equal((await s.listReports()).length, 1);
  });

  test(`${name}: commit writes reports, ops and events together, and deletes`, async () => {
    const s = await makeStore();
    await s.commit({ reports: [report('r1'), report('r2')], ops: [op('o1', 1)], events: [ev('e1', 'r1', '2026-01-01T00:00:00Z')] });
    assert.equal((await s.listReports()).length, 2);
    assert.equal((await s.listOutbox()).length, 1);
    assert.equal((await s.listEvents('r1')).length, 1);
    await s.commit({ deleteOps: ['o1'], deleteReports: ['r2'] });
    assert.equal((await s.listOutbox()).length, 0);
    assert.equal(await s.getReport('r2'), null);
    assert.ok(await s.getReport('r1'));
    await s.commit({});
  });

  test(`${name}: outbox is ordered by seq as a number`, async () => {
    const s = await makeStore();
    await s.commit({ ops: [op('a', 10), op('b', 2), op('c', 1)] });
    assert.deepEqual((await s.listOutbox()).map((o) => o.op_id), ['c', 'b', 'a']);
  });

  test(`${name}: events are filtered per report, ordered by time, and unuploaded ones are listed`, async () => {
    const s = await makeStore();
    await s.commit({
      events: [
        ev('e3', 'r1', '2026-01-03T00:00:00Z', { uploaded: true }),
        ev('e1', 'r1', '2026-01-01T00:00:00Z'),
        ev('e2', 'r2', '2026-01-02T00:00:00Z'),
        ev('e0', 'r1', '2026-01-01T00:00:00Z'),
      ],
    });
    assert.deepEqual((await s.listEvents('r1')).map((e) => e.id), ['e0', 'e1', 'e3']);
    assert.deepEqual((await s.listUnuploadedEvents()).map((e) => e.id), ['e0', 'e1', 'e2']);
  });

  test(`${name}: a commit that cannot be stored keeps nothing from that commit`, async () => {
    const s = await makeStore();
    await s.commit({ reports: [report('keep')] });
    await assert.rejects(s.commit({ reports: [report('r9')], ops: [op('o9', 1, 'r9')], events: [ev('bad', 'r9', '2026-01-01T00:00:00Z', { oops: () => {} })] }));
    assert.equal(await s.getReport('r9'), null);
    assert.equal((await s.listOutbox()).length, 0);
    assert.ok(await s.getReport('keep'));
  });
}
