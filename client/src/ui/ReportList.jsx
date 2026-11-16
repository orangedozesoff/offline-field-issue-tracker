import { PriorityBadge, StatusBadge, SyncBadge } from './Badges.jsx';
import { formatTime } from './format.js';

export default function ReportList({ reports, onOpen }) {
  if (!reports.length) {
    return <p className="empty">No reports to show yet. Reports you create are saved on this device, even with no signal.</p>;
  }
  return (
    <ul className="list">
      {reports.map((r) => (
        <li key={r.id}>
          <button type="button" className="card" onClick={() => onOpen(r.id)} data-testid="report-card">
            <div className="card-top">
              <strong>{r.category || 'No category yet'}</strong>
              {r.priority && <PriorityBadge priority={r.priority} />}
            </div>
            <p className="desc">{r.description || 'No description yet'}</p>
            <p className="meta">{r.location_text || 'No location'} · {formatTime(r.reported_at)}</p>
            <div className="badges">
              <StatusBadge status={r.status} />
              <SyncBadge report={r} />
            </div>
            {r.sync_state === 'Failed' && <p className="err">{r.last_error?.message || 'Could not sync this report.'}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}
