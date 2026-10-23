import test from 'node:test';
import assert from 'node:assert/strict';
import { lineHolders, subscriptionLive, endedAtCutoff, stripeItemLines, activeSubscriptionItems, monthlyTotal } from './subscriptions.js';

const person = (membershipId, lineIds, extra = {}) => ({ id: membershipId, membershipId, firstName: membershipId, lastName: 'Test', lineIds, ...extra });

test('each line records which members receive it', () => {
  const people = [person('A', ['a1', 'shared']), person('B', ['b1', 'shared']), person('', ['x'])];
  assert.deepEqual(lineHolders('a1', people), { membershipIds: ['A'], names: ['A Test'] });
  assert.deepEqual(lineHolders('shared', people), { membershipIds: ['A', 'B'], names: ['A Test', 'B Test'] });
  assert.deepEqual(lineHolders('none', people), { membershipIds: [], names: [] });
});

test('a subscription waiting for its first debit still counts as live', () => {
  assert.deepEqual(['active', 'trialing', 'past_due', 'canceled', undefined].map((status) => subscriptionLive({ status })), [true, true, false, false, false]);
});

test('a subscription ending at its club-year cut-off is told apart from other cancellations', () => {
  const cutoff = 1802649600;
  assert.equal(endedAtCutoff({ status: 'canceled', ended_at: cutoff + 5, metadata: { cutoff_at: String(cutoff) } }), true);
  assert.equal(endedAtCutoff({ status: 'canceled', ended_at: cutoff - 30 * 24 * 60 * 60, metadata: { cutoff_at: String(cutoff) } }), false);
  assert.equal(endedAtCutoff({ status: 'canceled', ended_at: cutoff, metadata: {} }), false);
  assert.equal(endedAtCutoff({ status: 'active', metadata: { cutoff_at: String(cutoff) } }), false);
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
