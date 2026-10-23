import React, { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { apiUrl } from '../utils/api';

/** When the event leader's attendee list was last sent, and a button to send it now. */
export default function EventRosterControl({ adminUser, productId, saved }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const request = useCallback(async (options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl(`/api/admin/events/${encodeURIComponent(productId)}/roster`), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser, productId]);

  useEffect(() => {
    setStatus(null);
    setMessage('');
    setError('');
    request().then(setStatus).catch((loadError) => setError(loadError.message));
  }, [request]);

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
      {message && <p className="StatusText" role="status">{message}</p>}
      {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
    </div>
  );
}
