import test from 'node:test';
import assert from 'node:assert/strict';
import { clientKey } from './rateLimit.js';

test('rate-limit keys ignore IPv6 zone identifiers and over-long addresses', () => {
  assert.equal(clientKey('203.0.113.7'), '203.0.113.7');
  assert.equal(clientKey(`fe80::1%${'a'.repeat(50000)}`), clientKey('fe80::1'));
  assert.equal(clientKey('2001:db8::1'), clientKey('2001:db8::2'), 'IPv6 addresses share a /56 key');
  const started = Date.now();
  clientKey(`${'1:'.repeat(30000)}%${'%'.repeat(30000)}`);
  assert.ok(Date.now() - started < 200);
  assert.equal(typeof clientKey(undefined), 'string');
});
