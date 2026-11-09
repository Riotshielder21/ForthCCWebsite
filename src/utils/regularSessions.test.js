import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REGULAR_SESSIONS, MAX_REGULAR_SESSIONS, sortRegularSessions, validateRegularSessions } from './regularSessions.js';

test('default regular sessions preserve the currently published discipline days and times', () => {
  assert.deepEqual(DEFAULT_REGULAR_SESSIONS.map(({ discipline, name, weekday, startTime }) => [discipline, name, weekday, startTime]), [
    ['Slalom', '', 2, '19:00'],
    ['Polo', 'Beginner friendly', 5, '18:00'],
    ['Polo', 'Intermediate', 3, '19:00'],
    ['Polo', 'Advanced', 1, '18:00'],
    ['Sprint & Marathon', 'Coached session', 4, '18:00'],
    ['Sprint & Marathon', 'Coached session', 0, '14:00']
  ]);
});

test('regular sessions validate and normalize optional fields and unique IDs', () => {
  const { value, error } = validateRegularSessions({ sessions: [
    { discipline: 'Polo', name: ' Beginner ', weekday: 5, startTime: '18:00', endTime: '', location: '', season: '', active: true },
    { discipline: 'Polo', name: 'Beginner', weekday: 5, startTime: '18:00', endTime: '19:30', location: 'Canal', season: 'April-October', active: false }
  ] });
  assert.equal(error, undefined);
  assert.equal(value.length, 2);
  assert.equal(value[0].id, 'polo-beginner-18-00');
  assert.equal(value[1].id, 'polo-beginner-18-00-2');
  assert.deepEqual([value[1].endTime, value[1].location, value[1].season, value[1].active], ['19:30', 'Canal', 'April-October', false]);
  assert.deepEqual(sortRegularSessions(value).map((session) => session.id), value.map((session) => session.id));
});

test('regular session validation rejects malformed schedules and excessive session counts', () => {
  assert.match(validateRegularSessions({}).error, /list of regular sessions/);
  assert.match(validateRegularSessions({ sessions: [{ discipline: '', weekday: 1, startTime: '18:00' }] }).error, /discipline/);
  assert.match(validateRegularSessions({ sessions: [{ discipline: 'Polo', weekday: 7, startTime: '18:00' }] }).error, /weekday/);
  assert.match(validateRegularSessions({ sessions: [{ discipline: 'Polo', weekday: 1, startTime: '8:00' }] }).error, /valid start/);
  assert.match(validateRegularSessions({ sessions: [{ discipline: 'Polo', weekday: 1, startTime: '18:00', endTime: '17:00' }] }).error, /later/);
  assert.match(validateRegularSessions({ sessions: Array.from({ length: MAX_REGULAR_SESSIONS + 1 }, () => ({})) }).error, /up to/);
  assert.deepEqual(validateRegularSessions({ sessions: [] }).value, []);
});
