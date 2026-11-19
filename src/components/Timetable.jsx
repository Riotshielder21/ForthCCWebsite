import React, { useEffect, useRef, useState } from 'react';
import { Apple, Calendar, CalendarClock, CalendarPlus, X } from 'lucide-react';
import { apiFetch, apiUrl } from '../utils/api';
import { readPublicSnapshot, savePublicSnapshot } from '../utils/publicSnapshots';
import { seasonLabel, timeLabel, WEEKDAYS } from '../utils/timetable';

/** The club's regular weekly sessions, as set by admins under Reports & records → Sessions & timetable. */
export default function Timetable({ emptyMessage = '' }) {
  const [snapshot] = useState(() => readPublicSnapshot('timetable'));
  const [days, setDays] = useState(snapshot?.days || null);
  const [offline, setOffline] = useState(false);
  const [copyStatus, setCopyStatus] = useState(null);
  const [calendarSession, setCalendarSession] = useState(null);
  const firstAction = useRef(null);

  useEffect(() => {
    if (!calendarSession) return undefined;
    const returnFocus = document.activeElement;
    firstAction.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') setCalendarSession(null);
      if (event.key === 'Tab') {
        const dialog = firstAction.current?.closest('[role="dialog"]');
        const controls = [...(dialog?.querySelectorAll('button:not(:disabled), a[href]') || [])];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      returnFocus?.focus();
    };
  }, [calendarSession]);

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

  const subscriptionUrl = (id) => new URL(apiUrl(`/api/timetable/${encodeURIComponent(id)}.ics`), window.location.origin).toString();
  const copySubscriptionUrl = async (session, service) => {
    const url = subscriptionUrl(session.id);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
      await navigator.clipboard.writeText(url);
      setCopyStatus({ id: session.id, service, message: service === 'Google Calendar'
        ? 'Subscription link copied. In Google Calendar, choose Other calendars → From URL and paste the link.'
        : 'Subscription link copied. In Apple Calendar, choose File → New Calendar Subscription and paste the link.' });
    } catch (error) {
      console.error(`Could not copy the timetable subscription link for ${service}:`, error);
      setCopyStatus({ id: session.id, service, message: 'Could not copy the subscription link. Allow clipboard access in your browser and try again.' });
    }
  };

  return <section className="main_tile SpaceT6 Timetable" aria-labelledby="timetable-heading">
    <span className="tile_eyebrow"><CalendarClock className="IconSm" /> Regular sessions</span>
    <h3 id="timetable-heading" className="tile_heading_bold_2">Weekly timetable</h3>
    <p className="text_container TimetableCalendarHelp">Choose Add to Calendar on a session to add its next occurrence or subscribe to its weekly schedule.</p>
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
              {session.id && <span className="TimetableCalendarActions">
                <button className="TimetableCalendarLink TimetableAddCalendar" type="button"
                  onClick={() => { setCopyStatus(null); setCalendarSession(session); }}>
                  <CalendarPlus size={16} aria-hidden="true" /> Add to Calendar
                </button>
              </span>}
            </span>
          </li>)}
        </ul>
      </div>)}
    </div>
    {calendarSession && <div className="ReportsModalBackdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setCalendarSession(null);
    }}>
      <section className="ReportsDialog TimetableCalendarDialog" role="dialog" aria-modal="true" aria-labelledby="calendar-dialog-title"
        aria-describedby="calendar-dialog-description">
        <div className="AdminListHeader">
          <div>
            <h3 id="calendar-dialog-title" className="tile_heading_bold_1"><Calendar size={22} /> Add to Calendar</h3>
            <p id="calendar-dialog-description" className="text_container">{calendarSession.name} · {WEEKDAYS[calendarSession.weekday]}</p>
          </div>
          <button type="button" className="EditorIconButton" onClick={() => setCalendarSession(null)} aria-label="Close calendar options">
            <X size={18} />
          </button>
        </div>
        <div className="TimetableCalendarChoices">
          <a ref={firstAction} className="TimetableCalendarChoice" href={apiUrl(`/api/timetable/${encodeURIComponent(calendarSession.id)}/next.ics`)} download>
            <CalendarPlus size={20} aria-hidden="true" />
            <span><strong>Add next session</strong><small>Add just the next occurrence as a calendar event.</small></span>
          </a>
          <a className="TimetableCalendarChoice" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(subscriptionUrl(calendarSession.id))}`}
            target="_blank" rel="noreferrer">
            <span className="CalendarGoogleLogo" aria-hidden="true">G</span>
            <span><strong>Subscribe in Google Calendar</strong><small>Subscribe to this session’s weekly schedule.</small></span>
          </a>
          <button className="TimetableCalendarChoice" type="button" onClick={() => copySubscriptionUrl(calendarSession, 'Apple Calendar')}>
            <Apple size={20} aria-hidden="true" />
            <span><strong>Subscribe in Apple Calendar</strong><small>Copy this session’s subscription link for Apple Calendar.</small></span>
          </button>
        </div>
        {copyStatus && copyStatus.id === calendarSession.id && <div className="TimetableCalendarCopyStatus" role="status">
          <p>{copyStatus.message}</p>
        </div>}
      </section>
    </div>}
  </section>;
}
