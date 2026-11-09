import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateItemAction, refundAvailable, minorUnits, orderLineId, itemActionEffects, itemActionLabel, describeItemAction } from './itemActions.js';
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
  assert.equal(validateItemAction({ ...body, purpose: 'volunteer-adjustment' }).value.purpose, 'volunteer-adjustment');
  assert.equal(validateItemAction(body).value.purpose, undefined);
  for (const change of [{ purpose: 'other' }, { purpose: 'volunteer-adjustment', revoke: true }, { purpose: 'volunteer-adjustment', action: 'revoke' }]) {
    assert.ok(validateItemAction({ ...body, ...change }).error);
  }
});

test('refund availability respects line allocation, external refunds and pending refunds', () => {
  const item = { refunds: [{ paymentIntent: 'pi_test', amountPence: 400, status: 'pending' }, { paymentIntent: 'pi_test', amountPence: 200, status: 'failed' }] };
  assert.equal(refundAvailable(item, 'pi_test', 1000, { amount: 3000, amount_refunded: 400 }), 600);
  assert.equal(refundAvailable(item, 'pi_test', 1000, { amount: 3000, amount_refunded: 2900 }), 100);
  assert.equal(refundAvailable(item, 'pi_test', 300, { amount: 3000, amount_refunded: 0 }), 0);
});

test('item action wording separates money back, access removal and stopping monthly billing', () => {
  const monthly = { monthly: true };
  assert.deepEqual(itemActionEffects({ action: 'revoke' }, monthly), { refunds: false, removesAccess: true, stopsBilling: true });
  assert.deepEqual(itemActionEffects({ action: 'refund', revoke: false }, monthly), { refunds: true, removesAccess: false, stopsBilling: false },
    'a single-payment refund leaves the subscription running');
  assert.deepEqual(itemActionEffects({ action: 'refund', revoke: true }, monthly), { refunds: true, removesAccess: true, stopsBilling: true });
  assert.deepEqual(itemActionEffects({ action: 'refund', revoke: true }), { refunds: true, removesAccess: true, stopsBilling: false });
  assert.equal(itemActionLabel({ action: 'refund', revoke: true }, monthly), 'Refund and cancel');
  assert.equal(itemActionLabel({ action: 'refund', revoke: true }), 'Refund and revoke');
  assert.equal(itemActionLabel({ action: 'refund', revoke: false }, monthly), 'Refund one payment (billing continues)');
  assert.equal(itemActionLabel({ action: 'revoke' }), 'Revoke access (no refund)');
  assert.match(describeItemAction({ action: 'refund', revoke: false }, monthly, '£5.00'), /Returns £5\.00.*Access and benefits stay.*Monthly payments carry on/);
  assert.match(describeItemAction({ action: 'refund', revoke: true }, monthly), /Removes.*Stops this item's future monthly payments/);
  assert.match(describeItemAction({ action: 'revoke' }, {}), /^No money is returned\. Removes/);
  assert.doesNotMatch(describeItemAction({ action: 'revoke' }, {}), /monthly/);
});

test('admin key-access revocation overrides induction and purchases', () => {
  assert.equal(hasKeyAccess({ volunteer: { inducted: true } }), true);
  assert.equal(hasKeyAccess({ keyAccess: { grantedAt: 1 } }), true);
  assert.equal(hasKeyAccess({}), false);
  assert.equal(hasKeyAccess({ keyAccess: { grantedAt: 1, revokedAt: 2 }, volunteer: { inducted: true } }), false);
});

test('membership revocation remains effective if an external sync sets status active again', () => {
  assert.equal(membershipActivity({ status: 'active', validUntil: '2099-03-01', membershipAccessEndsAt: 0 }), 'inactive');
});

test('revoked event tickets are retained in orders but omitted from attendance', () => {
  const orders = [{ id: 'O', status: 'paid', items: [{ id: 'trip', lineId: 'ticket', revokedAt: '2026-01-01' }] }];
  assert.deepEqual(buildRoster('trip', orders), []);
});
