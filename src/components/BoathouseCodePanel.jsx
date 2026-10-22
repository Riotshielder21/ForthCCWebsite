import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { BOATHOUSE_LIMITS } from '../utils/boathouse';

/** The current boathouse access code, kept server-side and only visible to admins. */
export default function BoathouseCodePanel({ adminUser }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState({ code: '', note: '' });
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
      setDraft({ code: result.code, note: result.note });
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
      setDraft({ code: result.code, note: result.note });
      const notice = result.notified?.error ? ' Active volunteers could not be emailed; save again to retry.'
        : result.notified?.sent || result.notified?.failed
          ? ` Emailed to ${result.notified.sent} active volunteer${result.notified.sent === 1 ? '' : 's'}${result.notified.failed ? `; ${result.notified.failed} could not be emailed (save again to retry)` : ''}.`
          : '';
      setMessage(result.changed ? `Boathouse code saved.${notice}` : 'Note saved; the code is unchanged.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="main_tile SpaceT6" onSubmit={save}>
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Volunteering</span><h3 className="tile_heading_bold_2">Boathouse code</h3></div></div>
      <p className="text_container SpaceB4">The current boathouse access code. It is kept on the server and only shown to admins. Changing the code emails it to every active volunteer (inducted, an active member, and ticked "Active" under Volunteer sign-ups).</p>
      <label className="FormLabel">Code<input className="FormInput" required maxLength={BOATHOUSE_LIMITS.code} autoComplete="off" value={draft.code}
        onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label>
      <label className="FormLabel">Note (optional, e.g. which door or padlock)<textarea className="FormInput" rows="2" maxLength={BOATHOUSE_LIMITS.note} value={draft.note}
        onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
      {saved?.updatedAt > 0 && <p className="text_container text_container_note">Last changed {new Date(saved.updatedAt).toLocaleString('en-GB')} by {saved.updatedBy}.</p>}
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      <button className="FormSubmitButton" type="submit" disabled={saving}><KeyRound className="IconMd" /> Save boathouse code</button>
    </form>
  );
}
