import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_TIMETABLE, publicTimetable, seasonLabel, timeLabel, TIMETABLE_LIMITS, validateTimetable } from './timetable.js';

const session = (over = {}) => ({ name: 'Polo training', weekday: 1, start: '18:00', ...over });

test('sessions are cleaned and checked before saving', () => {
  const { value } = validateTimetable([session({ name: '  Polo   training ', end: '20:00', seasonStart: '4', seasonEnd: 10, location: 'Harrison Park', extra: 'dropped' })]);
  assert.deepEqual(value, [{ name: 'Polo training', discipline: '', weekday: 1, start: '18:00', end: '20:00', seasonStart: 4, seasonEnd: 10,
    location: 'Harrison Park', notes: '', active: true }]);
  assert.equal(validateTimetable([session({ active: false })]).value[0].active, false);
  for (const [bad, message] of [
    [[session({ name: ' ' })], /needs a name/], [[session({ weekday: 7 })], /Choose a day/], [[session({ start: '25:00' })], /start time/],
    [[session({ end: '17:00' })], /end after/], [[session({ seasonStart: 4 })], /both the first and last month/], ['nope', /not valid/],
    [Array.from({ length: TIMETABLE_LIMITS.sessions + 1 }, () => session()), /or fewer/]
  ]) assert.match(validateTimetable(bad).error, message);
});

test('the public timetable lists active sessions by day, Monday first, in time order', () => {
  const days = publicTimetable(validateTimetable([
    session({ name: 'Sunday paddle', weekday: 0, start: '10:00' }), session({ name: 'Late polo', start: '19:30' }),
    session({ name: 'Early polo', start: '18:00' }), session({ name: 'Hidden', weekday: 3, active: false })
  ]).value);
  assert.deepEqual(days.map((day) => [day.day, day.sessions.map((entry) => entry.name)]), [['Monday', ['Early polo', 'Late polo']], ['Sunday', ['Sunday paddle']]]);
  assert.equal('active' in days[0].sessions[0], false);
});

test('the starting timetable is valid and holds the times that used to be in the Disciplines tiles', () => {
  assert.deepEqual(validateTimetable(DEFAULT_TIMETABLE).value, DEFAULT_TIMETABLE);
  const [monday] = publicTimetable(DEFAULT_TIMETABLE);
  assert.deepEqual(monday.sessions.map((entry) => [entry.name, entry.start]), [['Advanced polo', '18:00']]);
  const disciplines = JSON.parse(readFileSync(new URL('../../public/content/pages/disciplines.json', import.meta.url), 'utf8'));
  for (const key of ['slalomBody', 'poloBody', 'sprintBody']) assert.doesNotMatch(disciplines[key], /\d{1,2}:\d{2}/, `${key} has no session times`);
});

test('seasons and times read naturally', () => {
  assert.equal(seasonLabel({ seasonStart: 4, seasonEnd: 10 }), 'April to October');
  assert.equal(seasonLabel({ seasonStart: 11, seasonEnd: 3 }), 'November to March');
  assert.equal(seasonLabel({ seasonStart: 7, seasonEnd: 7 }), 'July only');
  assert.equal(seasonLabel({}), 'All year');
  assert.equal(timeLabel({ start: '18:00', end: '20:00' }), '18:00 to 20:00');
  assert.equal(timeLabel({ start: '18:00', end: '' }), '18:00');
});
