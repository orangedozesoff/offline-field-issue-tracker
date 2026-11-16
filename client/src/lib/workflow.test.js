import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedMoves, neededField, moveLabel, failureKind } from './workflow.js';

test('allowed moves follow the workflow and Rejected is final', () => {
  assert.deepEqual(allowedMoves('Submitted'), ['Assigned', 'Rejected']);
  assert.deepEqual(allowedMoves('Resolved'), ['In Progress']);
  assert.deepEqual(allowedMoves('Rejected'), []);
  assert.deepEqual(allowedMoves('Draft'), []);
});

test('moves that need a note ask for it; reopening is labelled', () => {
  assert.equal(neededField('Submitted', 'Assigned').name, 'assigned_to');
  assert.equal(neededField('Assigned', 'Rejected').name, 'reason');
  assert.equal(neededField('In Progress', 'Resolved').name, 'resolution_note');
  assert.equal(neededField('Resolved', 'In Progress').name, 'reason');
  assert.equal(neededField('Assigned', 'In Progress'), null);
  assert.equal(moveLabel('Resolved', 'In Progress'), 'Reopen');
  assert.equal(moveLabel('Assigned', 'In Progress'), 'In Progress');
});

test('failure kinds decide which buttons a Failed report shows', () => {
  const k = (code) => failureKind({ last_error: { code } });
  assert.equal(k('LOCKED'), 'conflict');
  assert.equal(k('VERSION_CONFLICT'), 'conflict');
  assert.equal(k('HTTP_500'), 'retry');
  assert.equal(k('HTTP_429'), 'retry');
  assert.equal(k('HTTP_400'), 'fix');
  assert.equal(k(undefined), 'fix');
});
