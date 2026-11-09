import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiUrl } from '../utils/api';
import { MAX_REGULAR_SESSIONS, WEEKDAYS } from '../utils/regularSessions';

const blankSession = () => ({
  id: `new-${crypto.randomUUID()}`, discipline: '', name: '', weekday: 1, startTime: '', endTime: '',
  season: '', location: '', active: true
});

export default function RegularSessionsPanel({ adminUser }) {
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const request = useCallback(async (method = 'GET', body) => {
    const token = await adminUser.getIdToken();
    const response = await apiFetch(apiUrl('/api/admin/regular-sessions'), {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Regular-session request failed.');
    if (!Array.isArray(result.sessions)) throw new Error('Invalid regular-session response.');
    return result.sessions;
  }, [adminUser]);

  useEffect(() => {
    let active = true;
    request().then((result) => { if (active) setSessions(result); })
      .catch((error) => { if (active) setStatus(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  const update = (index, changes) => setSessions((current) => current.map((session, position) =>
    position === index ? { ...session, ...changes } : session));
  const field = (index, name) => (event) => update(index, {
    [name]: event.target.type === 'checkbox' ? event.target.checked
      : name === 'weekday' ? Number(event.target.value) : event.target.value
  });
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      setSessions(await request('PUT', { sessions }));
      setStatus('Timetable saved.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="main_tile">
    <h3 className="tile_heading_bold_2">Regular timetable</h3>
    <p className="text_container_note">These recurring discipline sessions appear on the public timetable; times are saved as UK local time. Use the season field for a note such as “April–October”. Open nights and other one-off public events remain listed on Humanitix.</p>
    {loading ? <p className="text_container" role="status">Loading timetable settings…</p> : <form className="RegularSessionsEditor" onSubmit={save}>
      {sessions.map((session, index) => <fieldset className="CheckinSessionCard" key={session.id}>
        <legend className="FormLabel">{session.discipline || 'New session'}</legend>
        <div className="CheckinSessionFields">
          <label className="FormLabel">Discipline<input className="FormInput" maxLength="60" required value={session.discipline} onChange={field(index, 'discipline')} /></label>
          <label className="FormLabel">Session label (optional)<input className="FormInput" maxLength="60" value={session.name} onChange={field(index, 'name')} /></label>
          <label className="FormLabel">Day<select className="FormInput" value={session.weekday} onChange={field(index, 'weekday')}>{WEEKDAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label>
          <label className="FormLabel">Starts<input className="FormInput" type="time" required value={session.startTime} onChange={field(index, 'startTime')} /></label>
          <label className="FormLabel">Ends (optional)<input className="FormInput" type="time" value={session.endTime} onChange={field(index, 'endTime')} /></label>
          <label className="FormLabel">Season (optional)<input className="FormInput" maxLength="60" placeholder="For example, April–October" value={session.season} onChange={field(index, 'season')} /></label>
          <label className="FormLabel">Location (optional)<input className="FormInput" maxLength="100" value={session.location} onChange={field(index, 'location')} /></label>
        </div>
        <div className="CheckinSessionOptions">
          <label className="CheckinSessionOption"><input type="checkbox" checked={session.active} onChange={field(index, 'active')} /> Show on public timetable</label>
          <button type="button" className="EditorCommand TileRemove" onClick={() => setSessions((current) => current.filter((_, position) => position !== index))}>Remove session</button>
        </div>
      </fieldset>)}
      {!sessions.length && <p className="text_container">No regular sessions configured.</p>}
      <div className="CheckinSessionSaveActions">
        <button type="button" className="EditorCommand" disabled={sessions.length >= MAX_REGULAR_SESSIONS || busy} onClick={() => setSessions((current) => [...current, blankSession()])}>Add session</button>
        <button type="submit" className="EditorCommand" disabled={busy}>{busy ? 'Saving…' : 'Save timetable'}</button>
      </div>
    </form>}
    {status && <p role="status">{status}</p>}
  </section>;
}
