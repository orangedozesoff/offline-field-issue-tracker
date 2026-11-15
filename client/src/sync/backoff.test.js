import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs } from './backoff.js';

test('doubles from 2s and is capped at 60s', () => {
  const mid = () => 0.5;
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, mid)), [2000, 4000, 8000, 16000, 32000, 60000]);
  assert.equal(backoffMs(50, mid), 60000);
  assert.equal(backoffMs(0, mid), 2000);
});

test('jitter stays within +-20% and never exceeds the cap', () => {
  assert.equal(backoffMs(3, () => 0), 6400);
  assert.equal(backoffMs(3, () => 1), 9600);
  assert.equal(backoffMs(10, () => 1), 60000);
});
