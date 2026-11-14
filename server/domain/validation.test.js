const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./validation');

const NOW = Date.parse('2026-11-13T12:00:00Z');
const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const base = () => ({
  id: ID, category: 'Water point', description: 'Pump handle is broken', location_text: 'Kebele 04 well',
  priority: 'High', reporter_name: 'Selam', reported_at: '2026-11-13T11:59:00Z',
});

test('a valid create passes and is cleaned', () => {
  const r = V.validateCreate({ ...base(), description: '  Pump handle is broken  ', id: ID.toUpperCase() }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.description, 'Pump handle is broken');
  assert.equal(r.value.id, ID);
  assert.equal(r.value.latitude, null);
  assert.deepEqual(r.value.events, []);
});

test('non-object bodies are rejected', () => {
  for (const b of [null, undefined, 'x', 5, []]) assert.equal(V.validateCreate(b, NOW).ok, false);
});

test('length boundaries', () => {
  const cases = [
    ['description', 4, 5, 1000, 1001],
    ['location_text', 1, 2, 200, 201],
    ['reporter_name', 1, 2, 60, 61],
  ];
  for (const [name, lowBad, lowOk, highOk, highBad] of cases) {
    assert.ok(V.validateCreate({ ...base(), [name]: 'x'.repeat(lowBad) }, NOW).fields[name], `${name} ${lowBad}`);
    assert.equal(V.validateCreate({ ...base(), [name]: 'x'.repeat(lowOk) }, NOW).ok, true, `${name} ${lowOk}`);
    assert.equal(V.validateCreate({ ...base(), [name]: 'x'.repeat(highOk) }, NOW).ok, true, `${name} ${highOk}`);
    assert.ok(V.validateCreate({ ...base(), [name]: 'x'.repeat(highBad) }, NOW).fields[name], `${name} ${highBad}`);
  }
  assert.ok(V.validateCreate({ ...base(), description: '      ' }, NOW).fields.description);
});

test('category, priority and id must be valid', () => {
  assert.ok(V.validateCreate({ ...base(), category: 'Roads' }, NOW).fields.category);
  assert.ok(V.validateCreate({ ...base(), priority: 'Urgent' }, NOW).fields.priority);
  for (const id of [undefined, '123', 'not-a-uuid', 7]) assert.ok(V.validateCreate({ ...base(), id }, NOW).fields.id);
});

test('coordinates: both or neither, within range, numbers only', () => {
  assert.equal(V.validateCreate({ ...base(), latitude: 9.03, longitude: 38.74 }, NOW).ok, true);
  assert.equal(V.validateCreate({ ...base(), latitude: null, longitude: null }, NOW).ok, true);
  assert.equal(V.validateCreate({ ...base(), latitude: 9.03 }, NOW).ok, false);
  assert.ok(V.validateCreate({ ...base(), latitude: 91, longitude: 0 }, NOW).fields.latitude);
  assert.ok(V.validateCreate({ ...base(), latitude: 0, longitude: -181 }, NOW).fields.longitude);
  assert.ok(V.validateCreate({ ...base(), latitude: '9', longitude: 38 }, NOW).fields.latitude);
});

test('reported_at: valid, and at most 5 minutes in the future', () => {
  assert.ok(V.validateCreate({ ...base(), reported_at: 'yesterday' }, NOW).fields.reported_at);
  assert.ok(V.validateCreate({ ...base(), reported_at: undefined }, NOW).fields.reported_at);
  assert.equal(V.validateCreate({ ...base(), reported_at: '2026-11-13T12:05:00Z' }, NOW).ok, true);
  assert.ok(V.validateCreate({ ...base(), reported_at: '2026-11-13T12:05:01Z' }, NOW).fields.reported_at);
});

test('device events: allowed types only, ids required, capped', () => {
  const ev = (o) => ({ id: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f', type: 'created', occurred_at: '2026-11-13T11:58:00Z', ...o });
  assert.equal(V.validateCreate({ ...base(), events: [ev({})] }, NOW).ok, true);
  assert.ok(V.validateCreate({ ...base(), events: [ev({ type: 'status_changed' })] }, NOW).fields['events[0].type']);
  assert.ok(V.validateCreate({ ...base(), events: [ev({ id: 'x' })] }, NOW).fields['events[0].id']);
  assert.ok(V.validateCreate({ ...base(), events: [ev({ occurred_at: 'no' })] }, NOW).fields['events[0].occurred_at']);
  assert.ok(V.validateCreate({ ...base(), events: 'nope' }, NOW).fields.events);
  assert.ok(V.validateCreate({ ...base(), events: Array(51).fill(ev({})) }, NOW).fields.events);
});

test('edit needs base_version and at least one editable field', () => {
  assert.ok(V.validateEdit({ description: 'Updated text here' }, NOW).fields.base_version);
  assert.ok(V.validateEdit({ base_version: 0, description: 'Updated text here' }, NOW).fields.base_version);
  assert.ok(V.validateEdit({ base_version: 1.5, description: 'Updated text here' }, NOW).fields.base_version);
  assert.ok(V.validateEdit({ base_version: 1 }, NOW).fields.body);
  const ok = V.validateEdit({ base_version: 2, priority: 'Critical', description: 'Updated text here' }, NOW);
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.value).sort(), ['base_version', 'description', 'events', 'priority']);
});

test('edit ignores fields that are not editable and validates the ones given', () => {
  const r = V.validateEdit({ base_version: 1, status: 'Resolved', category: 'Safety', priority: 'Low' }, NOW);
  assert.equal(r.ok, true);
  assert.equal('status' in r.value, false);
  assert.equal('category' in r.value, false);
  assert.ok(V.validateEdit({ base_version: 1, priority: 'Soon' }, NOW).fields.priority);
  assert.ok(V.validateEdit({ base_version: 1, latitude: 5 }, NOW).fields.latitude);
  assert.equal(V.validateEdit({ base_version: 1, latitude: null, longitude: null }, NOW).value.latitude, null);
});

test('status input: to required, optional notes are length-checked', () => {
  assert.ok(V.validateStatusInput({}).fields.to);
  assert.ok(V.validateStatusInput({ to: '  ' }).fields.to);
  assert.ok(V.validateStatusInput({ to: 'Assigned', assigned_to: 'x'.repeat(61) }).fields.assigned_to);
  assert.deepEqual(V.validateStatusInput({ to: ' Assigned ', assigned_to: ' Dawit ' }).value, { to: 'Assigned', assigned_to: 'Dawit' });
});

test('actor headers: role and name required', () => {
  assert.equal(V.validateActor({ 'x-role': 'coordinator', 'x-actor': 'Hana' }).ok, true);
  assert.ok(V.validateActor({ 'x-actor': 'Hana' }).fields['x-role']);
  assert.ok(V.validateActor({ 'x-role': 'admin', 'x-actor': 'Hana' }).fields['x-role']);
  assert.ok(V.validateActor({ 'x-role': 'coordinator' }).fields['x-actor']);
  assert.ok(V.validateActor().fields['x-role']);
});

test('isUuid accepts UUIDs only', () => {
  assert.equal(V.isUuid(ID), true);
  assert.equal(V.isUuid(ID.toUpperCase()), true);
  for (const bad of ['abc', '', undefined, null, 5, ID + 'x']) assert.equal(V.isUuid(bad), false);
});
