import React from 'react';
import { WEEKDAYS } from '../utils/regularSessions';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function Timetable({ sessions = [], scheduleError = '' }) {
  return <section className="main_tile Timetable" aria-labelledby="timetable-heading">
    <h2 className="tile_heading_bold_2" id="timetable-heading">Regular session Timetable</h2>
    {scheduleError && <p className="ReportNotice" role="status">The live timetable could not be loaded. The times below may be out of date; please check with the club before travelling.</p>}
    {sessions.length ? <div className="TimetableWeek" aria-label="Weekly timetable, Monday to Sunday">
      {WEEK_ORDER.map((weekday) => {
        const daySessions = sessions.filter((session) => session.weekday === weekday)
          .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.discipline.localeCompare(b.discipline));
        return <section className="TimetableDay" key={weekday} aria-labelledby={`timetable-day-${weekday}`}>
          <h3 className="TimetableDayHeading" id={`timetable-day-${weekday}`}>{WEEKDAYS[weekday]}</h3>
          <div className="TimetableDayEvents">
            {daySessions.length ? daySessions.map((session) => <article className="TimetableEvent" key={session.id}>
              <h4 className="TimetableEventTitle">{session.discipline}{session.name ? ` — ${session.name}` : ''}</h4>
              <p className="TimetableEventTime">{session.startTime}{session.endTime ? `–${session.endTime}` : ''}</p>
              <p className="TimetableEventLocation">{session.location || 'Location to be confirmed'}</p>
              {session.season && <p className="TimetableEventSeason">{session.season}</p>}
            </article>) : <span className="TimetableEmptyDay">—</span>}
          </div>
        </section>;
      })}
    </div> : <p className="text_container">No regular sessions have been published. Check Humanitix for upcoming open nights and public events.</p>}
    <p className="text_container text_container_note SpaceT4">Times are UK local time. Open nights and occasional public events are listed on <a className="ContentLink" href="https://events.humanitix.com/host/forth-canoe-club" target="_blank" rel="noreferrer">Humanitix</a>. Session times may change; contact the club to confirm before travelling.</p>
  </section>;
}
