import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import { MONTHS, TIMETABLE_LIMITS, WEEK_ORDER, WEEKDAYS } from '../utils/timetable';

const blankSession = () => ({ key: Math.random().toString(36).slice(2), name: '', discipline: '', weekday: '', start: '', end: '',
  seasonStart: '', seasonEnd: '', location: '', notes: '', active: true });
const withKeys = (sessions) => sessions.map((session) => ({ ...session, key: Math.random().toString(36).slice(2),
  weekday: String(session.weekday), seasonStart: session.seasonStart ? String(session.seasonStart) : '', seasonEnd: session.seasonEnd ? String(session.seasonEnd) : '' }));

/** The public weekly timetable shown on the Disciplines page. Separate from check-in sessions. */
export default function TimetablePanel({ adminUser }) {
  const [saved, setSaved] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await apiFetch(apiUrl('/api/admin/timetable'), { ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Timetable request failed.');
    return result;
  }, [adminUser]);
  const load = (result) => {
    setSaved(result);
    setSessions(withKeys(result.sessions));
  };

  useEffect(() => {
    request().then(load).catch((loadError) => setError(loadError.message));
  }, [request]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      load(await request({ method: 'PUT', body: JSON.stringify({ sessions: sessions.map(({ key: _key, ...session }) => ({ ...session,
        weekday: Number(session.weekday), seasonStart: session.seasonStart ? Number(session.seasonStart) : null, seasonEnd: session.seasonEnd ? Number(session.seasonEnd) : null })) }) }));
      setMessage('Timetable saved. The What\'s on and Disciplines pages show it straight away.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };
  const update = (index, changes) => setSessions((current) => current.map((session, position) => position === index ? { ...session, ...changes } : session));
  const set = (index, field) => (event) => update(index, { [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });

  return <section className="main_tile SpaceT6">
    <div className="AdminListHeader"><div><span className="tile_eyebrow">Public website</span><h3 className="tile_heading_bold_2">Weekly timetable</h3></div></div>
    <p className="text_container SpaceB4">The club's regular sessions, shown to everyone at the bottom of the Disciplines page, grouped by day in time order. Untick "Show on the website" to hide a session without deleting it. This does not change check-ins; one-off events and courses stay in the shop.</p>
    <form onSubmit={save}>
      {sessions.map((session, index) => <fieldset className="CheckinSessionCard" key={session.key}>
        <legend className="FormLabel">{session.name || 'New session'}{!session.active && ' (hidden)'}</legend>
        <div className="CheckinSessionFields">
          <label className="FormLabel">Session name<input className="FormInput" placeholder="For example, Polo training" maxLength={TIMETABLE_LIMITS.name} required value={session.name} onChange={set(index, 'name')} /></label>
          <label className="FormLabel">Discipline (optional)<input className="FormInput" placeholder="For example, Canoe polo" maxLength={TIMETABLE_LIMITS.discipline} value={session.discipline} onChange={set(index, 'discipline')} /></label>
          <label className="FormLabel">Day<select className="FormInput" required value={session.weekday} onChange={set(index, 'weekday')}>
            <option value="">Choose a day…</option>
            {WEEK_ORDER.map((day) => <option key={day} value={day}>{WEEKDAYS[day]}</option>)}
          </select></label>
          <div className="AdminEventTimes">
            <label className="FormLabel">Starts<input className="FormInput" type="time" required value={session.start} onChange={set(index, 'start')} /></label>
            <label className="FormLabel">Ends (optional)<input className="FormInput" type="time" min={session.start || undefined} value={session.end} onChange={set(index, 'end')} /></label>
          </div>
          <div className="AdminEventTimes">
            <label className="FormLabel">Season from<select className="FormInput" value={session.seasonStart} onChange={set(index, 'seasonStart')}>
              <option value="">All year</option>{MONTHS.map((name, month) => <option key={name} value={month + 1}>{name}</option>)}
            </select></label>
            <label className="FormLabel">Season to<select className="FormInput" value={session.seasonEnd} onChange={set(index, 'seasonEnd')} required={Boolean(session.seasonStart)}>
              <option value="">All year</option>{MONTHS.map((name, month) => <option key={name} value={month + 1}>{name}</option>)}
            </select></label>
          </div>
          <label className="FormLabel">Location (optional)<input className="FormInput" placeholder="For example, Harrison Park" maxLength={TIMETABLE_LIMITS.location} value={session.location} onChange={set(index, 'location')} /></label>
          <label className="FormLabel">Note (optional)<input className="FormInput" placeholder="For example, members only" maxLength={TIMETABLE_LIMITS.notes} value={session.notes} onChange={set(index, 'notes')} /></label>
        </div>
        <div className="CheckinSessionOptions">
          <label className="CheckinSessionOption"><input type="checkbox" checked={session.active} onChange={set(index, 'active')} /> Show on the website</label>
        </div>
        <div className="CheckinSessionActions">
          <button type="button" className="EditorCommand TileRemove" onClick={() => setSessions((current) => current.filter((_, position) => position !== index))}>Remove session</button>
        </div>
      </fieldset>)}
      {!sessions.length && saved && <p className="text_container">No regular sessions yet, so the Disciplines page does not show a timetable.</p>}
      {saved?.updatedAt > 0 && <p className="text_container text_container_note SpaceT4">Last changed {new Date(saved.updatedAt).toLocaleString('en-GB')} by {saved.updatedBy}.</p>}
      {saved && !saved.updatedAt && <p className="text_container text_container_note SpaceT4">These are the starting sessions, taken from the old Disciplines tile text; nothing has been saved yet. Check the summer and winter months for Sprint & marathon.</p>}
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      <div className="CheckinSessionSaveActions">
        <button type="button" className="EditorCommand" disabled={!saved || busy || sessions.length >= TIMETABLE_LIMITS.sessions} onClick={() => setSessions((current) => [...current, blankSession()])}>Add session</button>
        <button type="submit" className="EditorCommand" disabled={!saved || busy}><CalendarClock size={16} /> {busy ? 'Saving…' : 'Save timetable'}</button>
      </div>
    </form>
  </section>;
}
