import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import { MONTHS, seasonLabel, sortTimetableSessions, TIMETABLE_LIMITS, WEEK_ORDER, WEEKDAYS } from '../utils/timetable';

const blankSession = () => ({ key: Math.random().toString(36).slice(2), name: '', discipline: '', weekday: '', start: '', end: '',
  seasonStart: '', seasonEnd: '', location: '', notes: '', active: true });
const withKeys = (sessions) => sessions.map((session) => ({ ...session, key: Math.random().toString(36).slice(2),
  weekday: String(session.weekday), seasonStart: session.seasonStart ? String(session.seasonStart) : '', seasonEnd: session.seasonEnd ? String(session.seasonEnd) : '' }));

/** The public weekly timetable shown on the Disciplines page. Separate from check-in sessions. */
export default function TimetablePanel({ adminUser }) {
  const [saved, setSaved] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const request = useCallback(async (options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await apiFetch(apiUrl('/api/admin/timetable'), { ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Timetable request failed.');
    if (!Array.isArray(result.sessions)) throw new Error('Invalid timetable response.');
    return result;
  }, [adminUser]);
  const load = (result) => {
    const next = withKeys(result.sessions);
    setSaved(result);
    setSessions(next);
    setSelectedIndex((current) => Math.min(current, Math.max(next.length - 1, 0)));
    setError('');
  };

  useEffect(() => {
    let active = true;
    request().then((result) => {
      if (active) load(result);
    }).catch((loadError) => {
      if (active) setError(loadError.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [request]);

  const retryLoad = async () => {
    setLoading(true);
    try {
      load(await request());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      load(await request({ method: 'PUT', body: JSON.stringify({ sessions: sessions.map(({ key: _key, ...session }) => ({ ...session,
        weekday: Number(session.weekday), seasonStart: session.seasonStart ? Number(session.seasonStart) : null, seasonEnd: session.seasonEnd ? Number(session.seasonEnd) : null })) }) }));
      setMessage('Timetable saved. The Disciplines page shows it straight away.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };
  const update = (index, changes) => setSessions((current) => current.map((session, position) => position === index ? { ...session, ...changes } : session));
  const set = (index, field) => (event) => update(index, { [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const selectedSession = sessions[selectedIndex] || null;
  const sessionOptions = sortTimetableSessions(sessions);
  const addSession = () => {
    setSessions((current) => [...current, blankSession()]);
    setSelectedIndex(sessions.length);
  };
  const removeSession = () => {
    const next = sessions.filter((_, index) => index !== selectedIndex);
    setSessions(next);
    setSelectedIndex(Math.max(0, Math.min(selectedIndex, next.length - 1)));
  };

  return <section className="main_tile SpaceT6">
    <div className="AdminListHeader"><div><span className="tile_eyebrow">Public website</span><h3 className="tile_heading_bold_2">Weekly timetable</h3></div></div>
    <p className="text_container SpaceB4">The club's regular sessions, shown to everyone at the bottom of the Disciplines page, grouped by day in time order. Untick "Show on the website" to hide a session without deleting it. This does not change check-ins; one-off events and courses stay in the shop.</p>
    <form onSubmit={save}>
      <div className="TimetableSessionPicker">
        <label className="FormLabel">Session
          <select className="FormInput" aria-label="Choose a timetable session" value={selectedSession ? selectedIndex : ''} disabled={!sessions.length || busy}
            onChange={(event) => setSelectedIndex(Number(event.target.value))}>
            {sessionOptions.map(({ session, index }) => <option key={session.key} value={index}>
              {[session.name || 'New session', session.weekday === '' ? '' : WEEKDAYS[Number(session.weekday)], session.start,
                session.seasonStart ? seasonLabel(session) : ''].filter(Boolean).join(' · ')}{session.active ? '' : ' (hidden)'}
            </option>)}
          </select>
        </label>
        <button type="button" className="EditorCommand" disabled={!saved || busy || sessions.length >= TIMETABLE_LIMITS.sessions} onClick={addSession}>Add session</button>
        {selectedSession && <span className="text_container text_container_note">{selectedIndex + 1} of {sessions.length}</span>}
      </div>
      {selectedSession && <fieldset className="CheckinSessionCard" key={selectedSession.key}>
        <legend className="FormLabel">{selectedSession.name || 'New session'}{!selectedSession.active && ' (hidden)'}</legend>
        <div className="CheckinSessionFields">
          <label className="FormLabel">Session name<input className="FormInput" placeholder="For example, Polo training" maxLength={TIMETABLE_LIMITS.name} required value={selectedSession.name} onChange={set(selectedIndex, 'name')} /></label>
          <label className="FormLabel">Discipline (optional)<input className="FormInput" placeholder="For example, Canoe polo" maxLength={TIMETABLE_LIMITS.discipline} value={selectedSession.discipline} onChange={set(selectedIndex, 'discipline')} /></label>
          <label className="FormLabel">Day<select className="FormInput" required value={selectedSession.weekday} onChange={set(selectedIndex, 'weekday')}>
            <option value="">Choose a day…</option>
            {WEEK_ORDER.map((day) => <option key={day} value={day}>{WEEKDAYS[day]}</option>)}
          </select></label>
          <div className="AdminEventTimes">
            <label className="FormLabel">Starts<input className="FormInput" type="time" required value={selectedSession.start} onChange={set(selectedIndex, 'start')} /></label>
            <label className="FormLabel">Ends (optional)<input className="FormInput" type="time" min={selectedSession.start || undefined} value={selectedSession.end} onChange={set(selectedIndex, 'end')} /></label>
          </div>
          <div className="AdminEventTimes">
            <label className="FormLabel">Season from<select className="FormInput" value={selectedSession.seasonStart} onChange={set(selectedIndex, 'seasonStart')}>
              <option value="">All year</option>{MONTHS.map((name, month) => <option key={name} value={month + 1}>{name}</option>)}
            </select></label>
            <label className="FormLabel">Season to<select className="FormInput" value={selectedSession.seasonEnd} onChange={set(selectedIndex, 'seasonEnd')} required={Boolean(selectedSession.seasonStart)}>
              <option value="">All year</option>{MONTHS.map((name, month) => <option key={name} value={month + 1}>{name}</option>)}
            </select></label>
          </div>
          <label className="FormLabel">Location (optional)<input className="FormInput" placeholder="For example, Harrison Park" maxLength={TIMETABLE_LIMITS.location} value={selectedSession.location} onChange={set(selectedIndex, 'location')} /></label>
          <label className="FormLabel">Note (optional)<input className="FormInput" placeholder="For example, members only" maxLength={TIMETABLE_LIMITS.notes} value={selectedSession.notes} onChange={set(selectedIndex, 'notes')} /></label>
        </div>
        <div className="CheckinSessionOptions">
          <label className="CheckinSessionOption"><input type="checkbox" checked={selectedSession.active} onChange={set(selectedIndex, 'active')} /> Show on the website</label>
        </div>
        <div className="CheckinSessionActions">
          <button type="button" className="EditorCommand TileRemove" onClick={removeSession}>Remove session</button>
        </div>
      </fieldset>}
      {!sessions.length && saved && <p className="text_container">No regular sessions yet, so the Disciplines page does not show a timetable.</p>}
      {saved?.updatedAt > 0 && <p className="text_container text_container_note SpaceT4">Last changed {new Date(saved.updatedAt).toLocaleString('en-GB')} by {saved.updatedBy}.</p>}
      {saved && !saved.updatedAt && <p className="text_container text_container_note SpaceT4">These are the starting sessions, taken from the old Disciplines tile text; nothing has been saved yet. Check the summer and winter months for Sprint & marathon.</p>}
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}
      {error && <div>
        <p className="StatusText StatusTextError" role="alert">{error}</p>
        {!saved && <button type="button" className="EditorCommand" disabled={loading} onClick={retryLoad}>{loading ? 'Loading…' : 'Try again'}</button>}
      </div>}
      <div className="CheckinSessionSaveActions">
        <button type="submit" className="EditorCommand" disabled={!saved || busy || loading}><CalendarClock size={16} /> {busy ? 'Saving…' : 'Save timetable'}</button>
      </div>
    </form>
  </section>;
}
