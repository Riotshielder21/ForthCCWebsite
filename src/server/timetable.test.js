import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIMETABLE, publicTimetable } from '../utils/timetable.js';
import { registerTimetableRoutes } from './timetable.js';

const setup = (initialData) => {
  const routes = new Map();
  const documents = new Map(initialData ? [['settings/timetable', initialData]] : []);
  const app = Object.fromEntries(['get', 'put'].map((method) => [method, (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1))]));
  const db = () => ({ collection: (name) => ({ doc: (id) => ({
    get: async () => {
      const data = documents.get(`${name}/${id}`);
      return { exists: Boolean(data), data: () => data };
    },
    set: async (value) => documents.set(`${name}/${id}`, value)
  }) }) });
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

test('calendar endpoints export only active timetable sessions and return calendar content', async () => {
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
  assert.equal((await call('GET', '/api/timetable/:id.ics', { params: { id: 'hidden-session' } })).statusCode, 404);
  assert.equal((await call('GET', '/api/timetable/:id.ics', { params: { id: 'missing' } })).statusCode, 404);
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
