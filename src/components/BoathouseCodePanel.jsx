import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { BOATHOUSE_ACCESS_POINTS, BOATHOUSE_LIMITS } from '../utils/boathouse';

/** Current boathouse access codes, kept server-side and only visible to admins. */
export default function BoathouseCodePanel({ adminUser }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState({ gateCode: '', gateNote: '', alarmCode: '', alarmNote: '', lockboxCode: '', lockboxNote: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const request = useCallback(async (options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl('/api/admin/boathouse-code'), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);

  useEffect(() => {
    request().then((result) => {
      setSaved(result);
      setDraft(result);
    }).catch((loadError) => setError(loadError.message));
  }, [request]);

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const result = await request({ method: 'POST', body: JSON.stringify(draft) });
      setSaved(result);
      setDraft(result);
      const notice = result.notified?.error ? ' Key-access holders could not be emailed; save again to retry.'
        : result.notified?.sent || result.notified?.failed
          ? ` Emailed to ${result.notified.sent} key-access holder${result.notified.sent === 1 ? '' : 's'}${result.notified.failed ? `; ${result.notified.failed} could not be emailed (save again to retry)` : ''}.`
          : '';
      setMessage(`${result.changed ? 'Boathouse access codes saved.' : 'Notes saved; the codes are unchanged.'}${notice}`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="main_tile SpaceT6" onSubmit={save}>
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Volunteering</span><h3 className="tile_heading_bold_2">Boathouse access codes</h3></div></div>
      <p className="text_container SpaceB4">Codes are kept on the server and only shown to admins. Changing any code emails all three codes to everyone with key access, unless an admin has revoked their access. Induction adds key access to a volunteer's member record. Previously disclosed codes cannot be recalled: rotate the codes after revoking access.</p>
      {BOATHOUSE_ACCESS_POINTS.map(({ key, label }) => (
        <div key={key} className="SpaceB4">
          <h4 className="FormLabel">{label}</h4>
          <label className="FormLabel">{label} code<input className="FormInput" required maxLength={BOATHOUSE_LIMITS.code} autoComplete="off" value={draft[`${key}Code`]}
            onChange={(event) => setDraft({ ...draft, [`${key}Code`]: event.target.value })} /></label>
          <label className="FormLabel">Note (optional)<textarea className="FormInput" rows="2" maxLength={BOATHOUSE_LIMITS.note} value={draft[`${key}Note`]}
            onChange={(event) => setDraft({ ...draft, [`${key}Note`]: event.target.value })} /></label>
        </div>
      ))}
      {saved?.updatedAt > 0 && <p className="text_container text_container_note">Last changed {new Date(saved.updatedAt).toLocaleString('en-GB')} by {saved.updatedBy}.</p>}
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      <button className="FormSubmitButton" type="submit" disabled={saving}><KeyRound className="IconMd" /> Save boathouse access codes</button>
    </form>
  );
}
