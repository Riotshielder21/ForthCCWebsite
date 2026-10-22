import test from 'node:test';
import assert from 'node:assert/strict';
import { lineHolders, remainingPeriodShare, firstPaymentPence, stripeItemLines, activeSubscriptionItems, monthlyTotal } from './subscriptions.js';

const person = (membershipId, lineIds, extra = {}) => ({ id: membershipId, membershipId, firstName: membershipId, lastName: 'Test', lineIds, ...extra });

test('each line records which members receive it', () => {
  const people = [person('A', ['a1', 'shared']), person('B', ['b1', 'shared']), person('', ['x'])];
  assert.deepEqual(lineHolders('a1', people), { membershipIds: ['A'], names: ['A Test'] });
  assert.deepEqual(lineHolders('shared', people), { membershipIds: ['A', 'B'], names: ['A Test', 'B Test'] });
  assert.deepEqual(lineHolders('none', people), { membershipIds: [], names: [] });
});

test('a new item is charged only up to the payer\'s next monthly payment', () => {
  assert.equal(remainingPeriodShare(0, 100, 25), 0.75);
  assert.equal(remainingPeriodShare(0, 100, 150), 0);
  assert.equal(remainingPeriodShare(0, 100, -10), 1);
  assert.equal(remainingPeriodShare(0, 0, 0), 1);
  assert.equal(firstPaymentPence(2000, 0.75), 1500);
  assert.equal(firstPaymentPence(999, 1 / 3), 333);
});

test('Stripe items are matched to order lines by metadata', () => {
  const subscription = { items: { data: [
    { id: 'si_1', metadata: {}, price: { product: { metadata: { line_id: 'a1' } } } },
    { id: 'si_2', metadata: { line_id: 'a2' }, price: { product: 'prod_x' } }
  ] } };
  assert.deepEqual(Object.fromEntries(stripeItemLines(subscription, ['a1', 'a2'])), { a1: 'si_1', a2: 'si_2' });
  assert.deepEqual(Object.fromEntries(stripeItemLines({ items: { data: [{ id: 'si_9' }] } }, ['only'])), { only: 'si_9' });
});

test('the monthly total only counts items still being paid', () => {
  const record = { items: [{ status: 'active', monthlyAmount: 12.5 }, { status: 'cancelled', monthlyAmount: 30 }, { status: 'active', monthlyAmount: 4.25 }] };
  assert.equal(activeSubscriptionItems(record).length, 2);
  assert.equal(monthlyTotal(record), 16.75);
});
