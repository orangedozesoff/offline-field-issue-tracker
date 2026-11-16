import { useState } from 'react';
import { allowedMoves, moveLabel, neededField } from '../lib/workflow.js';
import { actorFor } from './identity.js';

// Coordinator workflow change. Needs a connection; the server decides if the move is valid.
export default function StatusPanel({ app, report, identity, onResult }) {
  const moves = allowedMoves(report.status);
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const need = to ? neededField(report.status, to) : null;

  if (!moves.length) return <p className="hint">No further status changes are possible from {report.status}.</p>;

  async function apply() {
    setError('');
    setBusy(true);
    const body = { to };
    if (need) body[need.name] = text;
    const res = await app.changeStatus(report.id, body, actorFor(identity));
    setBusy(false);
    if (res.ok) { setTo(''); setText(''); onResult(`Status changed to ${to}.`); return; }
    if (res.offline) setError('You are offline. Status changes need a connection.');
    else if (res.error?.fields) setError(Object.values(res.error.fields).join(' '));
    else setError(res.error?.error || 'The server refused this change.');
  }

  return (
    <section aria-label="Change status">
      <h3>Change status</h3>
      <label>Move to
        <select value={to} onChange={(e) => { setTo(e.target.value); setText(''); setError(''); }}>
          <option value="">Choose…</option>
          {moves.map((m) => <option key={m} value={m}>{moveLabel(report.status, m)}</option>)}
        </select>
      </label>
      {need && <label>{need.label}<input value={text} onChange={(e) => setText(e.target.value)} maxLength={need.max} /></label>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="button" className="btn" disabled={!to || busy} onClick={apply}>Apply change</button>
    </section>
  );
}
