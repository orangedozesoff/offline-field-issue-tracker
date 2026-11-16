import { useState } from 'react';
import { CATEGORIES, PRIORITIES, validateReportFields } from '../lib/fieldValidation.js';
import { formatTime } from './format.js';

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export default function ReportForm({ app, identity, existing, onDone, onCancel }) {
  const editingSubmitted = Boolean(existing && existing.status === 'Submitted');
  const [f, setF] = useState(() => ({
    category: existing?.category ?? '', priority: existing?.priority ?? 'Medium',
    description: existing?.description ?? '', location_text: existing?.location_text ?? '',
    latitude: existing?.latitude ?? '', longitude: existing?.longitude ?? '',
  }));
  const [draftId, setDraftId] = useState(existing?.status === 'Draft' ? existing.id : null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => { setF((p) => ({ ...p, [key]: e.target.value })); setDuplicate(null); };
  const values = () => ({ ...f, latitude: num(f.latitude), longitude: num(f.longitude), reporter_name: identity.name.trim() });

  function useMyLocation() {
    setMessage('');
    if (!navigator.geolocation) { setMessage('This device cannot share its location.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setF((p) => ({ ...p, latitude: lat, longitude: lng, location_text: p.location_text || `GPS ${lat}, ${lng}` }));
      },
      () => setMessage('Could not get the location. Type it instead.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // Draft: saved on the device only, may be incomplete.
  async function saveDraft() {
    setBusy(true);
    if (draftId) await app.reports.updateDraft(draftId, values());
    else await app.reports.createDraft(values());
    setBusy(false);
    onDone('Draft saved on this device.');
  }

  // Checks first, so an invalid or duplicate submit never leaves a stray draft behind.
  async function submit(confirmed = false) {
    setErrors({});
    if (!identity.name.trim()) { setErrors({ reporter_name: 'Enter your name at the top of the page first.' }); return; }
    const check = validateReportFields({ ...values(), reported_at: existing?.reported_at || new Date().toISOString() });
    if (!check.ok) { setErrors(check.fields); return; }
    setBusy(true);
    if (!confirmed) {
      const dup = await app.reports.findPossibleDuplicate(values(), draftId);
      if (dup) { setDuplicate(dup); setBusy(false); return; }
    }
    let id = draftId;
    if (id) await app.reports.updateDraft(id, values());
    else { id = (await app.reports.createDraft(values())).id; setDraftId(id); }
    const res = await app.reports.submitDraft(id);
    setBusy(false);
    if (!res.ok) { setErrors(res.fields || {}); return; }
    onDone('Report saved on this device. It will sync when you are online.');
  }

  async function saveChanges() {
    setErrors({});
    setBusy(true);
    const v = values();
    const res = await app.reports.editSubmitted(existing.id, {
      description: v.description, location_text: v.location_text, latitude: v.latitude, longitude: v.longitude, priority: v.priority,
    });
    setBusy(false);
    if (res.ok) { onDone('Change saved. It will sync when you are online.'); return; }
    if (res.error === 'VALIDATION') setErrors(res.fields);
    else if (res.error === 'NO_CHANGES') setMessage('Nothing was changed.');
    else setMessage(res.message || `Cannot edit this report (${res.error}).`);
  }

  const field = (name) => errors[name] && <span className="field-error" role="alert">{errors[name]}</span>;

  return (
    <form className="form" onSubmit={(e) => e.preventDefault()} noValidate>
      <h2>{editingSubmitted ? 'Edit report' : existing ? 'Edit draft' : 'New report'}</h2>
      <label>Category
        <select value={f.category} onChange={set('category')} disabled={editingSubmitted}>
          <option value="">Choose…</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        {field('category')}
      </label>
      <label>Priority
        <select value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
        {field('priority')}
      </label>
      <label>What is wrong?
        <textarea rows={4} value={f.description} onChange={set('description')} maxLength={1000} />
        {field('description')}
      </label>
      <label>Location
        <input value={f.location_text} onChange={set('location_text')} maxLength={200} placeholder="Village, landmark, well name…" />
        {field('location_text')}
      </label>
      <div className="row">
        <label>Latitude<input inputMode="decimal" value={f.latitude} onChange={set('latitude')} />{field('latitude')}</label>
        <label>Longitude<input inputMode="decimal" value={f.longitude} onChange={set('longitude')} />{field('longitude')}</label>
      </div>
      <button type="button" className="btn secondary" onClick={useMyLocation}>Use my location</button>
      <p className="hint">Reported by {identity.name.trim() || '(enter your name at the top)'} · {formatTime(existing?.reported_at || new Date().toISOString())}</p>
      {field('reporter_name')}
      {message && <p className="notice-inline" role="status">{message}</p>}

      {duplicate && (
        <div className="warn" role="alert">
          <p>This looks like a report already saved on this device ({formatTime(duplicate.reported_at)}). Send it again?</p>
          <button type="button" className="btn" onClick={() => submit(true)} disabled={busy}>Yes, submit anyway</button>
        </div>
      )}

      <div className="actions">
        {editingSubmitted
          ? <button type="button" className="btn" onClick={saveChanges} disabled={busy}>Save changes</button>
          : <>
              <button type="button" className="btn" onClick={() => submit(false)} disabled={busy}>Submit report</button>
              <button type="button" className="btn secondary" onClick={saveDraft} disabled={busy}>Save as draft</button>
            </>}
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
