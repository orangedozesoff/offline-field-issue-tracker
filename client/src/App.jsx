import { useEffect, useMemo, useState } from 'react';
import ReportDetail from './ui/ReportDetail.jsx';
import ReportForm from './ui/ReportForm.jsx';
import ReportList from './ui/ReportList.jsx';
import { actorFor, loadIdentity, saveIdentity } from './ui/identity.js';
import { useSnapshot } from './ui/useSnapshot.js';
import { STATUSES } from './lib/workflow.js';

export default function App({ app }) {
  const { reports, counts } = useSnapshot(app);
  const [identity, setIdentity] = useState(loadIdentity);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [form, setForm] = useState(null); // null | { existing }
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ status: '', sync: '' });

  useEffect(() => { saveIdentity(identity); }, [identity]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  // Pull coordinator updates and other devices' reports: at start, when back online, every 30 s.
  useEffect(() => {
    const who = actorFor(identity);
    const pull = () => { app.refreshFromServer(who); };
    pull();
    const timer = setInterval(pull, 30000);
    window.addEventListener('online', pull);
    return () => { clearInterval(timer); window.removeEventListener('online', pull); };
  }, [app, identity.role, identity.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const shown = useMemo(() => reports.filter((r) =>
    (!filters.status || r.status === filters.status) &&
    (!filters.sync || (r.status !== 'Draft' && (r.sync_state || 'Synchronized') === filters.sync))), [reports, filters]);
  const open = reports.find((r) => r.id === openId) || null;
  const isCoordinator = identity.role === 'coordinator';

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1>Field Issue Tracker</h1>
          <span className={`pill ${online ? 'online' : 'offline'}`} data-testid="online-pill">{online ? 'Online' : 'Offline'}</span>
        </div>
        <div className="top-row ident">
          <label>I am a
            <select value={identity.role} onChange={(e) => setIdentity({ ...identity, role: e.target.value })} data-testid="role-select">
              <option value="field_worker">Field worker</option>
              <option value="coordinator">Coordinator</option>
            </select>
          </label>
          <label>My name
            <input value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} maxLength={60} placeholder="Your name" data-testid="name-input" />
          </label>
        </div>
        <div className="counts" aria-label="Sync summary">
          <span className="badge sync-pending">Pending {counts.pending}</span>
          <span className="badge sync-synchronized">Synchronized {counts.synchronized}</span>
          <span className="badge sync-failed">Failed {counts.failed}</span>
          <span className="badge sync-draft">Drafts {counts.drafts}</span>
        </div>
        {!online && <p className="banner">You are offline. Reports are saved on this device and will sync automatically.</p>}
      </header>

      {notice && <p className="toast" role="status" data-testid="notice">{notice}</p>}

      <main>
        {form ? (
          <ReportForm app={app} identity={identity} existing={form.existing}
            onCancel={() => setForm(null)}
            onDone={(msg) => { setForm(null); setOpenId(null); setNotice(msg); }} />
        ) : (
          <>
            <div className="toolbar">
              {!isCoordinator && <button type="button" className="btn" onClick={() => setForm({ existing: null })} data-testid="new-report">New report</button>}
              <button type="button" className="btn secondary" onClick={() => app.refreshFromServer(actorFor(identity)).then((r) => setNotice(r.ok ? 'Updated from the server.' : r.offline ? 'Offline: showing saved reports.' : 'Could not update from the server.'))}>Refresh</button>
            </div>
            <div className="filters">
              <label>Status
                <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label>Sync
                <select value={filters.sync} onChange={(e) => setFilters({ ...filters, sync: e.target.value })}>
                  <option value="">All</option><option>Pending</option><option>Synchronized</option><option>Failed</option>
                </select>
              </label>
            </div>
            <ReportList reports={shown} onOpen={setOpenId} />
          </>
        )}
      </main>

      {open && !form && (
        <ReportDetail app={app} report={open} identity={identity}
          onClose={() => setOpenId(null)} onEdit={(r) => setForm({ existing: r })} notify={setNotice} />
      )}
    </div>
  );
}
