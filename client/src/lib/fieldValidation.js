// Client-side copy of the server's report rules, used for instant feedback and before
// queuing a submit. The server stays the authority.

export const CATEGORIES = ['Water point', 'Equipment', 'Service interruption', 'Safety', 'Maintenance', 'Other'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const MAX_FUTURE_MS = 5 * 60 * 1000;

export function validateReportFields(input, now = Date.now()) {
  const fields = {};
  const value = {};

  const text = (key, min, max, label) => {
    const raw = input[key];
    if (typeof raw !== 'string') {
      fields[key] = `${label} is required`;
      return;
    }
    const s = raw.trim();
    if (s.length < min || s.length > max) fields[key] = `${label} must be ${min} to ${max} characters`;
    else value[key] = s;
  };
  const oneOf = (key, list, label) => {
    if (list.includes(input[key])) value[key] = input[key];
    else fields[key] = `Choose a ${label}`;
  };

  text('description', 5, 1000, 'Description');
  text('location_text', 2, 200, 'Location');
  text('reporter_name', 2, 60, 'Your name');
  oneOf('category', CATEGORIES, 'category');
  oneOf('priority', PRIORITIES, 'priority');

  const hasLat = input.latitude !== undefined && input.latitude !== null;
  const hasLng = input.longitude !== undefined && input.longitude !== null;
  if (hasLat !== hasLng) {
    fields.latitude = fields.longitude = 'Provide both latitude and longitude, or neither';
  } else if (!hasLat) {
    value.latitude = null;
    value.longitude = null;
  } else {
    const { latitude: lat, longitude: lng } = input;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) fields.latitude = 'Must be between -90 and 90';
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) fields.longitude = 'Must be between -180 and 180';
    if (!fields.latitude && !fields.longitude) {
      value.latitude = lat;
      value.longitude = lng;
    }
  }

  const ms = typeof input.reported_at === 'string' ? Date.parse(input.reported_at) : NaN;
  if (Number.isNaN(ms)) fields.reported_at = 'Must be a valid date and time';
  else if (ms > now + MAX_FUTURE_MS) fields.reported_at = 'Cannot be in the future';
  else value.reported_at = new Date(ms).toISOString();

  return { ok: Object.keys(fields).length === 0, fields, value };
}
