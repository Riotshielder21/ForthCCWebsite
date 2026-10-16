import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';

const OUTCOMES = {
  issued: 'Inducted — thank-you code issued and emailed.',
  'awaiting-membership': 'Inducted — the code will be emailed once they are an active member.',
  'awaiting-induction': 'Induction cleared.'
};

/** Volunteer sign-ups: ticking "Inducted" emails the thank-you code once the volunteer is also an active member. */
export default function VolunteersPanel({ adminUser }) {
  const [volunteers, setVolunteers] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');

  const request = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);

  const load = useCallback(async () => {
    try {
      setVolunteers((await request('/api/admin/volunteers')).volunteers);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  const setInducted = async (volunteer, inducted) => {
    setError('');
    setMessage('');
    setSaving(volunteer.id);
    try {
      const { outcome } = await request(`/api/admin/volunteers/${encodeURIComponent(volunteer.id)}`, { method: 'PATCH', body: JSON.stringify({ inducted }) });
      setMessage(`${volunteer.name}: ${OUTCOMES[outcome] || 'Saved.'}`);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="main_tile SpaceT6">
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Volunteering</span><h3 className="tile_heading_bold_2">Volunteer sign-ups</h3></div></div>
      <p className="text_container SpaceB4">Tick "Inducted" after a volunteer's induction. Their thank-you code is emailed once they are inducted and an active member; non-members get it when they join.</p>
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      {!volunteers.length && !error && <p className="text_container">No volunteer sign-ups yet.</p>}
      <ul className="SpaceY2">
        {volunteers.map((volunteer) => (
          <li key={volunteer.id} className="text_container">
            <div>
              <strong>{volunteer.name}</strong> · {volunteer.email} · <em>{volunteer.memberStatus}</em>
              {volunteer.items.length > 0 && <p className="text_container text_container_note">{volunteer.items.join(' · ')}</p>}
            </div>
            <label className="CheckoutCheck">
              <input type="checkbox" checked={volunteer.inducted} disabled={saving === volunteer.id || volunteer.codeIssued}
                onChange={(event) => setInducted(volunteer, event.target.checked)} /> Inducted
            </label>
            {volunteer.codeIssued && <span className="tile_eyebrow">{volunteer.codeEmailed ? 'Code emailed' : 'Code issued — email not sent'}</span>}
            {volunteer.codeIssued && !volunteer.codeEmailed && (
              <button type="button" className="PrimaryActionButtonCompact" disabled={saving === volunteer.id} onClick={() => setInducted(volunteer, true)}>Resend code email</button>
            )}
            {volunteer.inducted && !volunteer.codeIssued && (
              <button type="button" className="PrimaryActionButtonCompact" disabled={saving === volunteer.id} onClick={() => setInducted(volunteer, true)}>Check membership again</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
