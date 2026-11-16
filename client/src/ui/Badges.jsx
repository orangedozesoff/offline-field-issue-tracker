export function SyncBadge({ report }) {
  if (report.status === 'Draft') return <span className="badge sync-draft">Draft · this device only</span>;
  const state = report.sync_state || 'Synchronized';
  return <span className={`badge sync-${state.toLowerCase()}`}>{state}</span>;
}

export const StatusBadge = ({ status }) => <span className={`badge status-${status.toLowerCase().replace(' ', '-')}`}>{status}</span>;

export const PriorityBadge = ({ priority }) => <span className={`badge prio-${priority.toLowerCase()}`}>{priority}</span>;
