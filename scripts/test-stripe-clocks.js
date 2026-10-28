import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClubYearSubscription } from '../src/server/clubYearSubscription.js';
import { clubYearDates, monthlyDebits } from '../src/utils/clubYear.js';

const keyFile = process.argv[2];
if (!keyFile) throw new Error('Usage: node scripts/test-stripe-clocks.js /absolute/path/to/sandbox-key-file');
const text = await readFile(keyFile, 'utf8');
const key = text.match(/\brk_test_[A-Za-z0-9]+\b/)?.[0];
if (!key || /\b(?:sk|rk)_live_/.test(text)) throw new Error('Use a restricted test-mode key only, with no live key in the file.');
const run = `fcc-clock-${randomUUID()}`;
const caseNames = ['current-year', 'next-year', 'delayed-payment', 'failed-payment'];
if (process.env.STRIPE_CLOCK_CASE && !caseNames.includes(process.env.STRIPE_CLOCK_CASE)) {
  throw new Error(`STRIPE_CLOCK_CASE must be one of: ${caseNames.join(', ')}`);
}
const seconds = (date) => Math.floor(new Date(date).getTime() / 1000);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clocks = [];
const products = [];
let failures = 0;

const request = async (path, params, method = 'POST', { idempotencyKey } = {}) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(params && method !== 'GET' ? { body: new URLSearchParams(params) } : {}),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Stripe ${response.status} ${method} ${path.split('?')[0]}: ${data.error?.message || 'request failed'}`);
  if (data.livemode === true) throw new Error('Refusing a live-mode object.');
  return data;
};
const get = (path) => request(path, null, 'GET');

const advance = async (clock, date) => {
  await request(`test_helpers/test_clocks/${clock}/advance`, { frozen_time: String(seconds(date)) });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const state = await get(`test_helpers/test_clocks/${clock}`);
    if (state.status === 'ready') {
      assert.equal(state.frozen_time, seconds(date), 'Stripe must reach the requested instant');
      return;
    }
    if (state.status !== 'advancing') throw new Error(`Clock entered ${state.status}`);
    await pause(1500);
  }
  throw new Error('Stripe test clock did not become ready within two minutes');
};

const fixture = async (name, date, paymentMethod = 'pm_card_visa') => {
  const clock = await request('test_helpers/test_clocks', { frozen_time: String(seconds(date)), name: `${run}-${name}` });
  clocks.push(clock.id);
  const customer = await request('customers', { test_clock: clock.id, email: `${run}-${name}@example.test`,
    name: 'Synthetic FCC clock test', 'metadata[fcc_clock_test]': run });
  const method = await request(`payment_methods/${paymentMethod}/attach`, { customer: customer.id });
  await request(`customers/${customer.id}`, { 'invoice_settings[default_payment_method]': method.id });
  const product = await request('products', { name: `${run}-${name}`, 'metadata[fcc_clock_test]': run });
  products.push(product.id);
  return { clock: clock.id, customer: customer.id, method: method.id, product: product.id, name };
};

const create = async (f, { now, firstDebit, subscriptionEnd, clubYear = 2026, amount = 2000 }) => {
  const orderRef = `${run}-${f.name}`;
  return createClubYearSubscription(request, {
    now: new Date(now), firstDebit: seconds(firstDebit), subscriptionEnd: seconds(subscriptionEnd), clubYear, orderRef,
    base: [['customer', f.customer], ['default_payment_method', f.method],
      ['metadata[order_ref]', orderRef], ['metadata[club_year]', String(clubYear)], ['metadata[cutoff_at]', String(seconds(subscriptionEnd))],
      ['items[0][price_data][currency]', 'gbp'], ['items[0][price_data][product]', f.product],
      ['items[0][price_data][unit_amount]', String(amount)], ['items[0][price_data][recurring][interval]', 'month']]
  });
};
const invoices = async (f) => {
  const result = await get(`invoices?${new URLSearchParams({ customer: f.customer, limit: '100' })}`);
  assert.equal(result.has_more, false, 'Do not silently truncate invoice assertions');
  return result.data;
};
const charged = (rows) => rows.filter((invoice) => invoice.amount_due > 0);
const invoiceSummary = (rows) => JSON.stringify(rows.map((invoice) => ({
  status: invoice.status, due: invoice.amount_due, paid: invoice.amount_paid, attempted: invoice.attempted,
  autoAdvance: invoice.auto_advance, nextAttempt: invoice.next_payment_attempt,
  automaticallyFinalizesAt: invoice.automatically_finalizes_at, lastFinalizationError: invoice.last_finalization_error
})));

const test = async (name, fn) => {
  if (process.env.STRIPE_CLOCK_CASE && process.env.STRIPE_CLOCK_CASE !== name) return;
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.message}`); }
};

try {
  await test('current-year', async () => {
    const f = await fixture('current', '2026-11-10T12:00:00Z');
    const schedule = monthlyDebits(2026, new Date('2026-11-10T12:00:00Z'));
    const sub = await create(f, { now: '2026-11-10T12:00:00Z', firstDebit: schedule.firstDebit, subscriptionEnd: schedule.subscriptionEnd });
    assert.equal(sub.status, 'trialing');
    assert.equal(sub.trial_end, seconds('2026-12-01T00:00:00Z'));
    assert.equal(charged(await invoices(f)).length, 0, 'No recurring charge on purchase day');
    const repeated = await create(f, { now: '2026-11-10T12:00:00Z', firstDebit: schedule.firstDebit, subscriptionEnd: schedule.subscriptionEnd });
    assert.equal(repeated.id, sub.id, 'Retry must return the same subscription');
    for (const date of ['2026-12-01', '2027-01-01', '2027-02-01']) {
      await advance(f.clock, `${date}T00:00:00Z`);
      await advance(f.clock, `${date}T02:00:00Z`);
    }
    const rows = charged(await invoices(f));
    assert.equal(rows.length, 3, 'December, January and February only');
    await advance(f.clock, '2027-02-15T00:00:00Z');
    assert.notEqual((await get(`subscriptions/${sub.id}`)).status, 'canceled', 'Subscription remains active through the full February payment period');
    await advance(f.clock, '2027-03-01T00:00:00Z');
    assert.equal((await get(`subscriptions/${sub.id}`)).status, 'canceled');
    await advance(f.clock, '2027-03-02T00:00:00Z');
    const final = await invoices(f);
    assert.equal(charged(final).length, 3, 'No March debit');
    assert.ok(final.every((invoice) => invoice.total >= 0), 'No cancellation credit');
    assert.ok(rows.every((invoice) => invoice.status === 'paid' && invoice.amount_paid === 2000), `Cancellation/no-March checks passed, but every debit must be paid and exactly £20: ${invoiceSummary(rows)}`);
  });

  await test('next-year', async () => {
    const now = '2027-01-05T12:00:00Z';
    const f = await fixture('next', now);
    const schedule = monthlyDebits(2027, new Date(now));
    const sub = await create(f, { now, firstDebit: schedule.firstDebit, subscriptionEnd: schedule.subscriptionEnd, clubYear: 2027 });
    assert.equal(sub.status, 'trialing');
    assert.equal(sub.trial_end, seconds('2027-03-01T00:00:00Z'));
    await advance(f.clock, '2027-02-28T23:59:00Z');
    assert.equal(charged(await invoices(f)).length, 0, 'Renewing in January must not debit January or February');
    for (let month = 2; month < 14; month += 1) {
      const date = new Date(Date.UTC(2027, month, 1));
      await advance(f.clock, date);
      await advance(f.clock, new Date(date.getTime() + 7200000));
    }
    const rows = charged(await invoices(f));
    assert.equal(rows.length, 12, 'Exactly twelve debits from March to February');
    await advance(f.clock, '2028-02-15T00:00:00Z');
    assert.notEqual((await get(`subscriptions/${sub.id}`)).status, 'canceled', 'Subscription remains active through the full February payment period');
    await advance(f.clock, clubYearDates(2027).end);
    assert.equal((await get(`subscriptions/${sub.id}`)).status, 'canceled');
    await advance(f.clock, '2028-03-02T00:00:00Z');
    assert.equal(charged(await invoices(f)).length, 12, 'No thirteenth debit');
    assert.ok(rows.every((invoice) => invoice.status === 'paid' && invoice.amount_paid === 2000), `Cancellation/no-thirteenth-debit checks passed, but monthly amounts differ: ${invoiceSummary(rows)}`);
  });

  await test('delayed-payment', async () => {
    const now = '2026-12-04T12:00:00Z';
    const f = await fixture('delayed', now);
    const sub = await create(f, { now, firstDebit: '2026-12-01T00:00:00Z', subscriptionEnd: '2027-03-01T00:00:00Z' });
    assert.equal(sub.status, 'active');
    assert.equal(sub.billing_cycle_anchor, seconds('2027-01-01T00:00:00Z'));
    const rows = charged(await invoices(f));
    assert.equal(rows.length, 1, 'Catch-up month billed once');
    assert.equal(rows[0].amount_due, 2000, 'Delayed December payment must charge one full month, not a partial or double month');
    await advance(f.clock, '2027-01-01T00:00:00Z');
    await advance(f.clock, '2027-01-01T02:00:00Z');
    const final = charged(await invoices(f));
    assert.equal(final.length, 2, 'Normal January billing follows one catch-up debit');
    assert.ok(final.every((invoice) => invoice.amount_due === 2000));
    await advance(f.clock, '2027-02-01T00:00:00Z');
    await advance(f.clock, '2027-02-01T02:00:00Z');
    const february = charged(await invoices(f));
    assert.equal(february.length, 3, 'Full February debit follows the delayed catch-up and January debit');
    assert.ok(february.every((invoice) => invoice.status === 'paid' && invoice.amount_paid === 2000), `Delayed payment case must keep all monthly payments full: ${invoiceSummary(february)}`);
    await advance(f.clock, '2027-03-01T00:00:00Z');
    assert.equal((await get(`subscriptions/${sub.id}`)).status, 'canceled');
    await advance(f.clock, '2027-03-02T00:00:00Z');
    assert.equal(charged(await invoices(f)).length, 3, 'No March debit after full February payment');
  });

  await test('failed-payment', async () => {
    const now = '2027-01-10T12:00:00Z';
    const f = await fixture('failed', now, 'pm_card_chargeCustomerFail');
    const sub = await create(f, { now, firstDebit: '2027-02-01T00:00:00Z', subscriptionEnd: '2027-03-01T00:00:00Z' });
    await advance(f.clock, '2027-02-01T00:00:00Z');
    await advance(f.clock, '2027-02-01T02:00:00Z');
    const before = charged(await invoices(f));
    assert.equal(before.length, 1);
    assert.equal(before[0].status, 'open', 'The test card must produce an unpaid invoice');
    assert.equal(before[0].amount_paid, 0);
    assert.equal(before[0].attempted, true);
    await advance(f.clock, '2027-02-15T00:00:00Z');
    assert.notEqual((await get(`subscriptions/${sub.id}`)).status, 'canceled', 'Failed February payment remains retryable until club-year end');
    await advance(f.clock, '2027-03-01T00:00:00Z');
    assert.equal((await get(`subscriptions/${sub.id}`)).status, 'canceled');
    const stopped = charged(await invoices(f));
    assert.ok(stopped.every((invoice) => !invoice.auto_advance), `Stripe must stop automatic collection on cancellation: ${invoiceSummary(stopped)}`);
    const attempts = stopped.map((invoice) => [invoice.id, invoice.attempt_count]);
    await advance(f.clock, '2027-03-02T00:00:00Z');
    const after = charged(await invoices(f));
    assert.equal(after.length, 1, 'No March invoice after a failed February debit');
    assert.deepEqual(after.map((invoice) => [invoice.id, invoice.attempt_count]), attempts, 'No further attempts after cancellation');
  });
} finally {
  for (const clock of clocks) {
    try { await request(`test_helpers/test_clocks/${clock}`, null, 'DELETE'); }
    catch (error) { failures += 1; console.error(`CLEANUP ${clock}: ${error.message}`); }
  }
  for (const product of products) {
    try { await request(`products/${product}`, { active: 'false' }); }
    catch (error) { failures += 1; console.error(`CLEANUP ${product}: ${error.message}`); }
  }
  // Confirm cleanup from Stripe itself rather than trusting the delete calls.
  const remaining = [];
  let after = null;
  do {
    const page = await get(`test_helpers/test_clocks?${new URLSearchParams({ limit: '100', ...(after ? { starting_after: after } : {}) })}`);
    remaining.push(...page.data.filter((clock) => String(clock.name || '').startsWith(run)).map((clock) => clock.id));
    after = page.has_more ? page.data.at(-1).id : null;
  } while (after);
  const active = [];
  for (const product of products) if ((await get(`products/${product}`)).active) active.push(product);
  if (remaining.length || active.length) {
    failures += 1;
    console.error(`CLEANUP NOT CONFIRMED: clocks ${remaining.join(', ') || 'none'}; active products ${active.join(', ') || 'none'}`);
  } else console.log(`CLEANUP CONFIRMED ${run}: ${clocks.length} clock(s) gone, ${products.length} product(s) archived.`);
}
console.log(`Stripe clock tests finished: ${failures} failure(s). Clock customers/subscriptions deleted; catalogue fixtures archived.`);
if (failures) process.exitCode = 1;
