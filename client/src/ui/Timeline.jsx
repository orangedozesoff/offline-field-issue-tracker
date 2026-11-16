import { formatTime } from './format.js';

const LABEL = {
  created: 'Created', edited: 'Edited', synced: 'Synchronized', sync_failed: 'Sync problem',
  status_changed: 'Status changed', reopened: 'Reopened', rejected: 'Rejected',
};

export default function Timeline({ events, offline }) {
  return (
    <section aria-label="Activity history">
      <h3>Activity history</h3>
      {offline && <p className="hint">Offline: showing what is saved on this device.</p>}
      {!events.length && <p className="hint">No activity recorded yet.</p>}
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id} data-testid="timeline-item">
            <strong>{LABEL[e.type] || e.type}</strong>
            {e.from_status && e.to_status && <span> · {e.from_status} → {e.to_status}</span>}
            <span className="hint"> · {formatTime(e.occurred_at)}{e.actor ? ` · ${e.actor}` : ''}</span>
            {e.message && <p className="timeline-msg">{e.message}</p>}
            {e.pendingUpload && <span className="badge sync-pending">not uploaded yet</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
