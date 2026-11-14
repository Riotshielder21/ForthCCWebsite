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
  const call = async (method, path, body = {}) => {
    const response = {
      statusCode: 200,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }
    };
    await routes.get(`${method} ${path}`)({ body }, response);
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

test('saved timetable sessions must be an array', async () => {
  const { call } = setup({ sessions: 'invalid' });
  assert.equal((await call('GET', '/api/timetable')).statusCode, 500);
  assert.equal((await call('GET', '/api/admin/timetable')).statusCode, 500);
});
