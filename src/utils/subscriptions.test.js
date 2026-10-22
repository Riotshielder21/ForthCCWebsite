import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionGroups, stripeItemLines, activeSubscriptionItems, monthlyTotal } from './subscriptions.js';

const person = (membershipId, lineIds, extra = {}) => ({ id: membershipId, membershipId, firstName: membershipId, lastName: 'Test', lineIds, ...extra });

test('every monthly item gets its own subscription, even for the same person', () => {
  const items = [{ lineId: 'a1', monthly: true }, { lineId: 'a2', monthly: true }, { lineId: 'b1', monthly: true }, { lineId: 'shirt', monthly: false }];
  const groups = subscriptionGroups(items, [person('A', ['a1', 'a2', 'shirt']), person('B', ['b1'])]);
  assert.deepEqual(groups.map(({ key, lineIds, membershipIds, primary, status }) => ({ key, lineIds, membershipIds, primary, status })), [
    { key: 'line:a1', lineIds: ['a1'], membershipIds: ['A'], primary: true, status: 'checkout' },
    { key: 'line:a2', lineIds: ['a2'], membershipIds: ['A'], primary: false, status: 'pending' },
    { key: 'line:b1', lineIds: ['b1'], membershipIds: ['B'], primary: false, status: 'pending' }
  ]);
  assert.deepEqual(groups[2].names, ['B Test']);
});

test('annual-only baskets have no subscriptions', () => {
  assert.deepEqual(subscriptionGroups([{ lineId: 'x', monthly: false }], [person('A', ['x'])]), []);
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
