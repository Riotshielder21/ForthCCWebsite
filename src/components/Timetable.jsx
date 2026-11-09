import React from 'react';
import { WEEKDAYS } from '../utils/regularSessions';

export default function Timetable({ sessions = [], scheduleError = '' }) {
  return <section className="main_tile Timetable" aria-labelledby="timetable-heading">
    <span className="tile_eyebrow">Regular sessions</span>
    <h2 className="tile_heading_bold_2" id="timetable-heading">Timetable</h2>
    {scheduleError && <p className="ReportNotice" role="status">The live timetable could not be loaded. The times below may be out of date; please check with the club before travelling.</p>}
    {sessions.length ? <div className="TimetableList">
      {sessions.map((session) => <article className="TimetableItem" key={session.id}>
        <div>
          <h3 className="tile_heading_bold_2">{session.discipline}{session.name ? ` — ${session.name}` : ''}</h3>
          <p className="text_container">{WEEKDAYS[session.weekday]}{session.season ? ` · ${session.season}` : ''}</p>
        </div>
        <div className="TimetableDetails">
          <p className="text_container">{session.startTime}{session.endTime ? `–${session.endTime}` : ''}</p>
          {session.location && <p className="text_container">{session.location}</p>}
        </div>
      </article>)}
    </div> : <p className="text_container">No regular sessions have been published. Check Humanitix for upcoming open nights and public events.</p>}
    <p className="text_container text_container_note SpaceT4">Times are UK local time. Open nights and occasional public events are listed on <a className="ContentLink" href="https://events.humanitix.com/host/forth-canoe-club" target="_blank" rel="noreferrer">Humanitix</a>. Session times may change; contact the club to confirm before travelling.</p>
  </section>;
}
