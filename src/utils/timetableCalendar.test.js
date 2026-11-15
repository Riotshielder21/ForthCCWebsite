import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTimetableDate, timetableCalendar } from './timetableCalendar.js';

const session = (overrides = {}) => ({ id: 'monday-polo', name: 'Polo training', discipline: 'Canoe polo', weekday: 1, start: '18:00',
  end: '', seasonStart: null, seasonEnd: null, location: 'Harrison Park', notes: '', active: true, ...overrides });

test('seasonal weekly dates skip inactive months, including seasons that cross year end', () => {
  assert.deepEqual(nextTimetableDate(session({ weekday: 2, seasonStart: 4, seasonEnd: 9 }), new Date('2026-10-01T10:00:00Z')),
    { year: 2027, month: 4, day: 6 });
  assert.deepEqual(nextTimetableDate(session({ weekday: 0, seasonStart: 10, seasonEnd: 3 }), new Date('2026-04-01T10:00:00Z')),
    { year: 2026, month: 10, day: 4 });
});

test('next-occurrence export uses Europe/London local time across the daylight-saving transition', () => {
  const calendar = timetableCalendar(session({ weekday: 0 }), { single: true, now: new Date('2026-03-29T00:30:00Z') });
  assert.match(calendar, /DTSTART;TZID=Europe\/London:20260329T180000/);
  assert.match(calendar, /DTEND;TZID=Europe\/London:20260329T200000/);
  assert.doesNotMatch(calendar.split('BEGIN:VEVENT')[1].split('END:VEVENT')[0], /RRULE:/);
  assert.match(calendar, /TZOFFSETFROM:\+0000/);
  assert.match(calendar, /TZOFFSETTO:\+0100/);
  assert.match(calendar, /TZOFFSETFROM:\+0100/);
  assert.match(calendar, /TZOFFSETTO:\+0000/);
});

test('subscription feed recurs on the selected weekday and only in active season months', () => {
  const calendar = timetableCalendar(session({ weekday: 6, seasonStart: 11, seasonEnd: 3 }), { now: new Date('2026-04-01T10:00:00Z') });
  assert.match(calendar, /DTSTART;TZID=Europe\/London:20261107T180000/);
  assert.match(calendar, /RRULE:FREQ=WEEKLY;BYDAY=SA;BYMONTH=1,2,3,11,12/);
  assert.match(calendar, /NAME:Polo training/);
  assert.match(calendar, /X-WR-CALNAME:Polo training/);
  assert.match(calendar, /SUMMARY:Polo training/);
  assert.match(calendar, /UID:monday-polo@forthcanoeclub\.co\.uk/);
  assert.match(calendar, /DTEND;TZID=Europe\/London:20261107T200000/);
});

test('calendar text is escaped and folded without breaking UTF-8 lines', () => {
  const calendar = timetableCalendar(session({ name: 'Canoë; Polo, training', notes: `First line\n${'é'.repeat(60)}` }), {
    now: new Date('2026-01-01T10:00:00Z')
  });
  assert.match(calendar, /SUMMARY:Canoë\\; Polo\\, training/);
  assert.match(calendar, /First line\\n/);
  for (const line of calendar.split('\r\n').filter(Boolean)) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
});
