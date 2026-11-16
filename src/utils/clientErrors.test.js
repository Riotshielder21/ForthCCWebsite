import test from 'node:test';
import assert from 'node:assert/strict';
import { clientErrorKind, createClientErrorReporter, installClientErrorListeners } from './clientErrors.js';

test('browser reports contain only fixed categories and route IDs, never URL parameters or error data', async () => {
  const reports = [];
  const report = createClientErrorReporter({ send: async (body) => reports.push(body),
    location: () => 'https://club.test/order/private-token?email=personal@example.com#secret' });
  await report('page-render');
  assert.deepEqual(reports, [{ kind: 'page-render', page: 'order-lookup' }]);
  assert.equal(clientErrorKind({ code: 'auth/network-request-failed', message: 'personal@example.com' }), 'auth-network');
  assert.equal(clientErrorKind(new Error('Failed to fetch dynamically imported module: /private')), 'asset-load');
  assert.equal(clientErrorKind(new Error('personal@example.com'), 'page-render'), 'page-render');
  await assert.rejects(report('personal@example.com'), /Unknown/);
});

test('browser reports deduplicate for a minute and cap each page session at ten', async () => {
  const reports = [];
  let time = 1000;
  const report = createClientErrorReporter({ send: async (body) => reports.push(body), now: () => time, location: () => 'https://club.test/' });
  await report('javascript');
  await report('javascript');
  assert.equal(reports.length, 1);
  for (let i = 0; i < 20; i++) { time += 60000; await report('javascript'); }
  assert.equal(reports.length, 10);
});

test('failed reporting logs a fixed warning without recursion or personal error messages', async () => {
  const warnings = [];
  const report = createClientErrorReporter({ send: async () => { throw new Error('personal@example.com'); },
    location: () => 'https://club.test/', logger: { warn: (message) => warnings.push(message) } });
  await report('api-network');
  assert.deepEqual(warnings, ['Browser error report could not be delivered.']);
});

test('global listeners capture script and promise errors, skip images and can be removed', () => {
  const listeners = new Map();
  const target = { addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { assert.equal(listeners.get(name), callback); listeners.delete(name); } };
  const reports = [];
  const cleanup = installClientErrorListeners(target, (kind) => reports.push(kind));
  listeners.get('error')({ target, error: new Error('private message') });
  listeners.get('error')({ target: { tagName: 'SCRIPT' } });
  listeners.get('error')({ target: { tagName: 'IMG' } });
  listeners.get('unhandledrejection')({ reason: { code: 'auth/network-request-failed' } });
  assert.deepEqual(reports, ['javascript', 'asset-load', 'auth-network']);
  cleanup();
  assert.equal(listeners.size, 0);
});
