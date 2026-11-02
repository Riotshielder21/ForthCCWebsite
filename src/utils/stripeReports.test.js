import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeSubscriberReport, loadStripeSubscribers, importedSubscriber, importStripeSubscribers, nextClubYearEnd, cancelStripeSubscription, subscriberMembershipIds } from './stripeReports.js';

const subscription = { id: 'sub_example', status: 'active', metadata: { order_ref: 'FCC-1' }, customer: { id: 'cus_example', name: 'Example Member', email: 'member@example.com' },
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

test('immediate cancellation deletes the entire subscription without invoicing or proration', async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, options });
    return options?.method === 'DELETE' ? { ...subscription, status: 'canceled' } : subscription;
  };
  const result = await cancelStripeSubscription(request, 'sub_example', 'FCC-test-cus_example', 'test');
  assert.equal(result.changed, true);
  assert.equal(result.record.stripeStatus, 'canceled');
  assert.equal(result.record.status, 'Inactive');
  assert.equal('email' in result.record, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, 'subscriptions/sub_example');
  assert.equal(calls[1].options.method, 'DELETE');
  assert.deepEqual(Object.fromEntries(calls[1].options.body), { invoice_now: 'false', prorate: 'false' });
});

test('an existing future cancellation does not prevent immediate cancellation', async () => {
  const calls = [];
  const result = await cancelStripeSubscription(async (path, options) => {
    calls.push(options?.method || 'GET');
    return { ...subscription, cancel_at: new Date('2027-03-01').getTime() / 1000,
      status: options?.method === 'DELETE' ? 'canceled' : 'active' };
  }, 'sub_example', 'FCC-test-cus_example', 'test');
  assert.equal(result.changed, true);
  assert.deepEqual(calls, ['GET', 'DELETE']);
});

test('retries confirm already cancelled subscriptions without a second write', async () => {
  let writes = 0;
  const result = await cancelStripeSubscription(async (path, options) => {
    if (options) writes += 1;
    return { ...subscription, status: 'canceled' };
  }, 'sub_example', 'FCC-test-cus_example', 'test');
  assert.equal(result.changed, false);
  assert.equal(writes, 0);
});

test('cancellation rejects wrong identities and non-eligible subscriptions before writing', async () => {
  let writes = 0;
  const request = async (path, options) => { if (options) writes += 1; return subscription; };
  await assert.rejects(cancelStripeSubscription(request, 'sub_example', 'FCC-test-cus_wrong', 'test'), /does not match/);
  await assert.rejects(cancelStripeSubscription(request, '../invalid', 'FCC-test-cus_example', 'test'), /Invalid Stripe/);
  await assert.rejects(cancelStripeSubscription(request, 'sub_example', 'FCC-test-cus_example', 'live'), /does not match/);
  await assert.rejects(cancelStripeSubscription(async () => ({ ...subscription, id: 'sub_other' }),
    'sub_example', 'FCC-test-cus_example', 'test'), /does not match/);
  for (const fields of [{ status: 'past_due' }, { pause_collection: {} },
    { latest_invoice: { charge: { refunded: true } } }]) {
    await assert.rejects(cancelStripeSubscription(async (path, options) => {
      if (options) writes += 1;
      return { ...subscription, ...fields };
    }, 'sub_example', 'FCC-test-cus_example', 'test'), /Only an active/);
  }
  assert.equal(writes, 0);
});

test('Stripe failures and unconfirmed cancellation are reported, not treated as success', async () => {
  for (const updated of [subscription, { ...subscription, id: 'sub_other', status: 'canceled' }]) {
    await assert.rejects(cancelStripeSubscription(async (path, options) => options ? updated : subscription,
      'sub_example', 'FCC-test-cus_example', 'test'), /did not confirm immediate cancellation/);
  }
  await assert.rejects(cancelStripeSubscription(async (path, options) => {
    if (options) throw new Error('Stripe unavailable');
    return subscription;
  }, 'sub_example', 'FCC-test-cus_example', 'test'), /Stripe unavailable/);
});

test('only active Stripe subscriptions qualify, including scheduled cancellation until it takes effect', () => {
  assert.equal(stripeSubscriberReport(subscription).status, 'Active');
  assert.equal(stripeSubscriberReport({ ...subscription, cancel_at_period_end: true }).status, 'Active');
  for (const status of ['canceled', 'paused', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'trialing']) {
    assert.equal(stripeSubscriberReport({ ...subscription, status }).status, 'Inactive');
  }
  assert.equal(stripeSubscriberReport({ ...subscription, pause_collection: { behavior: 'void' } }).status, 'Inactive');
});

test('refunds and disputes override an active status; payer names and emails are not copied', () => {
  for (const charge of [{ refunded: true }, { amount_refunded: 100 }, { disputed: true }]) {
    const record = stripeSubscriberReport({ ...subscription, latest_invoice: { payment_intent: { latest_charge: charge } } });
    assert.equal(record.status, 'Inactive');
    assert.equal(record.paymentReversed, true);
  }
  const record = stripeSubscriberReport(subscription);
  assert.equal(JSON.stringify(record).includes('member@example.com') || JSON.stringify(record).includes('Example Member'), false);
  assert.equal(record.orderRef, 'FCC-1');
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
  assert.equal(first.payerEmails.get('sub_example'), 'member@example.com');
});

// A minimal Firestore stand-in: documents by path, equality queries and transactions.
const fakeDb = (documents) => {
  const snapshot = (path) => ({ exists: documents.has(path), data: () => documents.get(path), id: path.split('/').pop() });
  const collection = (name) => ({
    doc: (id) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }),
    where: (field, op, value) => ({ limit: () => ({ get: async () => ({ docs: [...documents.keys()]
      .filter((path) => path.startsWith(`${name}/`) && documents.get(path)[field] === value).map(snapshot) }) }) })
  });
  return { collection, runTransaction: async (run) => run({
    getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)),
    set: (ref, fields) => documents.set(ref.path, { ...documents.get(ref.path), ...fields })
  }) };
};

test('mirrored subscribers record the members they pay for, found from the subscription, its order or the payer\'s orders', async () => {
  const documents = new Map([
    ['subscriptions/sub_own', { membershipIds: ['M1'] }],
    ['orders/FCC-1', { email: 'payer@example.com', membershipIds: ['M2'] }],
    ['orders/FCC-2', { email: 'payer@example.com', membershipIds: ['M3', 'M2'] }]
  ]);
  const db = fakeDb(documents);
  assert.deepEqual(await subscriberMembershipIds(db, { id: 'sub_own', orderRef: 'FCC-1' }, 'payer@example.com'), ['M1']);
  assert.deepEqual(await subscriberMembershipIds(db, { id: 'sub_other', orderRef: 'FCC-1' }), ['M2']);
  assert.deepEqual(await subscriberMembershipIds(db, { id: 'sub_other', orderRef: '' }, 'payer@example.com'), ['M2', 'M3']);
  assert.deepEqual(await subscriberMembershipIds(db, { id: 'sub_other', orderRef: '' }), []);

  documents.set('stripeCustomers/FCC-test-cus_example', { membershipIds: ['M0'], firstImportedAt: 'earlier' });
  const records = [stripeSubscriberReport(subscription), stripeSubscriberReport({ ...subscription, id: 'sub_own' })];
  const imported = await importStripeSubscribers(db, records, 'test', 'now', new Map([['sub_example', 'payer@example.com']]));
  assert.deepEqual(imported.map((record) => record.membershipIds), [['M2'], ['M1']]);
  assert.deepEqual(documents.get('stripeCustomers/FCC-test-cus_example').membershipIds, ['M0', 'M2', 'M1']);
  assert.equal(documents.get('stripeCustomers/FCC-test-cus_example').firstImportedAt, 'earlier');
  const mirrored = documents.get('stripeSubscriptions/FCC-test-sub_example');
  assert.deepEqual(mirrored.membershipIds, ['M2']);
  assert.equal(mirrored.firstImportedAt, 'now');
  assert.equal(JSON.stringify([...documents.entries()].filter(([path]) => path.startsWith('stripe'))).includes('@'), false, 'no emails are stored');
});