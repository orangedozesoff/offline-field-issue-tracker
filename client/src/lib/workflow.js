// Display copy of the workflow rules (the server is the authority and re-checks every move).

export const STATUSES = ['Draft', 'Submitted', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];

export const TRANSITIONS = {
  Submitted: ['Assigned', 'Rejected'],
  Assigned: ['In Progress', 'Rejected'],
  'In Progress': ['Resolved'],
  Resolved: ['In Progress'],
  Rejected: [],
};

export const allowedMoves = (status) => TRANSITIONS[status] ?? [];

// The extra field a move needs, or null.
export function neededField(from, to) {
  if (to === 'Assigned') return { name: 'assigned_to', label: 'Assign to', max: 60 };
  if (to === 'Rejected') return { name: 'reason', label: 'Reason for rejecting', max: 500 };
  if (to === 'Resolved') return { name: 'resolution_note', label: 'What was done', max: 1000 };
  if (from === 'Resolved' && to === 'In Progress') return { name: 'reason', label: 'Reason for reopening', max: 500 };
  return null;
}

export const moveLabel = (from, to) => (from === 'Resolved' && to === 'In Progress' ? 'Reopen' : to);

// How the UI should treat a Failed report, from the error the engine stored.
export function failureKind(report) {
  const code = report.last_error?.code ?? '';
  if (code === 'LOCKED' || code === 'VERSION_CONFLICT') return 'conflict'; // choose discard or keep as new draft
  if (/^HTTP_(5\d\d|429|408)$/.test(code)) return 'retry'; // server trouble: just retry
  return 'fix'; // the server refused the content: edit and try again
}
