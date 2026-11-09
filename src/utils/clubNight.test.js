import test from 'node:test';
import assert from 'node:assert/strict';
import { clubNightStatus, validateClubNight, validateCheckinSessions, checkinSessionsFrom, CLUB_NIGHT_ID, validateCheckinIdentity, validateGuestDetails, matchingCheckinRecords } from './clubNight.js';

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
    { name: 'Gold sub session', weekday: 3, start: '19:00', end: '20:00', subscriptions: true, selfAssessment: true },
    { name: 'Club night', weekday: 3, start: '18:30', end: '21:00', boatHire: true, subscriptions: [{ id: 'gold-sub', name: 'Gold' }] },
    { name: 'Club night', weekday: 6, start: '10:00', end: '12:00', boatHire: 'yes' }
  ] });
  assert.deepEqual(value.map((session) => session.id), ['gold-sub-session', 'club-night', 'club-night-2']);
  assert.deepEqual(value.map((session) => [session.subscriptions, session.selfAssessment]), [[true, true], [true, false], [false, false]],
    'subscriptions and the self-assessment checklist are per-session switches; an older list of subscriptions means on');
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

test('purchased catalogue events are not added as check-in sessions', () => {
  const settings = { sessions: [{ name: 'Club night', weekday: 1, start: '18:00', end: '21:00' }] };
  const status = clubNightStatus(settings, new Date('2026-11-02T12:00:00Z'));
  assert.deepEqual(status.openSessions.map((session) => session.name), ['Club night']);
  assert.equal(status.sessions.some((session) => session.id.startsWith('event_')), false);
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
  const details = { phone: '07911 123456', address: '1 Road', postcode: 'EH1 1AA', swimming: 'confident', disclaimerAccepted: true,
    emergencyContact: { name: 'Bo', relationship: 'Friend', phone: '07911 123457' } };
  const guest = validateGuestDetails(adult, details, now).value;
  assert.equal(guest.email, 'ann@example.test');
  assert.equal(guest.junior, false);
  assert.match(validateGuestDetails(adult, { ...details, emergencyContact: {} }, now).error, /emergency contact/);
  assert.match(validateGuestDetails(adult, { ...details, disclaimerAccepted: false }, now).error, /disclaimer/);
  const child = { ...adult, dob: '2015-05-05' };
  assert.match(validateGuestDetails(child, details, now).error, /parent\/guardian/);
  const junior = validateGuestDetails(child, { ...details, guardian: { name: 'Pat Lee', relationship: 'Parent', phone: '07911 123458', address: '1 Road', postcode: 'EH1 1AA' } }, now).value;
  assert.equal(junior.junior, true);
  assert.equal(junior.guardian.email, 'ann@example.test');
});

test('records match on name and date of birth, ignoring case and spacing', () => {
  const records = [{ id: 1, firstName: 'Ann', lastName: 'Lee', dob: '1990-01-02' }, { id: 2, firstName: 'Ann', lastName: 'Lee', dob: '1991-01-02' },
    { id: 3, firstName: 'Bo', lastName: 'Lee', dob: '1990-01-02' }];
  assert.deepEqual(matchingCheckinRecords(records, { firstName: ' ann', lastName: 'LEE ', dob: '1990-01-02' }).map((record) => record.id), [1]);
});
