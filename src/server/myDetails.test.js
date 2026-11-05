import test from 'node:test';
import assert from 'node:assert/strict';
import { updateStripeCustomerEmails } from './myDetails.js';

const document = (id) => ({ id });

test('Stripe billing customers follow a confirmed member email change once each', async () => {
  const calls = [];
  const request = async (path, params, method) => {
    calls.push({ path, params, method });
    if (path === 'subscriptions/sub_one') return { customer: 'cus_shared' };
    if (path === 'subscriptions/sub_two') return { customer: { id: 'cus_shared' } };
    if (path === 'subscriptions/sub_three') return { customer: 'cus_other' };
    return { id: path.split('/').at(-1) };
  };

  const customers = await updateStripeCustomerEmails(request,
    [document('sub_one'), document('sub_two'), document('sub_three')], 'new@example.test');

  assert.deepEqual(customers, ['cus_shared', 'cus_other']);
  assert.deepEqual(calls, [
    { path: 'subscriptions/sub_one', params: null, method: 'GET' },
    { path: 'subscriptions/sub_two', params: null, method: 'GET' },
    { path: 'subscriptions/sub_three', params: null, method: 'GET' },
    { path: 'customers/cus_shared', params: [['email', 'new@example.test']], method: 'POST' },
    { path: 'customers/cus_other', params: [['email', 'new@example.test']], method: 'POST' }
  ]);
});

test('Stripe billing email updates reject subscriptions without a valid customer', async () => {
  const calls = [];
  await assert.rejects(updateStripeCustomerEmails(async (path) => {
    calls.push(path);
    return { customer: 'invalid' };
  }, [document('sub_missing')], 'new@example.test'), /no valid customer/);
  assert.deepEqual(calls, ['subscriptions/sub_missing']);
});

test('an email change without active payer subscriptions makes no Stripe requests', async () => {
  let called = false;
  assert.deepEqual(await updateStripeCustomerEmails(async () => { called = true; }, [], 'new@example.test'), []);
  assert.equal(called, false);
});
