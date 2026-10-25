import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';
import { CHECK_TYPES } from '../utils/safeguarding';

export default function VolunteersPanel({ adminUser }) {
  const [volunteers, setVolunteers] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState('');
  const request = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl(path), { ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Volunteer request failed.');
    return result;
  }, [adminUser]);
  const load = useCallback(async () => {
    const result = await request('/api/admin/volunteers');
    setVolunteers(result.volunteers);
  }, [request]);
  useEffect(() => { load().catch((error) => setError(error.message)); }, [load]);
  const save = async (volunteer, path, body) => {
    setSaving(volunteer.id); setError(''); setMessage('');
    try {
      const result = await request(path, { method: 'PATCH', body: JSON.stringify(body) });
      const emailFailed = result.boathouseCode === 'not-sent';
      setMessage(`${volunteer.name}: saved.${emailFailed ? ' Boathouse codes could not be emailed; use Retry emails.' : ''}${result.outcome === 'awaiting-membership' ? ' Benefits will be available when linked to an active membership.' : ''}`);
      await load();
    } catch (error) { setError(error.message); }
    finally { setSaving(''); }
  };
  return <section className="main_tile SpaceT6">
    <h3 className="tile_heading_bold_2">Volunteer sign-ups</h3>
    <p className="text_container SpaceB4">Activate once induction is complete. Deactivation keeps their induction history. Benefits and yearly volunteer status are recorded on their membership; existing payments are unchanged. PVG and safeguarding become read-only statuses after JustGo synchronisation.</p>
    {error && <p className="StatusTextError" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="ReportsTableWrap"><table className="ReportsTable">
      <thead><tr><th>Volunteer</th><th>Club year</th><th>Hours</th><th>Inducted / active</th><th>PVG</th><th>Safeguarding</th></tr></thead>
      <tbody>{volunteers.map((volunteer) => <tr key={volunteer.id}>
        <td><strong>{volunteer.name}</strong><br />{volunteer.email}<br />{volunteer.memberStatus}
          {volunteer.items.length > 0 && <details><summary>Sign-up details</summary>{volunteer.items.join(' · ')}</details>}
          {!volunteer.memberId && <p>Not yet linked to a membership.</p>}
        </td>
        <td>{volunteer.clubYear}/{volunteer.clubYear + 1}</td>
        <td><select aria-label={`Hours for ${volunteer.name}`} value={volunteer.tier} disabled={saving === volunteer.id}
          onChange={(event) => save(volunteer, `/api/admin/volunteers/${volunteer.id}`, { tier: event.target.value })}>
          <option value="">Choose bracket</option>{['20', '40', '60'].map((tier) => <option key={tier} value={tier}>{tier}+</option>)}
        </select></td>
        <td><button type="button" className="EditorCommand" disabled={saving === volunteer.id || !volunteer.tier}
          onClick={() => save(volunteer, `/api/admin/volunteers/${volunteer.id}`, { active: !volunteer.active })}>
          {volunteer.active && volunteer.inducted ? 'Inducted / active — deactivate' : 'Confirm induction / activate'}
        </button>
          {volunteer.inducted && !volunteer.active && <small>Previously inducted</small>}
          {volunteer.active && (volunteer.benefitsEmailPending || volunteer.boathouseEmailPending) && <button type="button" className="EditorCommand" disabled={saving === volunteer.id}
            onClick={() => save(volunteer, `/api/admin/volunteers/${volunteer.id}`, { active: true })}>Retry emails</button>}
        </td>
        {Object.entries(CHECK_TYPES).map(([type, label]) => <td key={type}>
          {volunteer.checksSynced ? (volunteer.checks?.[type]?.source === 'justgo' ? volunteer.checks[type].label : 'Not supplied by JustGo')
            : <input className="FormInput" aria-label={`${label} expiry for ${volunteer.name}`} type="date" key={`${volunteer.id}-${type}-${volunteer.checks?.[type]?.expiresOn}`}
              defaultValue={volunteer.checks?.[type]?.expiresOn || ''} disabled={!volunteer.memberId || saving === volunteer.id}
              onBlur={(event) => {
                if (event.target.value !== (volunteer.checks?.[type]?.expiresOn || '')) save(volunteer, `/api/admin/memberships/${volunteer.memberId}/checks`, { [type]: event.target.value });
              }} />}
        </td>)}
      </tr>)}</tbody>
    </table></div>
    {!volunteers.length && !error && <p>No volunteer sign-ups yet.</p>}
  </section>;
}
