const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUSES, TRANSITIONS, validateTransition } = require('./transitions');

const FULL = { assigned_to: 'Dawit', reason: 'Because', resolution_note: 'Fixed pump' };

test('every valid pair is accepted when required fields are given', () => {
  for (const from of STATUSES) {
    for (const to of TRANSITIONS[from]) {
      assert.equal(validateTransition(from, to, FULL).ok, true, `${from} -> ${to}`);
    }
  }
});

test('every other pair is rejected with 409 INVALID_TRANSITION', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      if (TRANSITIONS[from].includes(to)) continue;
      const r = validateTransition(from, to, FULL);
      assert.equal(r.ok, false, `${from} -> ${to}`);
      assert.equal(r.httpStatus, 409);
      assert.equal(r.code, 'INVALID_TRANSITION');
      assert.deepEqual(r.allowed, TRANSITIONS[from]);
    }
  }
});

test('Rejected is terminal', () => {
  for (const to of STATUSES) assert.equal(validateTransition('Rejected', to, FULL).ok, false);
});

test('required fields are enforced and blank strings do not count', () => {
  const cases = [
    ['Submitted', 'Assigned', 'assigned_to'],
    ['Submitted', 'Rejected', 'reason'],
    ['Assigned', 'Rejected', 'reason'],
    ['In Progress', 'Resolved', 'resolution_note'],
    ['Resolved', 'In Progress', 'reason'],
  ];
  for (const [from, to, field] of cases) {
    for (const bad of [undefined, '', '   ', 42]) {
      const r = validateTransition(from, to, { [field]: bad });
      assert.equal(r.ok, false, `${from} -> ${to} with ${String(bad)}`);
      assert.equal(r.httpStatus, 400);
      assert.equal(r.code, 'MISSING_FIELD');
      assert.ok(r.fields[field]);
    }
  }
});

test('Assigned -> In Progress needs no extra field', () => {
  assert.equal(validateTransition('Assigned', 'In Progress', {}).ok, true);
});

test('event types: rejected and reopened are distinguished', () => {
  assert.equal(validateTransition('Submitted', 'Rejected', FULL).eventType, 'rejected');
  assert.equal(validateTransition('Resolved', 'In Progress', FULL).eventType, 'reopened');
  assert.equal(validateTransition('Submitted', 'Assigned', FULL).eventType, 'status_changed');
});

test('unknown statuses return 400 UNKNOWN_STATUS', () => {
  const r = validateTransition('Submitted', 'Closed', FULL);
  assert.equal(r.httpStatus, 400);
  assert.equal(r.code, 'UNKNOWN_STATUS');
  assert.equal(validateTransition('Draft', 'Submitted', FULL).code, 'UNKNOWN_STATUS');
});
