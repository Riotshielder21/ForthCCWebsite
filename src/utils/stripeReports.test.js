import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeSubscriberReport, loadStripeSubscribers, importedSubscriber, nextClubYearEnd, scheduleClubYearCancellation } from './stripeReports.js';

const subscription = { id: 'sub_example', status: 'active', customer: { id: 'cus_example', name: 'Example Member', email: 'member@example.com' },
  latest_invoice: { payment_intent: { latest_charge: { refunded: false, amount_refunded: 0, disputed: false } } },
  items: { data: [{ price: { nickname: 'Monthly sessions', unit_amount: 2000, currency: 'gbp', recurring: { interval: 'month' } } }] } };

test('legacy import IDs remain stable, separate environments, and never identify customers by email', () => {
  const record = stripeSubscriberReport(subscription);
  const first = importedSubscriber(record, 'test');
  assert.equal(first.clubCustomerId, importedSubscriber({ ...record, email: 'changed@example.com' }, 'test').clubCustomerId);
  assert.equal(first.clubSubscriptionId, importedSubscriber(record, 'test').clubSubscriptionId);
  assert.notEqual(first.clubCustomerId, importedSubscriber(record, 'live').clubCustomerId);
  assert.notEqual(first.clubCustomerId, importedSubscriber({ ...record, stripeCustomerId: 'cus_other' }, 'test').clubCustomerId);
});

test('club year ends at London midnight on the next 1 March', () => {
  assert.equal(nextClubYearEnd(new Date('2026-10-11T00:00:00Z')), '2027-03-01T00:00:00.000Z');
  assert.equal(nextClubYearEnd(new Date('2027-02-28T23:59:59Z')), '2027-03-01T00:00:00.000Z');
  assert.equal(nextClubYearEnd(new Date('2027-03-01T00:00:00Z')), '2028-03-01T00:00:00.000Z');
});

test('scheduling verifies the customer, writes the cutoff without proration, and adds club metadata', async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, options });
    return options?.method === 'POST' ? { ...subscription, cancel_at: Number(options.body.get('cancel_at')) } : subscription;
  };
  const result = await scheduleClubYearCancellation(request, 'sub_example', 'FCC-test-cus_example', 'test', new Date('2026-10-11'));
  assert.equal(result.cancellationAt, '2027-03-01T00:00:00.000Z');
  assert.equal(calls[1].options.body.get('proration_behavior'), 'none');
  assert.equal(calls[1].options.body.get('metadata[fcc_customer_id]'), 'FCC-test-cus_example');
  assert.ok(calls[1].options.idempotencyKey);
  await assert.rejects(scheduleClubYearCancellation(request, 'sub_example', 'FCC-test-cus_wrong', 'test'), /does not match/);
  await assert.rejects(scheduleClubYearCancellation(async () => ({ ...subscription, status: 'canceled' }), 'sub_example', 'FCC-test-cus_example', 'test'), /Only an active/);
});

test('an existing earlier cancellation is never extended', async () => {
  let writes = 0;
  const result = await scheduleClubYearCancellation(async (path, options) => {
    if (options) writes += 1;
    return { ...subscription, cancel_at: new Date('2026-12-01').getTime() / 1000 };
  }, 'sub_example', 'FCC-test-cus_example', 'test', new Date('2026-10-11'));
  assert.equal(result.changed, false);
  assert.equal(writes, 0);
  assert.equal(result.cancellationAt, '2026-12-01T00:00:00.000Z');
});

test('only active Stripe subscriptions qualify, including scheduled cancellation until it takes effect', () => {
  assert.equal(stripeSubscriberReport(subscription).status, 'Active');
  assert.equal(stripeSubscriberReport({ ...subscription, cancel_at_period_end: true }).status, 'Active');
  for (const status of ['canceled', 'paused', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'trialing']) {
    assert.equal(stripeSubscriberReport({ ...subscription, status }).status, 'Inactive');
  }
  assert.equal(stripeSubscriberReport({ ...subscription, pause_collection: { behavior: 'void' } }).status, 'Inactive');
});

test('refunds and disputes override an active status and customer details are exposed', () => {
  for (const charge of [{ refunded: true }, { amount_refunded: 100 }, { disputed: true }]) {
    const record = stripeSubscriberReport({ ...subscription, latest_invoice: { payment_intent: { latest_charge: charge } } });
    assert.equal(record.status, 'Inactive');
    assert.equal(record.paymentReversed, true);
  }
  const record = stripeSubscriberReport(subscription);
  assert.equal(record.email, 'member@example.com');
  assert.equal(record.items[0].amount, 20);
  assert.equal(stripeSubscriberReport({ ...subscription, latest_invoice: null }).refundCheckAvailable, false);
});

test('each report request obtains a fresh paginated Stripe snapshot', async () => {
  const paths = [];
  const request = async (path) => { paths.push(path); return { data: [subscription], has_more: true }; };
  const first = await loadStripeSubscribers(request);
  await loadStripeSubscribers(request, first.nextCursor);
  assert.equal(paths.length, 2);
  assert.equal(first.nextCursor, 'sub_example');
  assert.ok(paths[0].includes('status=all'));
  assert.ok(paths[1].includes('starting_after=sub_example'));
  assert.ok(first.checkedAt);
});