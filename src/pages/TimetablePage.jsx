import React from 'react';
import Timetable from '../components/Timetable';

export default function TimetablePage({ regularSessions, regularSessionsError }) {
  return <div className="SectionBottom"><Timetable sessions={regularSessions} scheduleError={regularSessionsError} /></div>;
}
