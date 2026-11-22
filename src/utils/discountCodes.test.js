import test from 'node:test';
import assert from 'node:assert/strict';
import { discountDisplayStatus, discountFailure } from './discountCodes.js';

const now = 1_000_000;

test('only an active, unexpired code that is not held by another checkout can be applied', () => {
  assert.equal(discountFailure({ status: 'active' }, now), null);
  assert.equal(discountFailure(null, now), 'Invalid or already used code.');
  assert.equal(discountFailure({ status: 'used' }, now), 'Invalid or already used code.');
  assert.equal(discountFailure({ status: 'disabled' }, now), 'Invalid or already used code.');
  assert.equal(discountFailure({ status: 'active', expiresAt: new Date(now) }, now), 'Code expired.');
  assert.equal(discountFailure({ status: 'active', singleUse: true, reservedUntil: new Date(now + 1) }, now), 'Voucher is already in checkout. Try again later.');
  assert.equal(discountFailure({ status: 'active', singleUse: true, reservedUntil: new Date(now - 1) }, now), null);
});

test('staff see expiry, checkout holds and revocation alongside the stored status', () => {
  assert.equal(discountDisplayStatus({ status: 'active' }, now), 'active');
  assert.equal(discountDisplayStatus({ status: 'used' }, now), 'used');
  assert.equal(discountDisplayStatus({ status: 'disabled' }, now), 'disabled');
  assert.equal(discountDisplayStatus({ status: 'disabled', revokedAt: new Date(now) }, now), 'revoked');
  assert.equal(discountDisplayStatus({ status: 'active', expiresAt: now - 1 }, now), 'expired');
  assert.equal(discountDisplayStatus({ status: 'active', reservedUntil: now + 1 }, now), 'in checkout');
});
