import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateItemAction, refundAvailable, minorUnits, orderLineId } from './itemActions.js';
import { hasKeyAccess } from './keyAccess.js';
import { membershipActivity } from './membership.js';
import { buildRoster } from './eventRoster.js';

test('item actions require a bounded reason, a stable operation ID and integer minor units', () => {
  const body = { action: 'refund', operationId: randomUUID(), reason: ' Duplicate purchase ', amount: 1234, paymentIntent: 'pi_test', revoke: false };
  assert.equal(validateItemAction(body).value.reason, 'Duplicate purchase');
  for (const change of [{ reason: '' }, { reason: 'x'.repeat(1001) }, { operationId: '' }, { amount: 1.5 }, { amount: 0 }, { paymentIntent: 'bad' }, { revoke: 'yes' }]) {
    assert.ok(validateItemAction({ ...body, ...change }).error);
  }
  assert.equal(minorUnits(12.34), 1234);
  assert.equal(orderLineId({}, 2), 'legacy-2');
});

test('refund availability respects line allocation, external refunds and pending refunds', () => {
  const item = { refunds: [{ paymentIntent: 'pi_test', amount: 400, status: 'pending' }, { paymentIntent: 'pi_test', amount: 200, status: 'failed' }] };
  assert.equal(refundAvailable(item, 'pi_test', 1000, { amount: 3000, amount_refunded: 400 }), 600);
  assert.equal(refundAvailable(item, 'pi_test', 1000, { amount: 3000, amount_refunded: 2900 }), 100);
  assert.equal(refundAvailable(item, 'pi_test', 300, { amount: 3000, amount_refunded: 0 }), 0);
});

test('admin key-access revocation overrides induction and purchases', () => {
  assert.equal(hasKeyAccess({ privileges: [{ productId: 'keyhire' }] }), true);
  assert.equal(hasKeyAccess({ volunteer: { inducted: true } }), true);
  assert.equal(hasKeyAccess({ keyAccess: { grantedAt: 1 } }), true);
  assert.equal(hasKeyAccess({ privileges: [{ productId: 'keyhire', endedAt: 1 }] }), false);
  assert.equal(hasKeyAccess({ keyAccess: { revokedAt: 1 }, volunteer: { inducted: true }, privileges: [{ productId: 'keyhire' }] }), false);
});

test('membership revocation remains effective if an external sync sets status active again', () => {
  assert.equal(membershipActivity({ status: 'active', validUntil: '2099-03-01', membershipAccessEndsAt: 0 }), 'inactive');
});

test('revoked event tickets are retained in orders but omitted from attendance', () => {
  const orders = [{ id: 'O', status: 'paid', items: [{ id: 'trip', lineId: 'ticket', revokedAt: '2026-01-01' }] }];
  assert.deepEqual(buildRoster('trip', orders), []);
});
