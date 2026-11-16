import { useEffect, useState } from 'react';
import { PriorityBadge, StatusBadge, SyncBadge } from './Badges.jsx';
import StatusPanel from './StatusPanel.jsx';
import Timeline from './Timeline.jsx';
import { formatTime } from './format.js';
import { actorFor } from './identity.js';
import { failureKind } from '../lib/workflow.js';

export default function ReportDetail({ app, report, identity, onClose, onEdit, notify }) {
  const [timeline, setTimeline] = useState({ events: [], offline: false });
  const isCoordinator = identity.role === 'coordinator';
  const failed = report.sync_state === 'Failed';
  const kind = failed ? failureKind(report) : null;

  useEffect(() => {
    let alive = true;
    app.timeline(report.id, actorFor(identity)).then((t) => { if (alive) setTimeline(t); });
    return () => { alive = false; };
  }, [app, report.id, report.updated_at, report.sync_state, report.version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = (promise, okMessage) => promise.then((res) => {
    if (res && res.ok === false) notify(res.message || `Could not do that (${res.error}).`);
    else if (okMessage) notify(okMessage);
  });

  const isDraft = report.status === 'Draft';
  const canEdit = !isCoordinator && ((isDraft) || (report.status === 'Submitted' && (!failed || kind === 'fix')));
  const onServer = !isDraft && report.version >= 1;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Report details" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn ghost close" onClick={onClose}>Close</button>
        <h2>{report.category || 'Draft report'}</h2>
        <div className="badges">
          <StatusBadge status={report.status} /> <SyncBadge report={report} />
          {report.priority && <PriorityBadge priority={report.priority} />}
        </div>
        <p className="desc-full">{report.description || 'No description yet'}</p>
        <dl className="facts">
          <dt>Location</dt><dd>{report.location_text || '—'}{report.latitude !== null && report.latitude !== undefined ? ` (${report.latitude}, ${report.longitude})` : ''}</dd>
          <dt>Reported</dt><dd>{formatTime(report.reported_at)} by {report.reporter_name || '—'}</dd>
          {report.assigned_to && (<><dt>Assigned to</dt><dd>{report.assigned_to}</dd></>)}
          {report.resolution_note && (<><dt>Resolution</dt><dd>{report.resolution_note}</dd></>)}
        </dl>

        {report.sync_state === 'Pending' && (
          <div className="notice-box">
            <p>Saved on this device. It will be sent automatically when the connection is back.</p>
            {report.last_error && <p className="hint">Last attempt: {report.last_error.message}</p>}
            <button type="button" className="btn secondary" onClick={() => app.syncNow()}>Sync now</button>
          </div>
        )}

        {failed && (
          <div className="warn" role="alert">
            <p><strong>Not synchronized.</strong> {report.last_error?.message}</p>
            {report.last_error?.fields && (
              <ul>{Object.entries(report.last_error.fields).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
            )}
            {kind === 'retry' && <button type="button" className="btn" onClick={() => run(app.reports.retryFailed(report.id), 'Trying again.').then(() => app.syncNow())}>Retry</button>}
            {kind === 'fix' && <p className="hint">Edit the report to correct it, then it is sent again.</p>}
            {kind === 'conflict' && (
              <>
                <p className="hint">Someone changed this report on the server. Your edit was not applied and is still shown above.</p>
                <button type="button" className="btn" onClick={() => run(app.reports.resolveConflict(report.id, 'copy'), 'Your text was saved as a new draft.')}>Keep my text as a new draft</button>
                <button type="button" className="btn secondary" onClick={() => run(app.reports.resolveConflict(report.id, 'discard'), 'Showing the server version.')}>Discard my change</button>
              </>
            )}
          </div>
        )}

        <div className="actions">
          {canEdit && <button type="button" className="btn" onClick={() => onEdit(report)}>{failed ? 'Fix and retry' : isDraft ? 'Edit draft' : 'Edit'}</button>}
          {isDraft && <button type="button" className="btn secondary" onClick={() => { if (window.confirm('Delete this draft?')) run(app.reports.deleteDraft(report.id)).then(onClose); }}>Delete draft</button>}
        </div>

        {isCoordinator && onServer && <StatusPanel app={app} report={report} identity={identity} onResult={notify} />}
        {isCoordinator && !onServer && !isDraft && <p className="hint">This report has not reached the server yet, so its status cannot be changed.</p>}

        {!isDraft && <Timeline events={timeline.events} offline={timeline.offline} />}
      </div>
    </div>
  );
}
