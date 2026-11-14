const test = require('node:test');
const assert = require('node:assert/strict');
const { checkEditAllowed } = require('./edit-rules');

const STATUSES = ['Submitted', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];

test('anyone may edit anything while Submitted', () => {
  for (const role of ['field_worker', 'coordinator']) {
    assert.equal(checkEditAllowed(role, 'Submitted', ['description', 'priority']).ok, true);
  }
});

test('field worker is locked out after Submitted, for every field', () => {
  for (const status of STATUSES.slice(1)) {
    for (const keys of [['description'], ['priority'], ['location_text', 'latitude', 'longitude']]) {
      const r = checkEditAllowed('field_worker', status, keys);
      assert.equal(r.ok, false, `${status} ${keys}`);
      assert.equal(r.code, 'LOCKED');
    }
  }
});

test('coordinator may change only priority after Submitted', () => {
  for (const status of STATUSES.slice(1)) {
    assert.equal(checkEditAllowed('coordinator', status, ['priority']).ok, true, status);
    assert.equal(checkEditAllowed('coordinator', status, ['priority', 'description']).ok, false, status);
    assert.equal(checkEditAllowed('coordinator', status, ['description']).ok, false, status);
  }
});

test('an empty change list is never allowed after Submitted', () => {
  assert.equal(checkEditAllowed('coordinator', 'Assigned', []).ok, false);
});
