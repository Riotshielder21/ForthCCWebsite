import React, { useCallback, useEffect, useState } from 'react';
import { Eye, Save, Send } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';

/**
 * When the event leader's attendee list was last sent, a button to send it now, the extra people who can open the list on
 * the check-in page (as well as the leader) and the list itself.
 */
export default function EventRosterControl({ adminUser, productId, saved }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [viewers, setViewers] = useState('');
  const [attendees, setAttendees] = useState(null);

  const call = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await apiFetch(apiUrl(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);
  const request = useCallback((options) => call(`/api/admin/events/${encodeURIComponent(productId)}/roster`, options), [call, productId]);
  const viewersPath = `/api/admin/events/${encodeURIComponent(productId)}/roster-viewers`;

  useEffect(() => {
    setStatus(null);
    setMessage('');
    setError('');
    setAttendees(null);
    request().then(setStatus).catch((loadError) => setError(loadError.message));
    if (saved) call(viewersPath).then((result) => setViewers(result.viewers.join('\n'))).catch((loadError) => setError(loadError.message));
  }, [request, call, viewersPath, saved]);

  const saveViewers = async () => {
    setError('');
    setMessage('');
    try {
      const result = await call(viewersPath, { method: 'PUT', body: JSON.stringify({ viewers: viewers.split(/[\s,;]+/).filter(Boolean) }) });
      setViewers(result.viewers.join('\n'));
      setMessage(result.viewers.length ? `${result.viewers.length} extra ${result.viewers.length === 1 ? 'person' : 'people'} can view the attendee list.` : 'Only the event leader can view the attendee list.');
    } catch (saveError) { setError(saveError.message); }
  };

  const toggleAttendees = async () => {
    if (attendees) return setAttendees(null);
    setError('');
    try { setAttendees((await call(`/api/event-rosters/${encodeURIComponent(productId)}`)).attendees); } catch (loadError) { setError(loadError.message); }
  };

  const send = async () => {
    setError('');
    setMessage('');
    setSending(true);
    try {
      const result = await request({ method: 'POST' });
      setMessage(`Attendee list (${result.attendees} ${result.attendees === 1 ? 'person' : 'people'}) sent to ${result.sentTo}.`);
      setStatus(await request());
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="AdminRosterControl">
      <p className="text_container text_container_note" role="status">
        {status?.sentAt
          ? `Attendee list last sent ${new Date(status.sentAt).toLocaleString('en-GB')} to ${status.sentTo} (${status.attendees} booked, ${status.trigger === 'admin' ? 'sent by an admin' : 'sent automatically'}).`
          : 'The attendee list has not been sent yet. It is sent automatically once bookings close.'}
      </p>
      <button type="button" className="EditorCommand" onClick={send} disabled={sending || !saved}><Send size={18} /> {sending ? 'Sending…' : 'Send attendee list now'}</button>
      {!saved && <p className="CartItemMeta">Save the leader's email first.</p>}
      {saved && <>
        <label className="FormLabel">Also allowed to view the attendee list
          <textarea className="FormInput" rows="2" value={viewers} placeholder="One email per line" onChange={(event) => setViewers(event.target.value)} />
        </label>
        <p className="CartItemMeta">The leader and these people can open the list on the check-in page, signing in with an email code, until the end of the event's last day.</p>
        <button type="button" className="EditorCommand" onClick={saveViewers}><Save size={18} /> Save viewers</button>
        <button type="button" className="EditorCommand" onClick={toggleAttendees} aria-expanded={Boolean(attendees)}><Eye size={18} /> {attendees ? 'Hide attendee list' : 'View attendee list'}</button>
        {attendees && (attendees.length ? <div className="ReportsTableWrap"><table className="ReportsTable">
          <thead><tr><th>Name</th><th>Membership</th><th>Non-member visits</th><th>First club night</th><th>Kit</th><th>Swimming</th><th>Medical</th><th>Emergency contact</th></tr></thead>
          <tbody>{attendees.map((person, index) => <tr key={`${person.name}-${index}`}>
            <td>{person.name}{person.kind === 'Under 18' ? ' (under 18)' : ''}</td><td>{person.membership || 'No'}</td><td>{person.nonMemberVisits}</td>
            <td>{typeof person.firstClubNight === 'boolean' ? (person.firstClubNight ? 'Yes' : 'No') : ''}</td>
            <td>{person.kit}</td><td>{person.swimming}</td><td>{person.medical}</td><td>{person.emergencyContact}</td>
          </tr>)}</tbody>
        </table></div> : <p className="text_container">Nobody has booked yet.</p>)}
      </>}
      {message && <p className="StatusText" role="status">{message}</p>}
      {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
    </div>
  );
}
