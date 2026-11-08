import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceFailureEmail, invoicePeriodStart, orderFailureEmail, paidUpTo, restartBasket, retryBasket, splitLinkKey,
  subscriptionStoppedEmail, treasurerFailureEmail } from './failedPayments.js';

const token = 'a'.repeat(64);
const seconds = (iso) => Date.parse(iso) / 1000;

test('emailed link keys are an id and a 64-character token', () => {
  assert.deepEqual(splitLinkKey(`FCC-00000001.${token}`), { id: 'FCC-00000001', token });
  assert.deepEqual(splitLinkKey(`sub_123.${token}`), { id: 'sub_123', token });
  for (const bad of ['', token, `FCC-1.${'a'.repeat(63)}`, `../x.${token}`, `.${token}`]) assert.equal(splitLinkKey(bad), null, bad);
});

test('the paid-up date is the start of the earliest unpaid period, else the end of the current one', () => {
  const december = { period_start: seconds('2025-11-01'), period_end: seconds('2025-12-01'),
    lines: { data: [{ period: { start: seconds('2025-12-01'), end: seconds('2026-01-01') } }] } };
  const january = { lines: { data: [{ period: { start: seconds('2026-01-01'), end: seconds('2026-02-01') } }] } };
  assert.equal(invoicePeriodStart(december), seconds('2025-12-01'), 'the line period, not the invoice period');
  assert.equal(paidUpTo([january, december], seconds('2026-02-01')), seconds('2025-12-01'));
  assert.equal(paidUpTo([], seconds('2026-02-01')), seconds('2026-02-01'));
  assert.equal(invoicePeriodStart({ period_end: seconds('2025-12-01'), lines: { data: [] } }), seconds('2025-12-01'));
});

test('a retry basket rebuilds the failed order\'s lines and people for checkout', () => {
  const order = {
    items: [
      { id: 'membership-adult', lineId: 'm1', clubYear: 2025, clubYearPart: 'this', sourceLineId: 'm1' },
      { id: 'gold-sub', lineId: 'g1', clubYear: 2025, clubYearPart: 'this', sourceLineId: 'g1' },
      { id: 'gold-sub', lineId: 'g1~next', clubYear: 2026, clubYearPart: 'next', sourceLineId: 'g1' },
      { id: 'hoodie', lineId: 'h1', size: 'M' },
      { id: 'old-sub', lineId: 'o1', clubYear: 2024, sourceLineId: 'o1' }
    ],
    people: [
      { id: 'p1', firstName: 'Alex', lastName: 'Adult', dob: '1990-01-01', lineIds: ['m1', 'g1', 'g1~next', 'h1', 'o1'], ownKitLineIds: [],
        membershipId: 'ABC123', existingMember: false, householdId: 'H1', grantMembership: true, emergencyContact: { name: 'Pat' } },
      { id: 'p2', firstName: 'Only', lastName: 'Old', lineIds: ['o1'] }
    ]
  };
  const basket = retryBasket(order, 2025);
  assert.deepEqual(basket.items, [
    { id: 'membership-adult', lineId: 'm1', clubYearChoice: 'this' },
    { id: 'gold-sub', lineId: 'g1', clubYearChoice: 'both' },
    { id: 'hoodie', lineId: 'h1', size: 'M' }
  ], 'a passed club year is left out');
  assert.equal(basket.people.length, 1, 'nobody is left with nothing to buy');
  const [person] = basket.people;
  assert.deepEqual(person.lineIds, ['m1', 'g1', 'h1']);
  assert.equal(person.emergencyContact.name, 'Pat');
  for (const field of ['membershipId', 'existingMember', 'householdId', 'grantMembership']) assert.ok(!(field in person), field);
  assert.deepEqual(retryBasket(order, 2026).items.find((item) => item.id === 'gold-sub'), { id: 'gold-sub', lineId: 'g1', clubYearChoice: 'this' });
});

test('a restart basket has the stopped items for the same returning members', () => {
  let index = 0;
  const record = { clubYear: 2025, items: [
    { productId: 'membership-family', membershipIds: ['A', 'B'] },
    { productId: 'gold-sub', membershipIds: ['A'] },
    { productId: 'lost', membershipIds: ['Z'] }
  ] };
  const members = [{ id: 'A', firstName: 'Ann', lastName: 'Adult', dob: '1980-02-02' }, { id: 'B', firstName: 'Ben', lastName: 'Adult', dob: '2015-03-03' }];
  const now = new Date('2025-10-01');
  const basket = restartBasket(record, members, 2025, () => `r${++index}`, now);
  assert.equal(basket.clubYearChoice, 'this');
  assert.deepEqual(basket.items.map((item) => item.id), ['membership-family', 'gold-sub'], 'items with nobody to hold them are left out');
  assert.deepEqual(basket.people.map((person) => [person.firstName, person.returning, person.junior, person.lineIds.length]), [['Ann', true, false, 2], ['Ben', true, true, 1]]);
  assert.equal(restartBasket(record, members, 2026, () => 'x', now), null, 'a finished club year cannot be restarted');
  assert.equal(restartBasket({ ...record, clubYear: 2026 }, members, 2025, () => 'x', now).clubYearChoice, 'next');
});

test('failed-debit emails say when Stripe retries, or that payments stopped with restart and cancel links', () => {
  const common = { names: ['Ann', 'Ben'], itemNames: ['Gold Subscription'], amountDuePence: 2000, contact: 'treasurer@example.test' };
  const retry = invoiceFailureEmail({ ...common, attempt: 1, nextAttempt: seconds('2025-12-04T10:00:00Z') });
  assert.match(retry.subject, /did not go through/);
  assert.match(retry.body, /£20\.00 for Gold Subscription \(Ann and Ben\)/);
  assert.match(retry.body, /try again on 4 December 2025/);
  assert.doesNotMatch(retry.body, /restart/i);

  const final = invoiceFailureEmail({ ...common, attempt: 4, nextAttempt: null, paidUntil: seconds('2025-12-01'), restartUrl: 'https://x/membership?restart=K', cancelUrl: 'https://x/payment-issue?subscription=K' });
  assert.match(final.subject, /stopped/);
  assert.match(final.body, /runs until 1 December 2025/);
  assert.match(final.body, /https:\/\/x\/membership\?restart=K/);
  assert.match(final.body, /https:\/\/x\/payment-issue\?subscription=K/);

  const stopped = subscriptionStoppedEmail({ ...common, paidUntil: seconds('2025-12-01'), restartUrl: 'R', cancelUrl: 'C' });
  assert.match(stopped.body, /have stopped/);
  assert.match(stopped.body, /R/);

  const copy = treasurerFailureEmail({ ...common, email: 'ann@example.test', attempt: 4, subscriptionId: 'sub_1', invoiceId: 'in_1', paidUntil: seconds('2025-12-01') });
  assert.match(copy.body, /£20\.00 from ann@example\.test after 4 attempts/);
  assert.match(copy.body, /sub_1/);
});

test('a failed bank payment email links to retry or cancel the order', () => {
  const mail = orderFailureEmail({ orderRef: 'FCC-1', itemNames: ['Hoodie', 'Membership'], retryUrl: 'https://x/membership?retry=K', cancelUrl: 'https://x/payment-issue?order=K', retryDays: 30, contact: 't@example.test' });
  assert.match(mail.subject, /FCC-1/);
  assert.match(mail.body, /Hoodie and Membership/);
  assert.match(mail.body, /Retry payment: https:\/\/x\/membership\?retry=K/);
  assert.match(mail.body, /Cancel order: https:\/\/x\/payment-issue\?order=K/);
});
