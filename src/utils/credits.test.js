import test from 'node:test';
import assert from 'node:assert/strict';
import { creditMethodLabel, creditPaymentWording, validateCreditPayment } from './credits.js';

const now = new Date('2026-05-10T09:00:00Z');
const valid = { method: 'bank-transfer', amountPence: 4500, receivedAt: '2026-05-09', reference: ' FCC JONES ', note: '' };

test('a credit records how it was paid, the amount, the day received, a reference and a note', () => {
  assert.deepEqual(validateCreditPayment(valid, now).value,
    { method: 'bank-transfer', amountPence: 4500, receivedAt: new Date('2026-05-09T12:00:00Z'), reference: 'FCC JONES', note: '' });
  assert.equal(validateCreditPayment({ method: 'complimentary', amountPence: 0, receivedAt: '2026-05-10', note: 'Volunteer thank you' }, now).value.amountPence, 0);
  assert.ok(validateCreditPayment({ method: 'cash', amountPence: 100, receivedAt: '2026-05-10' }, now).value);
});

test('a credit is refused without a method, a sensible amount, a past date or the reference and note it needs', () => {
  const error = (changes) => validateCreditPayment({ ...valid, ...changes }, now).error;
  assert.match(error({ method: 'card' }), /how it was paid/);
  for (const amountPence of [-1, 1.5, '4500', 500001]) assert.match(error({ amountPence }), /amount received/);
  assert.match(error({ amountPence: 0 }), /Complimentary/);
  assert.match(error({ method: 'complimentary', note: 'x' }), /£0\.00/);
  assert.match(error({ receivedAt: '2026-02-30' }), /date it was received/);
  assert.match(error({ receivedAt: '2026-05-11' }), /future/);
  assert.match(error({ reference: '  ' }), /reference/);
  assert.match(error({ method: 'other', reference: '' }), /note/);
  assert.equal(validateCreditPayment(null, now).error, 'Choose how it was paid.');
});

test('receipts and reports name the payment method', () => {
  assert.equal(creditPaymentWording({ method: 'bank-transfer' }), 'Paid by bank transfer');
  assert.equal(creditPaymentWording({ method: 'cheque' }), 'Paid by cheque');
  assert.equal(creditPaymentWording({ method: 'complimentary' }), 'Complimentary (no charge)');
  assert.equal(creditPaymentWording({ method: 'other' }), 'Paid to the club directly');
  assert.equal(creditPaymentWording(null), '');
  assert.equal(creditMethodLabel('cash'), 'Cash');
});
