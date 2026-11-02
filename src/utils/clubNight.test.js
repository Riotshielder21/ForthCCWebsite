import test from 'node:test';
import assert from 'node:assert/strict';
import { clubNightStatus, clubNightDescription, validateClubNight, validateCheckinSessions, checkinSessionsFrom, CLUB_NIGHT_ID, validateCheckinIdentity, validateGuestDetails, matchingCheckinRecords } from './clubNight.js';

const wednesday = { weekday: 3, start: '18:30', end: '21:00' };

test('club-night schedule validation', () => {
  assert.deepEqual(validateClubNight(wednesday).value, wednesday);
  assert.ok(validateClubNight({ ...wednesday, weekday: 7 }).error);
  assert.ok(validateClubNight({ ...wednesday, start: '8:30' }).error);
  assert.ok(validateClubNight({ ...wednesday, end: '18:00' }).error);
});

test('check-in and volunteer access are open for the entire scheduled London day', () => {
  for (const time of ['00:00:00', '09:00:00', '18:29:00', '18:30:00', '21:00:00', '23:59:59']) {
    assert.equal(clubNightStatus(wednesday, new Date(`2027-03-10T${time}Z`)).open, true, time);
  }
  assert.equal(clubNightStatus(wednesday, new Date('2027-03-09T23:59:59Z')).open, false);
  assert.equal(clubNightStatus(wednesday, new Date('2027-03-11T00:00:00Z')).open, false);
  const summer = clubNightStatus(wednesday, new Date('2027-07-06T23:00:00Z'));
  assert.equal(summer.open, true, 'midnight BST at the start of Wednesday');
  assert.equal(summer.date, '2027-07-07');
  assert.equal(summer.dayEndsAt, Date.parse('2027-07-07T23:00:00Z'));
  assert.equal(clubNightStatus(wednesday, new Date('2027-07-07T22:59:59Z')).open, true);
  assert.equal(clubNightStatus(wednesday, new Date('2027-07-07T23:00:00Z')).open, false);
  assert.deepEqual(clubNightStatus(undefined, new Date('2027-03-10T19:00:00Z')), { configured: false, open: false, date: '2027-03-10' });
});

test('named check-in sessions: unique ids, per-session checks, and today\'s sessions sorted by start', () => {
  assert.match(validateCheckinSessions({ sessions: [{ name: '', weekday: 3, start: '18:30', end: '21:00' }] }).error, /name/);
  assert.match(validateCheckinSessions({ sessions: [{ name: 'Pool', weekday: 3, start: '21:00', end: '20:00' }] }).error, /^Pool: /);
  assert.match(validateCheckinSessions({}).error, /list/);
  const { value } = validateCheckinSessions({ sessions: [
    { name: 'Gold sub session', weekday: 3, start: '19:00', end: '20:00', subscriptions: [{ id: 'gold-sub', name: 'Gold' }, 'gold-sub', 'bad id!'] },
    { name: 'Club night', weekday: 3, start: '18:30', end: '21:00', boatHire: true },
    { name: 'Club night', weekday: 6, start: '10:00', end: '12:00', boatHire: 'yes' }
  ] });
  assert.deepEqual(value.map((session) => session.id), ['gold-sub-session', 'club-night', 'club-night-2']);
  assert.deepEqual(value[0].subscriptions, [{ id: 'gold-sub', name: 'Gold' }]);
  assert.equal(value[2].boatHire, false, 'only true turns boat hire on');
  const status = clubNightStatus({ sessions: value }, new Date('2027-03-10T12:00:00Z'));
  assert.deepEqual(status.openSessions.map((session) => session.id), ['club-night', 'gold-sub-session']);
  assert.equal(clubNightStatus({ sessions: value }, new Date('2027-03-11T12:00:00Z')).open, false);
  assert.deepEqual(checkinSessionsFrom(wednesday).map((session) => [session.id, session.name, session.boatHire]), [[CLUB_NIGHT_ID, 'Club night', true]],
    'the original single club-night setting still works');
});

test('dated check-in sessions recur daily, weekly, or monthly through their inclusive end date', () => {
  const session = (frequency, startDate, endDate) => ({
    sessions: [{ name: `${frequency} class`, recurrence: { frequency, startDate, endDate }, start: '18:00', end: '20:00' }]
  });
  const isOpen = (settings, date) => clubNightStatus(settings, new Date(`${date}T12:00:00Z`)).open;

  const daily = session('daily', '2026-11-02', '2026-11-04');
  assert.equal(isOpen(daily, '2026-11-01'), false);
  for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) assert.equal(isOpen(daily, date), true, date);
  assert.equal(isOpen(daily, '2026-11-05'), false);

  const weekly = session('weekly', '2026-11-02', '2026-11-23');
  for (const date of ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']) assert.equal(isOpen(weekly, date), true, date);
  for (const date of ['2026-11-01', '2026-11-03', '2026-11-30']) assert.equal(isOpen(weekly, date), false, date);

  const monthly = session('monthly', '2026-01-31', '2026-05-31');
  for (const date of ['2026-01-31', '2026-03-31', '2026-05-31']) assert.equal(isOpen(monthly, date), true, date);
  for (const date of ['2026-02-28', '2026-03-30', '2026-04-30', '2026-06-30']) assert.equal(isOpen(monthly, date), false, date);
});

test('dated check-in recurrence validation requires a supported cadence and inclusive date range', () => {
  const session = { name: 'Course', recurrence: { frequency: 'weekly', startDate: '2026-11-02', endDate: '2026-11-30' }, start: '18:00', end: '20:00' };
  assert.deepEqual(validateCheckinSessions({ sessions: [session] }).value[0].recurrence, session.recurrence);
  for (const recurrence of [
    { ...session.recurrence, frequency: 'yearly' },
    { ...session.recurrence, startDate: '2026-02-30' },
    { ...session.recurrence, endDate: '2026-10-30' }
  ]) {
    assert.match(validateCheckinSessions({ sessions: [{ ...session, recurrence }] }).error, /repeat and valid start and end dates/);
  }
  assert.match(validateCheckinSessions({ sessions: [{ ...session, end: '18:00' }] }).error, /end must be later/);
});

test('full-day access ends at London midnight on clock-change days', () => {
  const sunday = { ...wednesday, weekday: 0 };
  const spring = clubNightStatus(sunday, new Date('2027-03-28T00:00:00Z'));
  assert.equal(spring.open, true);
  assert.equal(spring.dayEndsAt, Date.parse('2027-03-28T23:00:00Z'));
  assert.equal(clubNightStatus(sunday, new Date('2027-03-28T23:00:00Z')).open, false);
  const autumn = clubNightStatus(sunday, new Date('2027-10-30T23:00:00Z'));
  assert.equal(autumn.open, true);
  assert.equal(autumn.dayEndsAt, Date.parse('2027-11-01T00:00:00Z'));
  assert.equal(clubNightStatus(sunday, new Date('2027-11-01T00:00:00Z')).open, false);
});

const course = {
  id: 'P00001', name: '6 Week Course', category: 'EVENTS', capacity: 0, closeDate: '2026-10-18',
  eventSchedule: { mode: 'weekly', startDate: '2026-10-19', weeks: 6, startTime: '15:00', endTime: '17:00', timeZone: 'Europe/London' }
};

test('a six-week course offers check-ins on all six session dates, even after bookings close or tickets sell out', () => {
  for (const date of ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']) {
    const status = clubNightStatus(undefined, new Date(`${date}T12:00:00Z`), [course]);
    assert.equal(status.open, true, date);
    assert.deepEqual(status.openSessions.map(({ id, name, start, end, boatHire, subscriptions }) => ({ id, name, start, end, boatHire, subscriptions })),
      [{ id: 'event_P00001', name: '6 Week Course', start: '15:00', end: '17:00', boatHire: true, subscriptions: [] }]);
    assert.match(clubNightDescription(status), /19 Oct 2026 to 23 Nov 2026 \(6 weeks\)/);
  }
  for (const date of ['2026-10-12', '2026-10-20', '2026-11-03', '2026-11-24', '2026-11-30']) {
    assert.equal(clubNightStatus(undefined, new Date(`${date}T12:00:00Z`), [course]).open, false, date);
  }
  assert.equal(clubNightStatus(undefined, new Date('2026-10-18T23:00:00Z'), [course]).open, true, 'first session opens at midnight BST');
  assert.equal(clubNightStatus(undefined, new Date('2026-10-19T23:00:00Z'), [course]).open, false, 'BST day ends at 23:00 UTC');
  assert.equal(clubNightStatus(undefined, new Date('2026-11-23T23:59:59Z'), [course]).open, true, 'last session stays open all day GMT');
  assert.equal(clubNightStatus(undefined, new Date('2026-11-24T00:00:00Z'), [course]).open, false);
});

test('dated events share the picker with recurring sessions and keep distinct stable ids', () => {
  const products = [
    course,
    { ...course, id: 'single', eventSchedule: { ...course.eventSchedule, mode: 'single', startDate: '2026-11-02' } },
    { ...course, id: 'daily', eventSchedule: { ...course.eventSchedule, mode: 'consecutive', days: 3, startDate: '2026-10-31' } },
    { ...course, id: 'hidden', active: false },
    { ...course, id: 'subscription', category: 'SUBSCRIPTIONS' }
  ];
  const status = clubNightStatus({ sessions: [{ id: 'club-night', name: 'Club night', weekday: 1, start: '18:00', end: '21:00' }] },
    new Date('2026-11-02T18:00:00Z'), products);
  assert.deepEqual(status.openSessions.map((session) => session.id), ['event_P00001', 'event_single', 'event_daily', 'club-night']);
  assert.equal(status.openSessions.find((session) => session.id === 'event_P00001').id,
    clubNightStatus(undefined, new Date('2026-11-09T12:00:00Z'), products).openSessions[0].id);
});

test('invalid event schedules are logged without hiding valid check-in sessions', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const status = clubNightStatus(undefined, new Date('2026-11-02T12:00:00Z'), [
    course, { ...course, id: 'invalid', eventSchedule: { ...course.eventSchedule, weeks: 0 } }
  ]);
  assert.deepEqual(status.openSessions.map((session) => session.id), ['event_P00001']);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments[0], /invalid/);
});

test('identity needs name, valid email and date of birth', () => {
  const now = new Date('2027-03-10T19:00:00Z');
  assert.deepEqual(validateCheckinIdentity({ firstName: ' Ann ', lastName: 'Lee', email: 'ANN@Example.test', dob: '1990-01-02' }, now).value,
    { firstName: 'Ann', lastName: 'Lee', email: 'ann@example.test', dob: '1990-01-02' });
  assert.ok(validateCheckinIdentity({ firstName: 'Ann', lastName: '', email: 'a@b.test', dob: '1990-01-02' }, now).error);
  assert.ok(validateCheckinIdentity({ firstName: 'Ann', lastName: 'Lee', email: 'nope', dob: '1990-01-02' }, now).error);
  assert.ok(validateCheckinIdentity({ firstName: 'Ann', lastName: 'Lee', email: 'a@b.test', dob: '2030-01-01' }, now).error);
});

test('guests give membership-style details; under-18s give a parent/guardian', () => {
  const now = new Date('2027-03-10T19:00:00Z');
  const adult = { firstName: 'Ann', lastName: 'Lee', email: 'ann@example.test', dob: '1990-01-02' };
  const details = { phone: '0770', address: '1 Road', postcode: 'EH1', swimming: 'confident', disclaimerAccepted: true,
    emergencyContact: { name: 'Bo', relationship: 'Friend', phone: '0771' } };
  const guest = validateGuestDetails(adult, details, now).value;
  assert.equal(guest.email, 'ann@example.test');
  assert.equal(guest.junior, false);
  assert.match(validateGuestDetails(adult, { ...details, emergencyContact: {} }, now).error, /emergency contact/);
  assert.match(validateGuestDetails(adult, { ...details, disclaimerAccepted: false }, now).error, /disclaimer/);
  const child = { ...adult, dob: '2015-05-05' };
  assert.match(validateGuestDetails(child, details, now).error, /parent\/guardian/);
  const junior = validateGuestDetails(child, { ...details, guardian: { name: 'Pat Lee', relationship: 'Parent', phone: '0772', address: '1 Road', postcode: 'EH1' } }, now).value;
  assert.equal(junior.junior, true);
  assert.equal(junior.guardian.email, 'ann@example.test');
});

test('records match on name and date of birth, ignoring case and spacing', () => {
  const records = [{ id: 1, firstName: 'Ann', lastName: 'Lee', dob: '1990-01-02' }, { id: 2, firstName: 'Ann', lastName: 'Lee', dob: '1991-01-02' },
    { id: 3, firstName: 'Bo', lastName: 'Lee', dob: '1990-01-02' }];
  assert.deepEqual(matchingCheckinRecords(records, { firstName: ' ann', lastName: 'LEE ', dob: '1990-01-02' }).map((record) => record.id), [1]);
});
