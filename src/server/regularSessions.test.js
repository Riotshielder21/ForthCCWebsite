import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REGULAR_SESSIONS, sortRegularSessions } from '../utils/regularSessions.js';
import { registerRegularSessionRoutes } from './regularSessions.js';

const setup = (authorize = async () => ({ email: 'admin@forthcanoeclub.co.uk' })) => {
  const routes = new Map();
  const documents = new Map();
  const app = Object.fromEntries(['get', 'put'].map((method) => [method, (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1))]));
  const db = () => ({ collection: (name) => ({ doc: (id) => ({
    get: async () => {
      const data = documents.get(`${name}/${id}`);
      return { exists: Boolean(data), data: () => data };
    },
    set: async (value) => documents.set(`${name}/${id}`, value)
  }) }) });
  registerRegularSessionRoutes(app, { requireAdmin: authorize, db });
  const call = async (method, path, body = {}) => {
    const response = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await routes.get(`${method} ${path}`)({ body }, response);
    return response;
  };
  return { call, documents };
};

test('public timetable starts from defaults and only exposes active sessions', async () => {
  const { call } = setup();
  const defaults = await call('GET', '/api/regular-sessions');
  assert.deepEqual(defaults.body.sessions, sortRegularSessions(DEFAULT_REGULAR_SESSIONS));
  assert.equal(defaults.headers['Cache-Control'], 'no-store');

  const saved = await call('PUT', '/api/admin/regular-sessions', {
    sessions: [{ id: 'hidden', discipline: 'Polo', weekday: 1, startTime: '18:00', active: false }]
  });
  assert.equal(saved.statusCode, 200);
  const published = await call('GET', '/api/regular-sessions');
  assert.deepEqual(published.body.sessions, []);
});

test('admin timetable writes require admin authorization and validate the session list', async () => {
  const denied = setup(async (_req, res) => { res.status(403).json({ error: 'Forbidden.' }); return null; });
  assert.equal((await denied.call('PUT', '/api/admin/regular-sessions', { sessions: [] })).statusCode, 403);
  assert.equal(denied.documents.size, 0);

  const { call, documents } = setup();
  const invalid = await call('PUT', '/api/admin/regular-sessions', { sessions: [{ discipline: '', weekday: 1, startTime: '18:00' }] });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.error, /discipline/);
  assert.equal(documents.size, 0);

  const saved = await call('PUT', '/api/admin/regular-sessions', { sessions: [
    { id: 'polo', discipline: 'Polo', weekday: 1, startTime: '18:00', active: true }
  ] });
  assert.equal(saved.statusCode, 200);
  assert.equal(documents.get('settings/regularSessions').sessions[0].id, 'polo');
  const adminView = await call('GET', '/api/admin/regular-sessions');
  assert.equal(adminView.body.sessions.length, 1);
});
