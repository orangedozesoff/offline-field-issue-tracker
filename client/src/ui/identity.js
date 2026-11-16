// Simulated sign-in: role and name are remembered on the device (no passwords).
const KEY = 'field-tracker.identity';
const DEFAULT = { role: 'field_worker', name: '' };

export function loadIdentity() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && (v.role === 'field_worker' || v.role === 'coordinator') && typeof v.name === 'string') return v;
  } catch (_) { /* storage blocked or empty */ }
  return DEFAULT;
}

export function saveIdentity(identity) {
  try { localStorage.setItem(KEY, JSON.stringify(identity)); } catch (_) { /* ignore */ }
}

// Who the server sees for read and coordinator calls.
export const actorFor = (i) => ({ role: i.role, actor: i.name.trim() || (i.role === 'coordinator' ? 'Coordinator' : 'Field worker') });
