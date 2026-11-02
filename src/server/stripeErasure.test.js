import test from 'node:test';
import assert from 'node:assert/strict';
import { eraseStripeDetails } from './stripeErasure.js';

const fixture = ({ shared = false, fail = false, missing = false } = {}) => {
  const calls = [];
  const customer = { id: 'cus_payer', email: 'erased@example.test' };
  const subscription = { id: 'sub_erased', status: shared ? 'past_due' : 'canceled', customer: customer.id,
    metadata: { name: 'Private name', club_year: '2026', cutoff_at: '1803859200' } };
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    const url = new URL(path, 'https://stripe.invalid/');
    if (path === 'subscriptions/sub_erased' && !options.method) {
      if (missing) throw Object.assign(new Error('Missing subscription'), { stripeCode: 'resource_missing' });
      return subscription;
    }
    if (options.method === 'POST') {
      if (fail) throw new Error('Stripe unavailable');
      return { id: url.pathname.split('/').at(-1) };
    }
    if (options.method === 'DELETE') return { id: customer.id, deleted: true };
    if (url.pathname === '/customers') return { data: [customer], has_more: false };
    if (url.pathname === '/subscriptions') return { data: [subscription], has_more: false };
    throw new Error(`Unexpected request: ${path}`);
  };
  return { calls, request };
};

test('erasure clears personal subscription metadata and deletes an unused customer after clearing its contact data', async () => {
  const { calls, request } = fixture();
  assert.deepEqual(await eraseStripeDetails(request, { subscriptionIds: ['sub_erased'], emails: new Set(['erased@example.test']) }), { deleted: 1, retained: 0 });
  const metadata = calls.find((call) => call.path === 'subscriptions/sub_erased' && call.method === 'POST').body;
  assert.equal(metadata.get('metadata[name]'), '');
  assert.equal(metadata.has('metadata[club_year]'), false, 'keep financial schedule markers');
  const updates = calls.filter((call) => call.path === 'customers/cus_payer');
  assert.deepEqual(updates.map((call) => call.method), ['POST', 'DELETE']);
  for (const field of ['name', 'email', 'phone', 'address', 'shipping', 'description', 'metadata']) assert.equal(updates[0].body.get(field), '');
});

test('a payer still funding other members is anonymised, not deleted or cancelled, even when past due', async () => {
  const { calls, request } = fixture({ shared: true });
  assert.deepEqual(await eraseStripeDetails(request, { subscriptionIds: ['sub_erased'], emails: new Set(['erased@example.test']) }), { deleted: 0, retained: 1 });
  assert.equal(calls.some((call) => call.method === 'DELETE'), false);
  assert.ok(calls.some((call) => call.path === 'customers/cus_payer' && call.method === 'POST'));
});

test('Stripe erasure failures are propagated, not reported as success', async () => {
  const { request } = fixture({ fail: true });
  await assert.rejects(eraseStripeDetails(request, { subscriptionIds: ['sub_erased'], emails: new Set(['erased@example.test']) }), /Stripe unavailable/);
});

test('an already missing subscription does not prevent deleting a remaining customer on retry', async () => {
  const { request } = fixture({ missing: true });
  assert.equal((await eraseStripeDetails(request, { subscriptionIds: ['sub_erased'], emails: new Set(['erased@example.test']) })).deleted, 1);
});

test('customer and subscription searches follow every Stripe page before deciding deletion is safe', async () => {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push(path);
    if (options.method) return {};
    const url = new URL(path, 'https://stripe.invalid/');
    if (url.pathname === '/customers') return url.searchParams.has('starting_after')
      ? { data: [{ id: 'cus_second' }], has_more: false } : { data: [{ id: 'cus_first' }], has_more: true };
    if (url.searchParams.get('customer') === 'cus_second') return { data: [], has_more: false };
    return url.searchParams.has('starting_after')
      ? { data: [{ id: 'sub_live', status: 'active' }], has_more: false } : { data: [{ id: 'sub_old', status: 'canceled' }], has_more: true };
  };
  await assert.rejects(eraseStripeDetails(request, { subscriptionIds: [], emails: new Set(['erased@example.test']) }), /unlinked active subscription/);
  assert.ok(calls.some((path) => path.includes('starting_after=sub_old')));
});

test('a previously anonymised shared payer is deleted when the final beneficiary is erased later', async () => {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === 'subscriptions/sub_last') return { id: 'sub_last', status: 'canceled', customer: 'cus_anonymous', metadata: {} };
    if (path === 'customers/cus_anonymous') return { id: 'cus_anonymous', email: '', name: '' };
    return { data: [], has_more: false };
  };
  const result = await eraseStripeDetails(request, { subscriptionIds: ['sub_last'], emails: new Set(),
    erasedPayerSubscriptionIds: new Set(['sub_last']) });
  assert.equal(result.deleted, 1);
  assert.ok(calls.some((call) => call.path === 'customers/cus_anonymous' && call.method === 'DELETE'));
});
