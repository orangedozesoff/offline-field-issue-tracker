// Needs:  npm install idb   and   npm install -D fake-indexeddb
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineStoreContract } from './storeContract.js';
import { openIdbStore } from './idbStore.js';

let n = 0;
defineStoreContract('IndexedDB store', () => openIdbStore({ name: `test-db-${++n}` }));

test('IndexedDB store: data survives closing and reopening (a page reload)', async () => {
  const name = `reload-db-${++n}`;
  const first = await openIdbStore({ name });
  await first.commit({
    reports: [{ id: 'r1', status: 'Submitted', sync_state: 'Pending' }],
    ops: [{ op_id: 'o1', report_id: 'r1', type: 'create', seq: 1, lease_until: 0 }],
    events: [{ id: 'e1', report_id: 'r1', type: 'created', occurred_at: '2026-01-01T00:00:00Z', uploaded: false }],
  });
  first.close();
  const second = await openIdbStore({ name });
  assert.equal((await second.getReport('r1')).sync_state, 'Pending');
  assert.equal((await second.listOutbox()).length, 1);
  assert.equal((await second.listUnuploadedEvents()).length, 1);
  second.close();
});
