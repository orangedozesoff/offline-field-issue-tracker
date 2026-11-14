// Pure request validation shared by every route. No database, no Express.
// Each validator returns { ok, value, fields }: value holds cleaned data, fields holds
// one message per bad field (sent to the client as 400 { error, fields }).

const CATEGORIES = ['Water point', 'Equipment', 'Service interruption', 'Safety', 'Maintenance', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const ROLES = ['field_worker', 'coordinator'];
// Events a device may upload. Status events are written only by the server.
const DEVICE_EVENT_TYPES = ['created', 'edited', 'synced', 'sync_failed'];
const EDITABLE_FIELDS = ['description', 'location_text', 'latitude', 'longitude', 'priority'];
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_EVENTS = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const done = (value, fields) => ({ ok: Object.keys(fields).length === 0, value, fields });

function text(raw, min, max, label) {
  if (typeof raw !== 'string') return { error: `${label} must be text` };
  const s = raw.trim();
  if (s.length < min || s.length > max) return { error: `${label} must be ${min} to ${max} characters` };
  return { value: s };
}

const textRule = (name, min, max, label) => (body, f, v) => {
  const r = text(body[name], min, max, label);
  if (r.error) f[name] = r.error;
  else v[name] = r.value;
};

const oneOfRule = (name, list) => (body, f, v) => {
  if (list.includes(body[name])) v[name] = body[name];
  else f[name] = 'Must be one of: ' + list.join(', ');
};

const RULES = {
  description: textRule('description', 5, 1000, 'Description'),
  location_text: textRule('location_text', 2, 200, 'Location'),
  reporter_name: textRule('reporter_name', 2, 60, 'Reporter name'),
  category: oneOfRule('category', CATEGORIES),
  priority: oneOfRule('priority', PRIORITIES),
};

function coordinates(body, f, v) {
  const hasLat = body.latitude !== undefined && body.latitude !== null;
  const hasLng = body.longitude !== undefined && body.longitude !== null;
  if (hasLat !== hasLng) {
    f.latitude = f.longitude = 'Provide both latitude and longitude, or neither';
    return;
  }
  if (!hasLat) {
    v.latitude = null;
    v.longitude = null;
    return;
  }
  const { latitude: lat, longitude: lng } = body;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) f.latitude = 'Must be a number from -90 to 90';
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) f.longitude = 'Must be a number from -180 to 180';
  if (!f.latitude && !f.longitude) {
    v.latitude = lat;
    v.longitude = lng;
  }
}

function timestamp(raw, name, f, v, now, rejectFuture) {
  const ms = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (Number.isNaN(ms)) f[name] = 'Must be a valid ISO date and time';
  else if (rejectFuture && ms > now + MAX_FUTURE_MS) f[name] = 'Cannot be more than 5 minutes in the future';
  else v[name] = new Date(ms).toISOString();
}

function uuid(raw, name, f, v) {
  if (typeof raw === 'string' && UUID_RE.test(raw)) v[name] = raw.toLowerCase();
  else f[name] = 'Must be a valid UUID';
}

// Device-uploaded activity events (optional array on create and edit).
function validateDeviceEvents(raw, now = Date.now()) {
  const f = {};
  const out = [];
  if (raw === undefined || raw === null) return done(out, f);
  if (!Array.isArray(raw)) return done(out, { events: 'Must be a list' });
  if (raw.length > MAX_EVENTS) return done(out, { events: `At most ${MAX_EVENTS} events per request` });
  raw.forEach((e, i) => {
    const p = `events[${i}]`;
    if (!isObject(e)) {
      f[p] = 'Must be an object';
      return;
    }
    const v = {};
    uuid(e.id, 'id', f, v);
    if (f.id) {
      f[`${p}.id`] = f.id;
      delete f.id;
    }
    if (!DEVICE_EVENT_TYPES.includes(e.type)) f[`${p}.type`] = 'Must be one of: ' + DEVICE_EVENT_TYPES.join(', ');
    else v.type = e.type;
    const tf = {};
    timestamp(e.occurred_at, 'occurred_at', tf, v, now, false);
    if (tf.occurred_at) f[`${p}.occurred_at`] = tf.occurred_at;
    if (e.message === undefined || e.message === null) v.message = null;
    else {
      const m = text(e.message, 1, 500, 'Message');
      if (m.error) f[`${p}.message`] = m.error;
      else v.message = m.value;
    }
    out.push(v);
  });
  return done(out, f);
}

function validateCreate(body, now = Date.now()) {
  if (!isObject(body)) return done({}, { body: 'Must be a JSON object' });
  const f = {};
  const v = {};
  uuid(body.id, 'id', f, v);
  for (const rule of Object.values(RULES)) rule(body, f, v);
  coordinates(body, f, v);
  timestamp(body.reported_at, 'reported_at', f, v, now, true);
  const ev = validateDeviceEvents(body.events, now);
  Object.assign(f, ev.fields);
  v.events = ev.value;
  return done(v, f);
}

function validateEdit(body, now = Date.now()) {
  if (!isObject(body)) return done({}, { body: 'Must be a JSON object' });
  const f = {};
  const v = {};
  if (!Number.isInteger(body.base_version) || body.base_version < 1) f.base_version = 'Must be a whole number, 1 or more';
  else v.base_version = body.base_version;
  for (const name of ['description', 'location_text', 'priority']) {
    if (body[name] !== undefined) RULES[name](body, f, v);
  }
  if ('latitude' in body || 'longitude' in body) coordinates(body, f, v);
  if (!EDITABLE_FIELDS.some((k) => k in v)) f.body = 'Provide at least one field to change';
  const ev = validateDeviceEvents(body.events, now);
  Object.assign(f, ev.fields);
  v.events = ev.value;
  return done(v, f);
}

// Shape check only; whether the move is allowed is decided by validateTransition.
function validateStatusInput(body) {
  if (!isObject(body)) return done({}, { body: 'Must be a JSON object' });
  const f = {};
  const v = {};
  if (typeof body.to !== 'string' || body.to.trim() === '') f.to = 'Required';
  else v.to = body.to.trim();
  for (const [name, max] of [['assigned_to', 60], ['reason', 500], ['resolution_note', 1000]]) {
    if (body[name] === undefined || body[name] === null) continue;
    const r = text(body[name], 1, max, name);
    if (r.error) f[name] = r.error;
    else v[name] = r.value;
  }
  return done(v, f);
}

// Simulated identity: X-Role and X-Actor headers (Node lowercases header names).
function validateActor(headers = {}) {
  const f = {};
  const v = {};
  if (!ROLES.includes(headers['x-role'])) f['x-role'] = 'Must be one of: ' + ROLES.join(', ');
  else v.role = headers['x-role'];
  const r = text(headers['x-actor'], 2, 60, 'X-Actor');
  if (r.error) f['x-actor'] = r.error;
  else v.actor = r.value;
  return done(v, f);
}

module.exports = {
  CATEGORIES, PRIORITIES, ROLES, DEVICE_EVENT_TYPES,
  validateCreate, validateEdit, validateStatusInput, validateActor, validateDeviceEvents,
};
