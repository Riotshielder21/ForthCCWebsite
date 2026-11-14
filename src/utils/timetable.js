export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const TIMETABLE_LIMITS = { sessions: 40, name: 60, discipline: 40, location: 80, notes: 140 };
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Monday first, as club members read a week.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const regular = (name, discipline, weekday, start, extra = {}) => ({ name, discipline, weekday, start, end: '', seasonStart: null, seasonEnd: null,
  location: '', notes: '', active: true, ...extra });
/** Used until admins first save the timetable: the times previously written into the Disciplines tiles. */
export const DEFAULT_TIMETABLE = [
  regular('Advanced polo', 'Canoe polo', 1, '18:00'),
  regular('Slalom training', 'Slalom', 2, '19:00', { location: 'On the canal' }),
  regular('Intermediate polo', 'Canoe polo', 3, '19:00'),
  regular('Sprint & marathon', 'Sprint & Marathon', 4, '18:00', { seasonStart: 4, seasonEnd: 9 }),
  regular('Beginner-friendly polo', 'Canoe polo', 5, '18:00'),
  regular('Sprint & marathon', 'Sprint & Marathon', 0, '14:00', { seasonStart: 10, seasonEnd: 3 })
];

const text = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const month = (value) => {
  if (value === '' || value === null || value === undefined) return { value: null };
  if (typeof value !== 'number' && typeof value !== 'string') return { error: true };
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? { value: parsed } : { error: true };
};

/** Checks the admin's regular sessions; returns `{ value }` with clean sessions or `{ error }`. */
export function validateTimetable(sessions) {
  if (!Array.isArray(sessions)) return { error: 'The timetable is not valid.' };
  if (sessions.length > TIMETABLE_LIMITS.sessions) return { error: `Keep the timetable to ${TIMETABLE_LIMITS.sessions} sessions or fewer.` };
  const value = [];
  for (const [index, session] of sessions.entries()) {
    const label = `Session ${index + 1}`;
    if (!session || typeof session !== 'object') return { error: `${label} is not valid.` };
    const name = text(session.name, TIMETABLE_LIMITS.name);
    if (!name) return { error: `${label} needs a name.` };
    const weekday = Number(session.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: `Choose a day for ${name}.` };
    if (!TIME.test(session.start || '')) return { error: `Enter a start time for ${name}.` };
    const end = session.end || '';
    if (end && (!TIME.test(end) || end <= session.start)) return { error: `${name} must end after it starts.` };
    const parsedSeasonStart = month(session.seasonStart);
    const parsedSeasonEnd = month(session.seasonEnd);
    if (parsedSeasonStart.error || parsedSeasonEnd.error) return { error: `Choose valid season months for ${name}.` };
    const seasonStart = parsedSeasonStart.value;
    const seasonEnd = parsedSeasonEnd.value;
    if (Boolean(seasonStart) !== Boolean(seasonEnd)) return { error: `Choose both the first and last month for ${name}, or neither for all year.` };
    value.push({ name, discipline: text(session.discipline, TIMETABLE_LIMITS.discipline), weekday, start: session.start, end,
      seasonStart, seasonEnd, location: text(session.location, TIMETABLE_LIMITS.location), notes: text(session.notes, TIMETABLE_LIMITS.notes),
      active: session.active !== false });
  }
  return { value };
}

/** What the public sees: active sessions only, grouped by day (Monday first) in time order. */
export const publicTimetable = (sessions = []) => WEEK_ORDER
  .map((weekday) => ({ weekday, day: WEEKDAYS[weekday], sessions: sessions.filter((session) => session.active !== false && session.weekday === weekday)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(({ active: _active, ...session }) => session) }))
  .filter((day) => day.sessions.length);

export const seasonLabel = ({ seasonStart, seasonEnd }) => seasonStart && seasonEnd
  ? seasonStart === seasonEnd ? `${MONTHS[seasonStart - 1]} only` : `${MONTHS[seasonStart - 1]} to ${MONTHS[seasonEnd - 1]}`
  : 'All year';

export const timeLabel = ({ start, end }) => end ? `${start} to ${end}` : start;

export const sortTimetableSessions = (sessions) => sessions.map((session, index) => ({ session, index }))
  .sort((a, b) => {
    const weekdayRank = (weekday) => {
      const rank = WEEK_ORDER.indexOf(Number(weekday));
      return weekday === '' || rank < 0 ? WEEK_ORDER.length : rank;
    };
    const weekdayA = weekdayRank(a.session.weekday);
    const weekdayB = weekdayRank(b.session.weekday);
    return weekdayA - weekdayB || a.session.start.localeCompare(b.session.start)
      || Number(a.session.seasonStart || 0) - Number(b.session.seasonStart || 0)
      || Number(a.session.seasonEnd || 0) - Number(b.session.seasonEnd || 0)
      || a.session.name.localeCompare(b.session.name);
  });
