import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIMETABLE, publicTimetable } from '../utils/timetable.js';
import { registerTimetableRoutes } from './timetable.js';

const setup = (initialData) => {
  const routes = new Map();
  const documents = new Map(initialData ? [['settings/timetable', initialData]] : []);
  const app = Object.fromEntries(['get', 'put'].map((method) => [method, (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1))]));
  const db = () => ({
    runTransaction: async (callback) => callback({
      get: (document) => document.get(),
      set: (document, value) => document.set(value)
    }),
    collection: (name) => ({ doc: (id) => ({
      get: async () => {
        const data = documents.get(`${name}/${id}`);
        return { exists: Boolean(data), data: () => data };
      },
      set: async (value) => documents.set(`${name}/${id}`, value)
    }) })
  });
  registerTimetableRoutes(app, { requireAdmin: async () => ({ email: 'admin@forthcanoeclub.co.uk' }), db });
  const call = async (method, path, { body = {}, params = {} } = {}) => {
    const response = {
      statusCode: 200,
      headers: {},
      set(name, value) { this.headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; }
    };
    await routes.get(`${method} ${path}`)({ body, params }, response);
    return response;
  };
  return { call, documents };
};

test('public and admin timetable reads validate saved sessions', async () => {
  const { call } = setup({ sessions: [{ name: 'Polo', weekday: 1, start: '18:00', seasonStart: 13, seasonEnd: 14 }] });
  const publicResponse = await call('GET', '/api/timetable');
  const adminResponse = await call('GET', '/api/admin/timetable');
  assert.equal(publicResponse.statusCode, 500);
  assert.deepEqual(publicResponse.body, { error: 'Could not load the timetable.' });
  assert.equal(adminResponse.statusCode, 500);
  assert.deepEqual(adminResponse.body, { error: 'Could not load the timetable.' });
});

test('missing timetable settings still use the validated defaults', async () => {
  const { call } = setup();
  const response = await call('GET', '/api/timetable');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.days, publicTimetable(DEFAULT_TIMETABLE));
});

test('calendar endpoints export active sessions and cancellations, but next-event downloads require an active session', async () => {
  const initialData = { sessions: [
    { id: 'monday-polo', name: 'Polo', weekday: 1, start: '18:00' },
    { id: 'hidden-session', name: 'Hidden', weekday: 2, start: '18:00', active: false }
  ], updatedAt: { toMillis: () => Date.UTC(2026, 0, 1) } };
  const { call } = setup(initialData);
  const next = await call('GET', '/api/timetable/:id/next.ics', { params: { id: 'monday-polo' } });
  assert.equal(next.statusCode, 200);
  assert.match(next.body, /BEGIN:VCALENDAR/);
  assert.match(next.body, /UID:monday-polo-next@forthcanoeclub\.co\.uk/);
  assert.equal(next.headers['Content-Type'], 'text/calendar; charset=utf-8');
  assert.equal(next.headers['Access-Control-Allow-Origin'], '*');
  const subscription = await call('GET', '/api/timetable/:id.ics', { params: { id: 'monday-polo' } });
  assert.match(subscription.body, /RRULE:FREQ=WEEKLY;BYDAY=MO/);
  const disabled = await call('GET', '/api/timetable/:id.ics', { params: { id: 'hidden-session' } });
  assert.equal(disabled.statusCode, 200);
  assert.match(disabled.body, /STATUS:CANCELLED/);
  assert.equal((await call('GET', '/api/timetable/:id/next.ics', { params: { id: 'hidden-session' } })).statusCode, 404);
  assert.equal((await call('GET', '/api/timetable/:id.ics', { params: { id: 'missing' } })).statusCode, 404);
});

test('deleting sessions retains cancellation feeds through later saves without publishing deleted sessions', async () => {
  const sessions = [
    { id: 'monday-polo', name: 'Polo', weekday: 1, start: '18:00' },
    { id: 'slalom', name: 'Slalom', weekday: 2, start: '19:00' }
  ];
  const { call, documents } = setup({ sessions, updatedAt: { toMillis: () => Date.UTC(2026, 0, 1) } });
  const params = { id: 'monday-polo' };
  const before = await call('GET', '/api/timetable/:id.ics', { params });
  const saved = await call('PUT', '/api/admin/timetable', { body: { sessions: [sessions[1]] } });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.sessions.map(({ id }) => id), ['slalom']);
  assert.equal(saved.body.cancelledSessions, undefined);
  const firstSequence = documents.get('settings/timetable').calendarSequence;
  const cancelled = await call('GET', '/api/timetable/:id.ics', { params });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.headers['Content-Type'], 'text/calendar; charset=utf-8');
  assert.match(cancelled.body, /UID:monday-polo@forthcanoeclub\.co\.uk/);
  assert.match(cancelled.body, /STATUS:CANCELLED/);
  assert.match(cancelled.body, /TRANSP:TRANSPARENT/);
  assert.ok(Number(cancelled.body.match(/SEQUENCE:(\d+)/)[1]) > Number(before.body.match(/SEQUENCE:(\d+)/)[1]));
  assert.equal((await call('GET', '/api/timetable/:id/next.ics', { params })).statusCode, 404);
  assert.deepEqual((await call('GET', '/api/timetable')).body.days.flatMap(({ sessions }) => sessions.map(({ id }) => id)), ['slalom']);

  await call('PUT', '/api/admin/timetable', { body: { sessions: [] } });
  assert.ok(documents.get('settings/timetable').calendarSequence > firstSequence);
  assert.equal(documents.get('settings/timetable').cancelledSessions.length, 2);
  assert.match((await call('GET', '/api/timetable/:id.ics', { params })).body, /STATUS:CANCELLED/);
  const { call: restarted } = setup(documents.get('settings/timetable'));
  assert.match((await restarted('GET', '/api/timetable/:id.ics', { params })).body, /STATUS:CANCELLED/);

  await call('PUT', '/api/admin/timetable', { body: { sessions: [sessions[0]] } });
  assert.doesNotMatch((await call('GET', '/api/timetable/:id.ics', { params })).body, /STATUS:CANCELLED/);
  assert.deepEqual(documents.get('settings/timetable').cancelledSessions.map(({ id }) => id), ['slalom']);
});

test('removing a default session before the first save also preserves its cancellation feed', async () => {
  const { call } = setup();
  await call('PUT', '/api/admin/timetable', { body: { sessions: [] } });
  for (const { id } of DEFAULT_TIMETABLE) {
    const response = await call('GET', '/api/timetable/:id.ics', { params: { id } });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /STATUS:CANCELLED/);
  }
});

test('invalid saved cancellation records fail explicitly instead of being silently discarded', async () => {
  const { call } = setup({ sessions: [], cancelledSessions: 'invalid' });
  assert.equal((await call('PUT', '/api/admin/timetable', { body: { sessions: [] } })).statusCode, 500);
  assert.equal((await call('GET', '/api/timetable/:id.ics', { params: { id: 'missing' } })).statusCode, 500);
});

test('a saved timetable time change is immediately reflected by the live subscription URL', async () => {
  const { call, documents } = setup({ sessions: [{ id: 'monday-polo', name: 'Polo', weekday: 1, start: '18:00' }] });
  const path = '/api/timetable/:id.ics';
  const params = { id: 'monday-polo' };
  const before = await call('GET', path, { params });
  assert.match(before.body, /DTSTART;TZID=Europe\/London:\d{8}T180000/);
  documents.set('settings/timetable', { sessions: [{ id: 'monday-polo', name: 'Polo', weekday: 1, start: '19:00' }] });
  const after = await call('GET', path, { params });
  assert.match(after.body, /DTSTART;TZID=Europe\/London:\d{8}T190000/);
});

test('saved timetable sessions must be an array', async () => {
  const { call } = setup({ sessions: 'invalid' });
  assert.equal((await call('GET', '/api/timetable')).statusCode, 500);
  assert.equal((await call('GET', '/api/admin/timetable')).statusCode, 500);
});
