import React, { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { apiFetch, apiUrl } from '../utils/api';
import { readPublicSnapshot, savePublicSnapshot } from '../utils/publicSnapshots';
import { seasonLabel, timeLabel } from '../utils/timetable';

/** The club's regular weekly sessions, as set by admins under Reports & records → Sessions & timetable. */
export default function Timetable({ emptyMessage = '' }) {
  const [snapshot] = useState(() => readPublicSnapshot('timetable'));
  const [days, setDays] = useState(snapshot?.days || null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch(apiUrl('/api/timetable')).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load the timetable.');
      if (!active) return;
      setDays(result.days);
      setOffline(false);
      savePublicSnapshot('timetable', result);
    }).catch((error) => {
      console.error('Live timetable unavailable:', error);
      if (active) setOffline(true);
    });
    return () => { active = false; };
  }, []);

  if (days === null) return offline ? null : <p className="text_container SpaceT6" role="status">Loading timetable…</p>;
  // Nothing to show until admins publish sessions, so the section stays hidden rather than looking empty.
  if (!days.length) return emptyMessage ? <p className="text_container SpaceT6">{emptyMessage}</p> : null;

  return <section className="main_tile SpaceT6 Timetable" aria-labelledby="timetable-heading">
    <span className="tile_eyebrow"><CalendarClock className="IconSm" /> Regular sessions</span>
    <h3 id="timetable-heading" className="tile_heading_bold_2">Weekly timetable</h3>
    {offline && <p className="text_container text_container_note" role="status">The live timetable is unavailable, so a previously downloaded copy is shown. It may be out of date.</p>}
    <div className="TimetableDays">
      {days.map((day) => <div key={day.weekday} className="TimetableDay">
        <h4 className="TimetableDayName">{day.day}</h4>
        <ul className="TimetableSessions">
          {day.sessions.map((session, index) => <li key={index} className="TimetableSession">
            <span className="TimetableTime">{timeLabel(session)}</span>
            <span className="TimetableDetails">
              <strong>{session.name}</strong>{session.discipline && <span className="TimetableTag">{session.discipline}</span>}
              <span className="TimetableMeta">{[session.location, seasonLabel(session)].filter(Boolean).join(' · ')}</span>
              {session.notes && <span className="TimetableMeta">{session.notes}</span>}
            </span>
          </li>)}
        </ul>
      </div>)}
    </div>
  </section>;
}
