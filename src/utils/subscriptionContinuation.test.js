import test from 'node:test';
import assert from 'node:assert/strict';
import { londonMidnight } from './clubYear.js';
import { continuationAnswer, continuationEmail, continuationOpen, continuationResult, needsContinuation } from './subscriptionContinuation.js';

const subscription = { status: 'active', email: 'payer@example.test', createdAt: new Date('2026-06-01T12:00:00Z'), cancelAt: null,
  items: [{ status: 'active', name: 'Blue', monthlyAmount: 25 }] };

test('payers can answer from 1 January until the next club year starts on 1 March', () => {
  assert.deepEqual([londonMidnight(2026, 11, 31), londonMidnight(2027, 0, 1), new Date(londonMidnight(2027, 2, 1) - 1), londonMidnight(2027, 2, 1)]
    .map((date) => continuationOpen(2027, date)), [false, true, true, false]);
});

test('only active subscriptions from before the renewal window that are not already ending are asked', () => {
  assert.equal(needsContinuation(subscription, 2027), true);
  assert.equal(needsContinuation({ ...subscription, createdAt: new Date('2027-01-05T12:00:00Z') }, 2027), false, 'a January subscriber has just agreed');
  assert.equal(needsContinuation({ ...subscription, cancelAt: new Date('2027-03-01T00:00:00Z') }, 2027), false);
  assert.equal(needsContinuation({ ...subscription, items: [{ status: 'cancelled' }] }, 2027), false);
  assert.equal(needsContinuation({ ...subscription, status: 'ended' }, 2027), false);
  assert.equal(continuationAnswer({ continuation: { renewalYear: 2027, status: 'confirmed' } }, 2027), 'confirmed');
  assert.equal(continuationAnswer({ continuation: { renewalYear: 2026, status: 'cancelled' } }, 2027), 'unconfirmed', 'last year’s answer does not count');
});

test('the email lists the items and has a green Confirm and a red Cancel button', () => {
  const mail = continuationEmail({ renewalYear: 2027, contact: 'treasurer@example.test', confirmUrl: 'https://site/subscription?key=k&answer=confirm',
    cancelUrl: 'https://site/subscription?key=k&answer=cancel', lines: [{ name: 'Blue <Sub>', names: ['Ann Lee'], price: '£25.00 a month' }] });
  assert.equal(mail.subject, 'Confirm or cancel your Forth Canoe Club subscription for 2027/28');
  assert.match(mail.body, /- Blue <Sub> \(Ann Lee\): £25\.00 a month/);
  assert.match(mail.body, /Confirm: https:\/\/site\/subscription\?key=k&answer=confirm\nCancel: https:\/\/site\/subscription\?key=k&answer=cancel/);
  assert.match(mail.body, /If you do not answer, it carries on as now\. You can change your answer until 28 February 2027\./);
  assert.match(mail.html, /background:#15803d"><a href="https:\/\/site\/subscription\?key=k&amp;answer=confirm"[^>]*>Confirm<\/a>/);
  assert.match(mail.html, /background:#b91c1c"><a href="https:\/\/site\/subscription\?key=k&amp;answer=cancel"[^>]*>Cancel<\/a>/);
  assert.match(mail.html, /Blue &lt;Sub&gt;/);
  assert.match(continuationEmail({ renewalYear: 2027, contact: 'x', confirmUrl: 'a', cancelUrl: 'b', lines: [], reminder: true }).subject, /^Reminder: confirm/);
  assert.match(continuationResult('cancelled', 2027), /stops at the end of February and nothing is taken from 1 March 2027/);
});
