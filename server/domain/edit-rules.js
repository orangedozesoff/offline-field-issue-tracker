// Who may edit what, decided by the report's current status. Pure, no database.
// Rule: any role may edit while the report is Submitted; after that, content is
// locked, except a coordinator may still change priority at any status.

function checkEditAllowed(role, status, changedKeys) {
  if (status === 'Submitted') return { ok: true };
  const priorityOnly = changedKeys.length > 0 && changedKeys.every((k) => k === 'priority');
  if (role === 'coordinator' && priorityOnly) return { ok: true };
  return {
    ok: false,
    code: 'LOCKED',
    message: `This report is ${status}; its content can no longer be edited.`,
  };
}

module.exports = { checkEditAllowed };
