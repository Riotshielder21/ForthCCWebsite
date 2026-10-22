import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionGroups, stripeItemLines, activeSubscriptionItems, monthlyTotal } from './subscriptions.js';

const person = (membershipId, lineIds, extra = {}) => ({ id: membershipId, membershipId, firstName: membershipId, lastName: 'Test', lineIds, ...extra });

test('each person gets their own subscription for their monthly items', () => {
  const items = [{ lineId: 'a1', monthly: true }, { lineId: 'a2', monthly: true }, { lineId: 'b1', monthly: true }, { lineId: 'shirt', monthly: false }];
  const groups = subscriptionGroups(items, [person('A', ['a1', 'a2', 'shirt']), person('B', ['b1'])]);
  assert.deepEqual(groups.map(({ key, lineIds, primary, status }) => ({ key, lineIds, primary, status })), [
    { key: 'person:A', lineIds: ['a1', 'a2'], primary: true, status: 'checkout' },
    { key: 'person:B', lineIds: ['b1'], primary: false, status: 'pending' }
  ]);
  assert.deepEqual(groups[1].names, ['B Test']);
});

test('people on one family membership share a subscription', () => {
  const items = [{ lineId: 'family', monthly: true }, { lineId: 'kid-sub', monthly: true }, { lineId: 'friend', monthly: true }];
  const groups = subscriptionGroups(items, [
    person('P', ['family'], { subscriptionGroup: 'family:family' }),
    person('K', ['family', 'kid-sub'], { subscriptionGroup: 'family:family' }),
    person('F', ['friend'])
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].lineIds, ['family', 'kid-sub']);
  assert.deepEqual(groups[0].membershipIds, ['P', 'K']);
  assert.equal(groups[1].key, 'person:F');
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
