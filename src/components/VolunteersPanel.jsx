import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Mail, X } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { CHECK_TYPES } from '../utils/safeguarding';
import { WEEKDAYS, MAX_CHECKIN_SESSIONS } from '../utils/clubNight';
import { uniqueReportEmails } from '../utils/adminReports';

const blankSession = () => ({ key: Math.random().toString(36).slice(2), id: '', name: '', weekday: '', start: '', end: '', boatHire: false, subscriptions: [] });
const withKeys = (sessions) => sessions.map((session) => ({ ...session, key: session.id, weekday: String(session.weekday), subscriptions: session.subscriptions.map((entry) => entry.id) }));

function CheckinSessions({ request }) {
  const [sessions, setSessions] = useState([]);
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request('/api/admin/club-night').then((result) => {
      setSessions(withKeys(result.sessions || [])); setProducts(result.subscriptionProducts || []);
    }).catch((error) => setStatus(error.message));
  }, [request]);
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setStatus('');
    try {
      const body = { sessions: sessions.map(({ key, ...session }) => ({ ...session, weekday: Number(session.weekday) })) };
      const result = await request('/api/admin/club-night', { method: 'PUT', body: JSON.stringify(body) });
      setSessions(withKeys(result.sessions));
      setStatus('Check-in sessions saved.');
    } catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  };
  const update = (index, changes) => setSessions(sessions.map((session, position) => position === index ? { ...session, ...changes } : session));
  const set = (index, field) => (event) => update(index, { [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const toggleSubscription = (index, id) => (event) => {
    const current = sessions[index].subscriptions;
    update(index, { subscriptions: event.target.checked ? [...current, id] : current.filter((entry) => entry !== id) });
  };
  return <form className="SpaceB4" onSubmit={save}>
    <p className="FormLabel">Check-in sessions</p>
    <p className="text_container_note">Check-ins at /check-ins and volunteer access are open all day on each session's weekday, until midnight UK time. Times describe the session, not the access window. Earlier weeks are never shown to volunteers.</p>
    {sessions.map((session, index) => <fieldset className="SpaceY2" key={session.key}>
      <legend className="FormLabel">{session.name || 'New session'}</legend>
      <input className="FormInput" aria-label="Session name" placeholder="Session name, e.g. Club night" maxLength="60" required value={session.name} onChange={set(index, 'name')} />
      <select className="FormInput" aria-label={`${session.name || 'Session'} weekday`} required value={session.weekday} onChange={set(index, 'weekday')}>
        <option value="">Weekday…</option>
        {WEEKDAYS.map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}
      </select>
      <input className="FormInput" type="time" aria-label={`${session.name || 'Session'} starts`} required value={session.start} onChange={set(index, 'start')} />
      <input className="FormInput" type="time" aria-label={`${session.name || 'Session'} ends`} required value={session.end} onChange={set(index, 'end')} />
      <label><input type="checkbox" checked={session.boatHire} onChange={set(index, 'boatHire')} /> Show boat hire</label>
      {products.map((product) => <label key={product.id}>
        <input type="checkbox" checked={session.subscriptions.includes(product.id)} onChange={toggleSubscription(index, product.id)} /> Show {product.name} subscription
      </label>)}
      <button type="button" className="EditorCommand" onClick={() => setSessions(sessions.filter((_, position) => position !== index))}>Remove session</button>
    </fieldset>)}
    {!sessions.length && <p className="text_container">No check-in sessions yet.</p>}
    <div className="SpaceY2">
      <button type="button" className="EditorCommand" disabled={sessions.length >= MAX_CHECKIN_SESSIONS} onClick={() => setSessions([...sessions, blankSession()])}>Add session</button>
      <button type="submit" className="EditorCommand" disabled={busy}>{busy ? 'Saving…' : 'Save sessions'}</button>
    </div>
    {status && <p role="status">{status}</p>}
  </form>;
}

export default function VolunteersPanel({ adminUser }) {
  const [volunteers, setVolunteers] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState('');
  const [coordinatorEmail, setCoordinatorEmail] = useState('');
  const [coordinatorSaving, setCoordinatorSaving] = useState(false);
  const [levels, setLevels] = useState([]);
  const [selected, setSelected] = useState(null);
  const closeButton = useRef(null);
  const emails = uniqueReportEmails(volunteers);
  const selectedLevel = levels.find((level) => level.id === selected?.tier);
  useEffect(() => {
    if (!selected) return undefined;
    const returnFocus = document.activeElement;
    closeButton.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') setSelected(null);
      if (event.key === 'Tab') {
        const controls = [...(closeButton.current?.closest('[role="dialog"]')?.querySelectorAll('button, a[href]') || [])];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); returnFocus?.focus(); };
  }, [selected]);
  const copyEmails = async () => {
    setError(''); setMessage('');
    try {
      await navigator.clipboard.writeText(emails.join(', '));
      setMessage(`Copied ${emails.length} email address${emails.length === 1 ? '' : 'es'}. Paste into Gmail's Bcc field to keep recipients private.`);
    } catch (error) {
      setError(`Could not copy email addresses: ${error.message}`);
    }
  };
  const request = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl(path), { ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Volunteer request failed.');
    return result;
  }, [adminUser]);
  const load = useCallback(async () => {
    const [result, coordinator, benefits] = await Promise.all([
      request('/api/admin/volunteers'),
      request('/api/admin/volunteer-coordinator'),
      request('/api/volunteer-benefits')
    ]);
    setVolunteers(result.volunteers);
    setLevels(benefits.tiers);
    setCoordinatorEmail(coordinator.email);
  }, [request]);
  useEffect(() => { load().catch((error) => setError(error.message)); }, [load]);
  const saveCoordinator = async (event) => {
    event.preventDefault(); setCoordinatorSaving(true); setError(''); setMessage('');
    try {
      const result = await request('/api/admin/volunteer-coordinator', {
        method: 'PUT', body: JSON.stringify({ email: coordinatorEmail })
      });
      setCoordinatorEmail(result.email);
      setMessage(result.email ? 'Induction coordinator saved. New sign-ups will be emailed to this address.' : 'Induction email notifications are turned off.');
    } catch (error) { setError(error.message); }
    finally { setCoordinatorSaving(false); }
  };
  const retryInductionNotification = async (volunteer) => {
    setSaving(volunteer.id); setError(''); setMessage('');
    try {
      const result = await request(`/api/admin/volunteers/${volunteer.id}/notify-induction`, { method: 'POST' });
      setMessage(result.status === 'sent' ? `${volunteer.name}: induction coordinator notified.`
        : result.status === 'not-configured' ? 'Set the induction coordinator email above before retrying.'
          : `${volunteer.name}: the induction email could not be sent. Please check the email configuration and retry.`);
      await load();
    } catch (error) { setError(error.message); }
    finally { setSaving(''); }
  };
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
    <form className="SpaceB4" onSubmit={saveCoordinator}>
      <label className="FormLabel">Induction coordinator email
        <input className="FormInput" type="email" maxLength="254" value={coordinatorEmail}
          onChange={(event) => setCoordinatorEmail(event.target.value)} placeholder="volunteer.coordinator@example.org" />
      </label>
      <p className="text_container_note">New volunteer sign-ups are emailed to this address so someone can arrange their induction. Leave blank to turn off notifications.</p>
      <button type="submit" className="EditorCommand" disabled={coordinatorSaving}>
        {coordinatorSaving ? 'Saving…' : 'Save coordinator'}
      </button>
    </form>
    <CheckinSessions request={request} />
    {error && <p className="StatusTextError" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button type="button" className="EditorCommand SpaceB4" disabled={!emails.length} onClick={copyEmails}>
      <Mail size={18} /> Email all — copy addresses
    </button>
    <div className="ReportsTableWrap"><table className="ReportsTable">
      <thead><tr><th>Volunteer</th><th>Club year</th><th>Hours</th><th>Inducted / active</th><th>Induction email</th><th>PVG</th><th>Safeguarding</th><th>Details</th></tr></thead>
      <tbody>{volunteers.map((volunteer) => <tr key={volunteer.id}>
        <td><strong>{volunteer.name}</strong><br />{volunteer.memberStatus}
          {!volunteer.memberId && <p>Not yet linked to a membership.</p>}
        </td>
        <td>{volunteer.clubYear}/{volunteer.clubYear + 1}</td>
        <td><select aria-label={`Hours for ${volunteer.name}`} value={volunteer.tier} disabled={saving === volunteer.id}
          onChange={(event) => save(volunteer, `/api/admin/volunteers/${volunteer.id}`, { tier: event.target.value })}>
          <option value="">Choose level</option>{levels.map((level) => <option key={level.id} value={level.id}>{level.hours}+ {level.title}</option>)}
          {volunteer.tier && !levels.some((level) => level.id === volunteer.tier) && <option value={volunteer.tier} disabled>Deleted level</option>}
        </select></td>
        <td><button type="button" className="EditorCommand" disabled={saving === volunteer.id || !volunteer.tier}
          onClick={() => save(volunteer, `/api/admin/volunteers/${volunteer.id}`, { active: !volunteer.active })}>
          {volunteer.active && volunteer.inducted ? 'Inducted / active — deactivate' : 'Confirm induction / activate'}
        </button>
          {volunteer.inducted && !volunteer.active && <small>Previously inducted</small>}
          {volunteer.active && (volunteer.benefitsEmailPending || volunteer.boathouseEmailPending) && <button type="button" className="EditorCommand" disabled={saving === volunteer.id}
            onClick={() => save(volunteer, `/api/admin/volunteers/${volunteer.id}`, { active: true })}>Retry emails</button>}
        </td>
        <td>{volunteer.inductionNotificationStatus === 'sent' ? 'Sent' : volunteer.inductionNotificationStatus === 'not-configured' ? 'Coordinator not set' : 'Not sent'}
          {volunteer.inductionNotificationStatus !== 'sent' && <button type="button" className="EditorCommand" disabled={saving === volunteer.id}
            onClick={() => retryInductionNotification(volunteer)}>Retry induction email</button>}
        </td>
        {Object.entries(CHECK_TYPES).map(([type, label]) => <td key={type}>
          {volunteer.checksSynced ? (volunteer.checks?.[type]?.source === 'justgo' ? volunteer.checks[type].label : 'Not supplied by JustGo')
            : <input className="FormInput" aria-label={`${label} expiry for ${volunteer.name}`} type="date" key={`${volunteer.id}-${type}-${volunteer.checks?.[type]?.expiresOn}`}
              defaultValue={volunteer.checks?.[type]?.expiresOn || ''} disabled={!volunteer.memberId || saving === volunteer.id}
              onBlur={(event) => {
                if (event.target.value !== (volunteer.checks?.[type]?.expiresOn || '')) save(volunteer, `/api/admin/memberships/${volunteer.memberId}/checks`, { [type]: event.target.value });
              }} />}
        </td>)}
        <td className="ReportsActionsCell"><button type="button" className="EditorIconButton" title="Sign-up details"
          aria-label={`Sign-up details for ${volunteer.name}`} onClick={() => setSelected(volunteer)}><FileText size={16} /></button></td>
      </tr>)}</tbody>
    </table></div>
    {!volunteers.length && !error && <p>No volunteer sign-ups yet.</p>}
    {selected && <div className="ReportsModalBackdrop"><section className="ReportsDialog" role="dialog" aria-modal="true" aria-labelledby="volunteer-dialog-title">
      <div className="ReportsHeader">
        <h3 id="volunteer-dialog-title" className="tile_heading_bold_1">Volunteer sign-up details</h3>
        <button ref={closeButton} type="button" className="EditorIconButton" aria-label="Close volunteer details" onClick={() => setSelected(null)}><X size={18} /></button>
      </div>
      <dl className="ReportDetails">
        <dt>Name</dt><dd>{selected.name}</dd>
        <dt>Email</dt><dd><a className="ContentLink" href={`mailto:${selected.email}`}>{selected.email}</a></dd>
        <dt>Club year</dt><dd>{selected.clubYear}/{selected.clubYear + 1}</dd>
        <dt>Hours</dt><dd>{selectedLevel
          ? `${selectedLevel.hours}+ hours` : selected.tier ? 'Deleted level' : 'Not selected'}</dd>
        <dt>Additional notes</dt><dd className="whitespace-pre-line">{selected.notes || 'Not recorded'}</dd>
      </dl>
      <h4 className="FormLabel">Sign-up answers</h4>
      {selected.items.length ? <ul className="ReportItems">{selected.items.map((item, index) => <li className="whitespace-pre-line" key={index}>{item}</li>)}</ul>
        : <p className="text_container">No answers recorded.</p>}
    </section></div>}
  </section>;
}
