import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresAppCheck, appCheckMiddleware } from './appCheck.js';

test('App Check covers submissions and private reads, not trusted callbacks or public content', () => {
  for (const path of ['/api/checkout-session', '/api/contact', '/api/email-codes', '/api/lists', '/api/forms/custom',
    '/api/club-night/checkins', '/api/admin/forms', '/api/my-details/home/email']) {
    assert.equal(requiresAppCheck({ path, method: 'POST' }), true, path);
  }
  for (const path of ['/api/admin/page-drafts', '/api/my-details', '/api/orders/private', '/api/checkout-receipt',
    '/api/event-rosters', '/api/club-night/checkins', '/api/volunteers/renew/private', '/api/renewals/private']) {
    assert.equal(requiresAppCheck({ path, method: 'GET' }), true, path);
  }
  for (const [path, method] of [['/health', 'GET'], ['/api/availability', 'GET'], ['/api/forms', 'GET'],
    ['/api/stripe/webhook', 'POST'], ['/api/jobs/renewals', 'POST'], ['/api/admin/forms', 'OPTIONS']]) {
    assert.equal(requiresAppCheck({ path, method }), false, path);
  }
  assert.equal(requiresAppCheck({ path: '/api/admin/forms', method: 'DELETE' }), true);
  assert.equal(requiresAppCheck({ path: '/api/my-details/home', method: 'PATCH' }), true);
});

const run = async ({ mode = 'enforce', token, local = false, appId = 'web-app', failure } = {}) => {
  const logs = [];
  let verified = 0;
  let next = 0;
  let status;
  let body;
  const middleware = appCheckMiddleware({
    mode, local, appIds: ['web-app'],
    verifyToken: async (value) => {
      verified++;
      assert.equal(value, token);
      if (failure) throw failure;
      return { appId };
    },
    logger: Object.fromEntries(['warn', 'info'].map(level => [level, (...args) => logs.push(args)]))
  });
  await middleware({ path: '/api/checkout-session', method: 'POST', get: () => token },
    { status: (value) => { status = value; return { json: (value) => { body = value; } }; } }, () => next++);
  return { logs, verified, next, status, body };
};

test('enforcement rejects missing, invalid and wrong-app tokens before the action', async () => {
  const missing = await run();
  assert.equal(missing.status, 401);
  assert.equal(missing.next, 0);
  assert.match(missing.body.error, /verification is required/);
  for (const options of [{ failure: new Error('Invalid token') }, { appId: 'other-app' }]) {
    const result = await run({ token: 'test-token', ...options });
    assert.equal(result.status, 403);
    assert.equal(result.next, 0);
  }
});

test('verified tokens proceed, without logging tokens or request personal information', async () => {
  const result = await run({ token: 'private-test-token' });
  assert.equal(result.next, 1);
  assert.equal(result.verified, 1);
  assert.ok(!JSON.stringify(result.logs).includes('private-test-token'));
});

test('monitor mode logs unverified requests without blocking them', async () => {
  for (const options of [{}, { token: 'test', failure: new Error('Unavailable') }]) {
    const result = await run({ mode: 'monitor', ...options });
    assert.equal(result.next, 1);
    assert.ok(result.logs.length);
    assert.equal(result.status, undefined);
  }
});

test('local emulators bypass verification even with enforcement enabled', async () => {
  const result = await run({ local: true });
  assert.equal(result.next, 1);
  assert.equal(result.verified, 0);
});

test('invalid enforcement configuration fails explicitly', () => {
  assert.throws(() => appCheckMiddleware({ mode: 'disabled' }), /APP_CHECK_MODE/);
});
