import test from 'node:test';
import assert from 'node:assert/strict';
import { lineHolders, subscriptionLive, endedAtCutoff, stripeItemLines, activeSubscriptionItems, monthlyTotal, itemPrice, subscriptionPrice, continuationLabel, isRecurringLine } from './subscriptions.js';
import { createRecurringSubscription, nextBillingDate } from '../server/recurringSubscription.js';

test('a subscription waiting for its first payment trials until then and has no end date', async () => {
  const calls = [];
  const firstCharge = Date.parse('2027-03-01T00:00:00Z') / 1000;
  const base = [['customer', 'cus_example']];
  const expected = { id: 'sub_example' };
  const result = await createRecurringSubscription(async (...args) => { calls.push(args); return expected; }, {
    base, firstCharge, interval: 'year', idempotencyKey: 'order-year-subscription', now: new Date('2027-01-05T12:00:00Z')
  });
  assert.equal(result, expected);
  assert.deepEqual(calls, [['subscriptions', [...base, ['trial_end', String(firstCharge)], ['proration_behavior', 'none']],
    'POST', { idempotencyKey: 'order-year-subscription' }]]);
  assert.deepEqual(base, [['customer', 'cus_example']]);
});

test('a late set-up is backdated to its missed first payment and anchored on the next one', async () => {
  const calls = [];
  const firstCharge = Date.parse('2026-12-01T00:00:00Z') / 1000;
  await createRecurringSubscription(async (...args) => { calls.push(args); return { id: 'sub_example' }; }, {
    base: [], firstCharge, idempotencyKey: 'key', now: new Date('2026-12-04T12:00:00Z')
  });
  assert.deepEqual(calls, [['subscriptions', [['backdate_start_date', String(firstCharge)], ['billing_cycle_anchor', String(Date.parse('2027-01-01T00:00:00Z') / 1000)],
    ['proration_behavior', 'create_prorations']], 'POST', { idempotencyKey: 'key' }]], 'nothing sets an end date');
  assert.equal(nextBillingDate('year', new Date('2027-03-04T12:00:00Z')).toISOString(), '2028-03-01T00:00:00.000Z', 'a late yearly one anchors on the next 1 March');
});

test('scheduled volunteer cancellations leave the paid period intact and stop counting after it ends', () => {
  const record = { items: [
    { lineId: 'finished', status: 'active', monthlyAmount: 25, cancelScheduledAt: '2020-01-01T00:00:00Z' },
    { lineId: 'paid', status: 'active', monthlyAmount: 10, cancelScheduledAt: '2099-01-01T00:00:00Z' }
  ] };
  assert.deepEqual(activeSubscriptionItems(record).map((item) => item.lineId), ['paid']);
  assert.equal(monthlyTotal(record), 10);
});

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

test('a subscription ending where the member asked (the club-year end) is told apart from other cancellations', () => {
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

test('prices and the continue/cancel answer read the same for monthly and yearly subscriptions', () => {
  assert.equal(itemPrice({ monthlyAmount: 25 }), '£25.00 a month');
  assert.equal(itemPrice({ interval: 'year', yearlyAmount: 240 }), '£240.00 a year');
  const yearly = { interval: 'year', items: [{ status: 'active', yearlyAmount: 240 }, { status: 'active', yearlyAmount: 192 }, { status: 'cancelled', yearlyAmount: 100 }] };
  assert.equal(subscriptionPrice(yearly), '£432.00 a year');
  assert.equal(continuationLabel({}), 'Carries on until cancelled.');
  assert.equal(continuationLabel({ continuation: { renewalYear: 2027, status: 'unconfirmed' } }), 'Club year 2027/28: unconfirmed, carries on.');
  assert.equal(continuationLabel({ continuation: { renewalYear: 2027, status: 'cancelled' } }), 'Club year 2027/28: cancelled, stops at the end of February.');
  assert.deepEqual([{ monthly: true }, { yearly: true }, {}].map(isRecurringLine), [true, true, false]);
});
