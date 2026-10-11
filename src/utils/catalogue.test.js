import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCatalogue, validateEventSchedule, eventSessions, eventScheduleLabel } from './catalogue.js';
import { calculateCart } from './pricing.js';

test('first saved product preserves starter catalogue; overrides and deletions stay explicit', () => {
  const defaults = [{ id: 'starter', name: 'Starter' }, { id: 'other' }];
  assert.equal(resolveCatalogue(defaults, [{ id: 'new' }]).length, 3);
  assert.deepEqual(resolveCatalogue(defaults, [{ id: 'starter', name: 'Edited' }])[0], { id: 'starter', name: 'Edited' });
  assert.deepEqual(resolveCatalogue(defaults, [{ id: 'starter', deleted: true }]), [{ id: 'other' }]);
  assert.deepEqual(resolveCatalogue(defaults, [{ id: 'starter', deleted: true }, { id: 'other', deleted: true }]), []);
});

test('event tickets support a single session or consecutive course days across months', () => {
  const schedule = { mode: 'consecutive', startDate: '2027-02-27', startTime: '15:00', endTime: '17:00', days: 5, timeZone: 'Europe/London' };
  assert.deepEqual(eventSessions(schedule).map((session) => session.date), ['2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02', '2027-03-03']);
  assert.equal(eventSessions({ ...schedule, mode: 'single' }).length, 1);
  assert.ok(eventScheduleLabel(schedule).includes('5 days'));
  assert.ok(eventScheduleLabel(schedule).includes('120 minutes per session'));
  for (const change of [{ startDate: '2027-02-30' }, { endTime: '14:00' }, { days: 0 }, { days: 2.5 }, { timeZone: 'UTC' }]) {
    assert.throws(() => validateEventSchedule({ ...schedule, ...change }));
  }
});

test('event ticket prices are one-off and unaffected by annual or monthly subscription billing', () => {
  const event = { id: 'event', name: 'Course ticket', category: 'EVENTS', type: 'event-ticket', basePrice: 50, hasAnnualDiscount: false };
  const now = new Date('2026-10-11');
  assert.equal(calculateCart([event], true, null, now).total, 50);
  assert.equal(calculateCart([event], false, null, now).total, 50);
});

test('weekly courses keep the same weekday and local times across month and daylight-saving boundaries', () => {
  const schedule = { mode: 'weekly', startDate: '2027-03-21', startTime: '15:00', endTime: '17:00', weeks: 5, timeZone: 'Europe/London' };
  const sessions = eventSessions(schedule);
  assert.deepEqual(sessions.map((session) => session.date), ['2027-03-21', '2027-03-28', '2027-04-04', '2027-04-11', '2027-04-18']);
  assert.ok(sessions.every((session) => session.startTime === '15:00' && session.endTime === '17:00'));
  assert.equal(validateEventSchedule(schedule).weeks, 5);
  assert.ok(eventScheduleLabel(schedule).includes('5 weeks'));
  assert.ok(eventScheduleLabel(schedule).includes('15:00–17:00 weekly'));
  for (const weeks of [0, 61, 1.5, undefined]) assert.throws(() => validateEventSchedule({ ...schedule, weeks }));
});