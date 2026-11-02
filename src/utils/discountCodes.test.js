import test from 'node:test';
import assert from 'node:assert/strict';
import { discountCodeUpgrade, discountDisplayStatus, discountFailure } from './discountCodes.js';

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

test('old codes get one status, a type and the voucher product they came from', () => {
  assert.deepEqual(discountCodeUpgrade({ used: true, active: true, discountType: 'credit', discountValue: 60, orderRef: 'FCC-1', voucherProductId: 'vouchers' }), {
    set: { status: 'used', type: 'credit', sourceProductId: 'vouchers' }, remove: ['used', 'active', 'discountType', 'voucherProductId']
  });
  assert.deepEqual(discountCodeUpgrade({ used: false, active: false, discountType: 'flat', discountValue: 5 }), { set: { status: 'disabled', type: 'flat' }, remove: ['used', 'active', 'discountType'] });
  assert.deepEqual(discountCodeUpgrade({ disabled: true }).set, { status: 'disabled', type: 'multiplier', discountValue: 0.25 });
  assert.equal(discountCodeUpgrade({ enabled: false }).set.status, 'disabled');
  assert.equal(discountCodeUpgrade({ used: false }).set.status, 'active');
  assert.deepEqual(discountCodeUpgrade({ orderRef: 'FCC-2', productId: 'vouchers', discountType: 'credit', discountValue: 10, used: false }), {
    set: { status: 'active', type: 'credit', sourceProductId: 'vouchers' }, remove: ['used', 'discountType', 'productId']
  });
  assert.deepEqual(discountCodeUpgrade({ productIds: ['course'], status: 'active', type: 'credit', discountValue: 10 }), { set: {}, remove: [] }, 'product scopes are not the source product');
  assert.deepEqual(discountCodeUpgrade({ status: 'used', type: 'credit', discountValue: 60, orderRef: 'FCC-1', sourceProductId: 'vouchers' }), { set: {}, remove: [] });
});
