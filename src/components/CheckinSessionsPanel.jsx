import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';
import { WEEKDAYS, MAX_CHECKIN_SESSIONS } from '../utils/clubNight';

const blankSession = () => ({ key: Math.random().toString(36).slice(2), id: '', name: '', frequency: 'weekly', startDate: '', endDate: '', start: '', end: '', boatHire: false, subscriptions: [] });
const withKeys = (sessions) => sessions.map((session) => ({
  ...session,
  key: session.id,
  frequency: session.recurrence?.frequency || 'legacy-weekly',
  startDate: session.recurrence?.startDate || '',
  endDate: session.recurrence?.endDate || '',
  weekday: String(session.weekday ?? ''),
  subscriptions: session.subscriptions.map((entry) => entry.id)
}));

export default function CheckinSessionsPanel({ adminUser }) {
  const [sessions, setSessions] = useState([]);
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl(path), { ...options,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Check-in session request failed.');
    return result;
  }, [adminUser]);

  useEffect(() => {
    request('/api/admin/club-night').then((result) => {
      setSessions(withKeys(result.sessions || []));
      setProducts(result.subscriptionProducts || []);
    }).catch((error) => setStatus(error.message));
  }, [request]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const body = { sessions: sessions.map(({ key, frequency, startDate, endDate, weekday, ...session }) => frequency === 'legacy-weekly'
        ? { ...session, weekday: Number(weekday) }
        : { ...session, recurrence: { frequency, startDate, endDate } }) };
      const result = await request('/api/admin/club-night', { method: 'PUT', body: JSON.stringify(body) });
      setSessions(withKeys(result.sessions));
      setStatus('Check-in sessions saved.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };
  const update = (index, changes) => setSessions(sessions.map((session, position) => position === index ? { ...session, ...changes } : session));
  const set = (index, field) => (event) => update(index, { [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const toggleSubscription = (index, id) => (event) => {
    const current = sessions[index].subscriptions;
    update(index, { subscriptions: event.target.checked ? [...current, id] : current.filter((entry) => entry !== id) });
  };

  return <section className="main_tile">
    <h3 className="tile_heading_bold_2">Check-in sessions</h3>
    <p className="text_container_note">Check-ins at /check-ins and volunteer access are open all day on each session date, until midnight UK time. Times describe the session, not the access window. Previous sessions are never shown to volunteers.</p>
    <form className="SpaceB4" onSubmit={save}>
      {sessions.map((session, index) => <fieldset className="SpaceY2" key={session.key}>
        <legend className="FormLabel">{session.name || 'New session'}</legend>
        <input className="FormInput" aria-label="Session name" placeholder="Session name, e.g. Club night" maxLength="60" required value={session.name} onChange={set(index, 'name')} />
        <label className="FormLabel">Repeats
          <select className="FormInput" value={session.frequency} onChange={set(index, 'frequency')}>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            {session.frequency === 'legacy-weekly' && <option value="legacy-weekly">Existing weekly weekday schedule</option>}
          </select>
        </label>
        {session.frequency === 'legacy-weekly' && <select className="FormInput" aria-label={(session.name || 'Session') + ' weekday'} required value={session.weekday} onChange={set(index, 'weekday')}>
            <option value="">Weekday…</option>
            {WEEKDAYS.map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}
          </select>}
        {session.frequency !== 'legacy-weekly' && <div className="AdminEventTimes">
            <label className="FormLabel">First date<input className="FormInput" type="date" required value={session.startDate} onChange={set(index, 'startDate')} /></label>
            <label className="FormLabel">Last date<input className="FormInput" type="date" required min={session.startDate || undefined} value={session.endDate} onChange={set(index, 'endDate')} /></label>
          </div>}
        <input className="FormInput" type="time" aria-label={(session.name || 'Session') + ' starts'} required value={session.start} onChange={set(index, 'start')} />
        <input className="FormInput" type="time" aria-label={(session.name || 'Session') + ' ends'} required value={session.end} onChange={set(index, 'end')} />
        <label><input type="checkbox" checked={session.boatHire} onChange={set(index, 'boatHire')} /> Show boat hire</label>
        {products.map((product) => <label key={product.id}>
          <input type="checkbox" checked={session.subscriptions.includes(product.id)} onChange={toggleSubscription(index, product.id)} /> Show {product.name} subscription
        </label>)}
        <button type="button" className="EditorCommand" onClick={() => setSessions(sessions.filter((_, position) => position !== index))}>Remove session</button>
      </fieldset>)}
      {!sessions.length && <p className="text_container">No check-in sessions yet.</p>}
      <div className="SpaceY2">
        <button type="button" className="EditorCommand" disabled={sessions.length >= MAX_CHECKIN_SESSIONS || busy} onClick={() => setSessions([...sessions, blankSession()])}>Add session</button>
        <button type="submit" className="EditorCommand" disabled={busy}>{busy ? 'Saving…' : 'Save sessions'}</button>
      </div>
    </form>
    {status && <p role="status">{status}</p>}
  </section>;
}
