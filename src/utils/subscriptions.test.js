import test from 'node:test';
import assert from 'node:assert/strict';
import { lineHolders, subscriptionLive, endedAtCutoff, clubYearEndUpdate, stripeItemLines, activeSubscriptionItems, monthlyTotal } from './subscriptions.js';
import { createClubYearSubscription } from '../server/clubYearSubscription.js';

test('future monthly billing preserves the trial, subscription end and idempotency key', async () => {
  const calls = [];
  const firstDebit = Date.parse('2027-03-01T00:00:00Z') / 1000;
  const subscriptionEnd = Date.parse('2028-03-01T00:00:00Z') / 1000;
  const base = [['customer', 'cus_example']];
  const expected = { id: 'sub_example' };
  const result = await createClubYearSubscription(async (...args) => { calls.push(args); return expected; }, {
    base, firstDebit, subscriptionEnd, orderRef: 'order', clubYear: 2027, now: new Date('2027-01-05T12:00:00Z')
  });
  assert.equal(result, expected);
  assert.deepEqual(calls, [['subscriptions', [...base, ['trial_end', String(firstDebit)], ['cancel_at', String(subscriptionEnd)], ['proration_behavior', 'none']],
    'POST', { idempotencyKey: 'order-2027-subscription' }]]);
  assert.deepEqual(base, [['customer', 'cus_example']]);
});

test('delayed monthly setup backdates once, then applies the cancellation separately', async () => {
  const calls = [];
  const firstDebit = Date.parse('2026-12-01T00:00:00Z') / 1000;
  const subscriptionEnd = Date.parse('2027-03-01T00:00:00Z') / 1000;
  await createClubYearSubscription(async (...args) => { calls.push(args); return { id: 'sub_example' }; }, {
    base: [], firstDebit, subscriptionEnd, orderRef: 'order', clubYear: 2026, now: new Date('2026-12-04T12:00:00Z')
  });
  assert.deepEqual(calls, [
    ['subscriptions', [['backdate_start_date', String(firstDebit)], ['billing_cycle_anchor', String(Date.parse('2027-01-01T00:00:00Z') / 1000)],
      ['proration_behavior', 'create_prorations']], 'POST', { idempotencyKey: 'order-2026-subscription' }],
    ['subscriptions/sub_example', [['cancel_at', String(subscriptionEnd)], ['proration_behavior', 'none']], 'POST', { idempotencyKey: 'order-2026-cancel-at' }]
  ]);
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

test('a subscription ending at its club-year cut-off is told apart from other cancellations', () => {
  const cutoff = 1802649600;
  assert.equal(endedAtCutoff({ status: 'canceled', ended_at: cutoff + 5, metadata: { cutoff_at: String(cutoff) } }), true);
  assert.equal(endedAtCutoff({ status: 'canceled', ended_at: cutoff - 30 * 24 * 60 * 60, metadata: { cutoff_at: String(cutoff) } }), false);
  assert.equal(endedAtCutoff({ status: 'canceled', ended_at: cutoff, metadata: {} }), false);
  assert.equal(endedAtCutoff({ status: 'active', metadata: { cutoff_at: String(cutoff) } }), false);
});

test('only the matching app-managed club-year cutoff is extended to the full club-year end', () => {
  const oldEnd = Date.parse('2027-02-15T00:00:00Z') / 1000;
  const newEnd = Date.parse('2027-03-01T00:00:00Z') / 1000;
  const managed = { metadata: { club_year: '2026', cutoff_at: String(oldEnd) }, cancel_at: oldEnd };
  assert.deepEqual(clubYearEndUpdate(managed, 2026, newEnd), [
    ['cancel_at', String(newEnd)], ['metadata[cutoff_at]', String(newEnd)], ['proration_behavior', 'none']
  ]);
  assert.equal(clubYearEndUpdate({ ...managed, cancel_at: oldEnd - 3600 }, 2026, newEnd), null, 'preserve a distinct earlier manual cancellation');
  assert.equal(clubYearEndUpdate(managed, 2027, newEnd), null, 'do not change another club year');
  assert.equal(clubYearEndUpdate({ ...managed, cancel_at: newEnd }, 2026, newEnd), null, 'do not rewrite an already-correct end');
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
