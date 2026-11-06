import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';
import { WEEKDAYS, MAX_CHECKIN_SESSIONS } from '../utils/clubNight';

const blankSession = () => ({ key: Math.random().toString(36).slice(2), id: '', name: '', frequency: 'weekly', startDate: '', endDate: '', start: '', end: '', boatHire: false, subscriptions: false, selfAssessment: false });
const withKeys = (sessions) => sessions.map((session) => ({
  ...session,
  key: session.id,
  frequency: session.recurrence?.frequency || 'legacy-weekly',
  startDate: session.recurrence?.startDate || '',
  endDate: session.recurrence?.endDate || '',
  weekday: String(session.weekday ?? ''),
  // Older sessions listed individual subscription products; any of them now means "show subscriptions".
  subscriptions: Array.isArray(session.subscriptions) ? session.subscriptions.length > 0 : session.subscriptions === true,
  selfAssessment: session.selfAssessment === true
}));

export default function CheckinSessionsPanel({ adminUser }) {
  const [sessions, setSessions] = useState([]);
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
    request('/api/admin/club-night').then((result) => setSessions(withKeys(result.sessions || []))).catch((error) => setStatus(error.message));
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

  return <section className="main_tile">
    <h3 className="tile_heading_bold_2">Check-in sessions</h3>
    <p className="text_container_note">Check-ins at /check-ins and volunteer access are open all day on each session date, until midnight UK time. Times describe the session, not the access window. Previous sessions are never shown to volunteers.</p>
    <form className="SpaceB4" onSubmit={save}>
      {sessions.map((session, index) => <fieldset className="CheckinSessionCard" key={session.key}>
        <legend className="FormLabel">{session.name || 'New session'}</legend>
        <div className="CheckinSessionFields">
          <label className="FormLabel CheckinSessionName">Session name<input className="FormInput" placeholder="For example, Club night" maxLength="60" required value={session.name} onChange={set(index, 'name')} /></label>
          <label className="FormLabel">Repeats
            <select className="FormInput" value={session.frequency} onChange={set(index, 'frequency')}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              {session.frequency === 'legacy-weekly' && <option value="legacy-weekly">Existing weekly weekday schedule</option>}
            </select>
          </label>
          {session.frequency === 'legacy-weekly' && <label className="FormLabel">Weekday<select className="FormInput" required value={session.weekday} onChange={set(index, 'weekday')}>
              <option value="">Choose a weekday…</option>
              {WEEKDAYS.map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}
            </select></label>}
          {session.frequency !== 'legacy-weekly' && <div className="AdminEventTimes">
            <label className="FormLabel">First date<input className="FormInput" type="date" required value={session.startDate} onChange={set(index, 'startDate')} /></label>
            <label className="FormLabel">Last date<input className="FormInput" type="date" required min={session.startDate || undefined} value={session.endDate} onChange={set(index, 'endDate')} /></label>
          </div>}
          <label className="FormLabel">Starts<input className="FormInput" type="time" required value={session.start} onChange={set(index, 'start')} /></label>
          <label className="FormLabel">Ends<input className="FormInput" type="time" required value={session.end} onChange={set(index, 'end')} /></label>
        </div>
        <div className="CheckinSessionOptions">
          <label className="CheckinSessionOption"><input type="checkbox" checked={session.boatHire} onChange={set(index, 'boatHire')} /> Show boat hire</label>
          <label className="CheckinSessionOption"><input type="checkbox" checked={session.subscriptions} onChange={set(index, 'subscriptions')} /> Show subscriptions</label>
          <label className="CheckinSessionOption"><input type="checkbox" checked={session.selfAssessment} onChange={set(index, 'selfAssessment')} /> Show self-assessment checklist</label>
        </div>
        <div className="CheckinSessionActions">
          <button type="button" className="EditorCommand TileRemove" onClick={() => setSessions(sessions.filter((_, position) => position !== index))}>Remove session</button>
        </div>
      </fieldset>)}
      {!sessions.length && <p className="text_container">No check-in sessions yet.</p>}
      <div className="CheckinSessionSaveActions">
        <button type="button" className="EditorCommand" disabled={sessions.length >= MAX_CHECKIN_SESSIONS || busy} onClick={() => setSessions([...sessions, blankSession()])}>Add session</button>
        <button type="submit" className="EditorCommand" disabled={busy}>{busy ? 'Saving…' : 'Save sessions'}</button>
      </div>
    </form>
    {status && <p role="status">{status}</p>}
  </section>;
}
