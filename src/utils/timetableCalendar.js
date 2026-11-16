const TIME_ZONE = 'Europe/London';
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const localDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const partsInLondon = (date) => Object.fromEntries(localDateTime.formatToParts(date).map(({ type, value }) => [type, value]));
const dateKey = (year, month, day) => `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
const calendarDate = (date) => `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
const icsDate = (date) => dateKey(date.year, date.month, date.day);
const icsDateTime = (date, time) => `${icsDate(date)}T${time.replace(':', '')}00`;

const isInSeason = (month, session) => {
  if (!session.seasonStart || !session.seasonEnd) return true;
  return session.seasonStart <= session.seasonEnd
    ? month >= session.seasonStart && month <= session.seasonEnd
    : month >= session.seasonStart || month <= session.seasonEnd;
};

const endDateTime = (date, start, end) => {
  if (end) return { date, time: end };
  const [hour, minute] = start.split(':').map(Number);
  const totalMinutes = hour * 60 + minute + 120;
  const endDate = new Date(Date.UTC(date.year, date.month - 1, date.day + Math.floor(totalMinutes / 1440)));
  return {
    date: { year: endDate.getUTCFullYear(), month: endDate.getUTCMonth() + 1, day: endDate.getUTCDate() },
    time: `${String(Math.floor((totalMinutes % 1440) / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
  };
};

export function nextTimetableDate(session, now = new Date()) {
  const current = partsInLondon(now);
  const today = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day)));
  for (let offset = 0; offset <= 366; offset += 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + offset);
    const candidate = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    if (date.getUTCDay() !== session.weekday || !isInSeason(candidate.month, session)) continue;
    const dateText = calendarDate(candidate);
    const currentDateText = `${current.year}-${current.month}-${current.day}`;
    if (dateText < currentDateText || (dateText === currentDateText && session.start <= `${current.hour}:${current.minute}`)) continue;
    return candidate;
  }
  throw new Error('Could not find the next active timetable date.');
}

const escapeText = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
  .replace(/,/g, '\\,').replace(/;/g, '\\;');

const foldLine = (line) => {
  const result = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > 75) {
      result.push(current);
      current = ` ${character}`;
      bytes = 1 + characterBytes;
    } else {
      current += character;
      bytes += characterBytes;
    }
  }
  result.push(current);
  return result.join('\r\n');
};

const londonTimeZone = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'X-LIC-LOCATION:Europe/London',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:BST',
  'DTSTART:19810329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:GMT',
  'DTSTART:19961027T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
];

const updatedTime = (updatedAt, now) => {
  const timestamp = Number(updatedAt) > 0 ? Number(updatedAt) : now.getTime();
  return new Date(timestamp);
};

/** Build a live per-session subscription or a single next-occurrence calendar event. */
export function timetableCalendar(session, { single = false, cancelled = false, sequence, updatedAt = 0, now = new Date() } = {}) {
  if (!session || (session.active === false && !cancelled) || (single && cancelled)) throw new Error('This timetable session is not available.');
  const date = nextTimetableDate(session, now);
  const end = endDateTime(date, session.start, session.end);
  const changedAt = updatedTime(updatedAt, now);
  const stamp = changedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const recurrence = single ? [] : [
    `RRULE:FREQ=WEEKLY;BYDAY=${DAY_CODES[session.weekday]}${session.seasonStart && session.seasonEnd
      ? `;BYMONTH=${MONTHS.filter((month) => isInSeason(month, session)).join(',')}` : ''}`
  ];
  const description = [session.discipline, session.notes].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Forth Canoe Club//Weekly Timetable//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeText(session.name)}`,
    `X-WR-CALNAME:${escapeText(session.name)}`,
    `X-WR-CALDESC:${escapeText([session.discipline, session.location].filter(Boolean).join(' · '))}`,
    ...londonTimeZone,
    'BEGIN:VEVENT',
    `UID:${session.id}${single ? '-next' : ''}@forthcanoeclub.co.uk`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SEQUENCE:${sequence ?? Math.floor(changedAt.getTime() / 1000)}`,
    `DTSTART;TZID=${TIME_ZONE}:${icsDateTime(date, session.start)}`,
    `DTEND;TZID=${TIME_ZONE}:${icsDateTime(end.date, end.time)}`,
    `SUMMARY:${escapeText(session.name)}`,
    ...(cancelled ? ['STATUS:CANCELLED', 'TRANSP:TRANSPARENT'] : []),
    ...(session.location ? [`LOCATION:${escapeText(session.location)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ...recurrence,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
