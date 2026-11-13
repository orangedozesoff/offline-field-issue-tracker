// Single source of truth for the report workflow. Pure functions, no database.
// 'Draft' exists only on the device, so it is not part of the server workflow.

const STATUSES = ['Submitted', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];

const TRANSITIONS = {
  Submitted: ['Assigned', 'Rejected'],
  Assigned: ['In Progress', 'Rejected'],
  'In Progress': ['Resolved'],
  Resolved: ['In Progress'], // reopen
  Rejected: [], // terminal
};

// Field that must be present (non-blank) for a given from -> to move.
function requiredField(from, to) {
  if (to === 'Assigned') return 'assigned_to';
  if (to === 'Rejected') return 'reason';
  if (to === 'Resolved') return 'resolution_note';
  if (from === 'Resolved' && to === 'In Progress') return 'reason'; // reopen
  return null;
}

function allowedFrom(status) {
  return TRANSITIONS[status] ? [...TRANSITIONS[status]] : [];
}

// Returns { ok: true, eventType } or
// { ok: false, httpStatus, code, message, allowed?, fields? }
function validateTransition(from, to, input = {}) {
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'UNKNOWN_STATUS',
      message: 'Unknown status.',
      fields: { status: 'Must be one of: ' + STATUSES.join(', ') },
    };
  }
  if (!TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      httpStatus: 409,
      code: 'INVALID_TRANSITION',
      message: `Cannot move a report from ${from} to ${to}.`,
      from,
      to,
      allowed: allowedFrom(from),
    };
  }
  const field = requiredField(from, to);
  const value = field ? input[field] : null;
  if (field && (typeof value !== 'string' || value.trim() === '')) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'MISSING_FIELD',
      message: `${field} is required to move to ${to}.`,
      fields: { [field]: 'Required' },
    };
  }
  let eventType = 'status_changed';
  if (to === 'Rejected') eventType = 'rejected';
  if (from === 'Resolved' && to === 'In Progress') eventType = 'reopened';
  return { ok: true, eventType };
}

module.exports = { STATUSES, TRANSITIONS, allowedFrom, validateTransition };
