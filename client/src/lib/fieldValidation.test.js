import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReportFields } from './fieldValidation.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const ok = () => ({
  category: 'Water point', description: 'Pump handle is broken', location_text: 'Kebele 04 well',
  priority: 'High', reporter_name: 'Selam', reported_at: '2026-11-14T11:00:00Z',
});

test('a valid report passes and is trimmed', () => {
  const r = validateReportFields({ ...ok(), description: '  Pump handle is broken  ' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.description, 'Pump handle is broken');
  assert.deepEqual([r.value.latitude, r.value.longitude], [null, null]);
});

test('length limits, lists and required values', () => {
  assert.ok(validateReportFields({ ...ok(), description: 'abcd' }, NOW).fields.description);
  assert.ok(validateReportFields({ ...ok(), description: 'x'.repeat(1001) }, NOW).fields.description);
  assert.ok(validateReportFields({ ...ok(), location_text: 'a' }, NOW).fields.location_text);
  assert.ok(validateReportFields({ ...ok(), reporter_name: '' }, NOW).fields.reporter_name);
  assert.ok(validateReportFields({ ...ok(), category: 'Roads' }, NOW).fields.category);
  assert.ok(validateReportFields({ ...ok(), priority: undefined }, NOW).fields.priority);
});

test('coordinates: both or neither, in range', () => {
  assert.equal(validateReportFields({ ...ok(), latitude: 9, longitude: 38 }, NOW).ok, true);
  assert.equal(validateReportFields({ ...ok(), latitude: 9 }, NOW).ok, false);
  assert.ok(validateReportFields({ ...ok(), latitude: 95, longitude: 0 }, NOW).fields.latitude);
  assert.ok(validateReportFields({ ...ok(), latitude: 0, longitude: 200 }, NOW).fields.longitude);
});

test('reported_at must be valid and not in the future', () => {
  assert.ok(validateReportFields({ ...ok(), reported_at: 'x' }, NOW).fields.reported_at);
  assert.equal(validateReportFields({ ...ok(), reported_at: '2026-11-14T12:04:00Z' }, NOW).ok, true);
  assert.ok(validateReportFields({ ...ok(), reported_at: '2026-11-14T12:06:00Z' }, NOW).fields.reported_at);
});
