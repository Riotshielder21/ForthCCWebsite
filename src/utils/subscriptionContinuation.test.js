import test from 'node:test';
import assert from 'node:assert/strict';
import { londonMidnight } from './clubYear.js';
import { continuationAnswer, continuationOpen, continuationResult, needsContinuation, pricingYear, renewalPrice } from './subscriptionContinuation.js';
import { DEFAULT_VOLUNTEER_BENEFITS } from './volunteering.js';

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
  assert.equal(needsContinuation({ ...subscription, clubYear: 2027 }, 2027), false, 'one bought for the renewal year only starts then');
  assert.equal(continuationAnswer({ continuation: { renewalYear: 2027, status: 'confirmed' } }, 2027), 'confirmed');
  assert.equal(continuationAnswer({ continuation: { renewalYear: 2026, status: 'cancelled' } }, 2027), 'unconfirmed', 'last year’s answer does not count');
});

test('the member is told what their answer means', () => {
  assert.match(continuationResult('cancelled', 2027), /stops at the end of February and nothing is taken from 1 March 2027/);
});

test('from 1 March a subscription costs the new club year\'s shop price, with the volunteer price only for that year\'s volunteers', () => {
  const gold = { id: 'gold-sub', basePrice: 30, hasAnnualDiscount: true };
  const february = new Date('2027-02-10T12:00:00Z');
  const item = { productId: 'gold-sub', interval: 'month', monthlyAmount: 15, clubYear: 2026, membershipIds: ['m1'] };
  const priced = (members, overrides = {}) => renewalPrice({ item: { ...item, ...overrides }, product: gold, members: new Map(Object.entries(members)),
    tiers: DEFAULT_VOLUNTEER_BENEFITS, renewalYear: 2027, now: february });
  const volunteering = (years) => ({ firstName: 'Cora', volunteer: { inducted: true, years } });
  assert.deepEqual(priced({ m1: {} }), { price: 30 }, 'a discount code covered only the year it was used in');
  assert.deepEqual(priced({ m1: {} }, { interval: 'year', yearlyAmount: 115.2 }), { price: 288 }, 'twelve months less the annual discount');
  assert.deepEqual(priced({ m1: volunteering({ 2027: { active: true, tier: '40' } }) }), { price: 10 }, 'signed up for next year: the volunteer price');
  assert.deepEqual(priced({ m1: volunteering({ 2026: { active: true, tier: '40' } }) }), { price: 30, ifVolunteering: 10, volunteers: ['Cora'] },
    'volunteered this year only: both prices, until they sign up again');
  assert.deepEqual(priced({ m1: volunteering({ 2026: { active: true, tier: '60' } }) }, { interval: 'year', yearlyAmount: 0 }), { price: 288, ifVolunteering: 0, volunteers: ['Cora'] });
  assert.deepEqual(priced({ m1: {} }, { clubYear: 2027 }), { price: 15 }, 'one bought for the new club year keeps its price');
});

test('subscriptions are charged the new club year\'s prices from 2 February, once February\'s payment is taken', () => {
  assert.deepEqual([londonMidnight(2027, 1, 1), new Date(londonMidnight(2027, 1, 2) - 1), londonMidnight(2027, 1, 2), londonMidnight(2027, 2, 1), londonMidnight(2027, 9, 10)]
    .map((date) => pricingYear(date)), [2026, 2026, 2027, 2027, 2027]);
});
