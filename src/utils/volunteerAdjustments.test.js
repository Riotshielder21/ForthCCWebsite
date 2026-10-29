import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VOLUNTEER_BENEFITS as tiers } from './volunteering.js';
import { annualAdjustment, monthlyAdjustment, monthsLeftIn, volunteerPriceFor, volunteerSignupYear, VOLUNTEER_ADJUSTMENT } from './volunteerAdjustments.js';

const august = new Date('2026-08-15T12:00:00Z');
const december = new Date('2026-12-15T12:00:00Z');
const february = new Date('2027-02-10T12:00:00Z');
const volunteer = (tier, year = 2026) => ({ volunteer: { inducted: true, years: { [year]: { active: true, tier } } } });
const blue = { id: 'blue-sub', basePrice: 25, type: 'subscription', hasAnnualDiscount: true };
const boatHire = { id: 'boat-hire', basePrice: 85, type: 'yearly-service', pricingMode: 'prorated' };
const keyHire = { id: 'keyhire', basePrice: 50, type: 'yearly-service', pricingMode: 'fixed' };

test('February sign-ups, after the last monthly debit, count for next club year', () => {
  assert.equal(volunteerSignupYear(new Date('2027-01-31T12:00:00Z')), 2026);
  assert.equal(volunteerSignupYear(february), 2027);
  assert.equal(volunteerSignupYear(new Date('2027-03-01T12:00:00Z')), 2027);
  assert.equal(monthsLeftIn(2026, december), 2);
  assert.equal(monthsLeftIn(2026, february), 0);
  assert.equal(monthsLeftIn(2027, february), 12);
  assert.equal(monthsLeftIn(2025, december), 0);
});

test('the volunteer price needs every holder to share the benefit', () => {
  const members = new Map([['m1', volunteer('20')], ['m2', {}]]);
  const price = (membershipIds, clubYear = 2026) => volunteerPriceFor({ productId: 'blue-sub', basePrice: 25, membershipIds, clubYear, members, tiers, now: august });
  assert.equal(price(['m1']), 20);
  assert.equal(price(['m1', 'm2']), null);
  assert.equal(price(['m1'], 2027), null, 'next year needs next year’s volunteering');
  assert.equal(price(['m1'], 2025), null);
});

test('existing monthly items are lowered from the next debit or removed when free, never raised', () => {
  const item = { status: 'active', clubYear: 2026, monthlyAmount: 25 };
  assert.deepEqual(monthlyAdjustment({ item, volunteerPrice: 20, now: august }), { action: 'reprice', from: 25, to: 20 });
  assert.deepEqual(monthlyAdjustment({ item, volunteerPrice: 0, now: august }), { action: 'remove', from: 25, to: 0 });
  assert.equal(monthlyAdjustment({ item: { ...item, monthlyAmount: 18 }, volunteerPrice: 20, now: august }), null, 'a lower promo price stays');
  assert.equal(monthlyAdjustment({ item, volunteerPrice: null, now: august }), null);
  assert.equal(monthlyAdjustment({ item: { ...item, cancelScheduledAt: 'x' }, volunteerPrice: 0, now: august }), null);
  assert.equal(monthlyAdjustment({ item, volunteerPrice: 20, now: february }), null, 'no debits left after 1 February');
});

test('annual Blue and Gold: monthly saving × months left, less the 20% annual discount', () => {
  const item = { id: 'blue-sub', price: 240, clubYear: 2026 };
  // August: Sep–Feb is six months; £5 × 6 × 0.8 = £24.
  assert.deepEqual(annualAdjustment({ item, product: blue, volunteerPrice: 20, now: august }),
    { adjusted: false, amount: 2400, months: 6, basis: '£5.00 a month saving × 6 months left, less the 20% annual discount' });
  assert.equal(annualAdjustment({ item, product: { ...blue, hasAnnualDiscount: false }, volunteerPrice: 20, now: august }).amount, 3000);
  assert.equal(annualAdjustment({ item, product: blue, volunteerPrice: 20, now: february }), null, 'no offer in the last month');
  assert.equal(annualAdjustment({ item: { ...item, volunteerBenefit: true }, product: blue, volunteerPrice: 20, now: august }), null, 'already discounted at checkout');
  assert.equal(annualAdjustment({ item: { ...item, monthly: true }, product: blue, volunteerPrice: 20, now: august }), null);
});

test('annual items that become free: paid ÷ months covered × months left', () => {
  // Bought in October at the 60% late-year price (£51 for five months); two months left in December.
  const lateHire = { id: 'boat-hire', price: 51, clubYear: 2026, pricingMode: 'prorated' };
  assert.equal(annualAdjustment({ item: lateHire, product: boatHire, volunteerPrice: 0, paidAt: new Date('2026-10-05T12:00:00Z'), now: december }).amount, 2040);
  const fullHire = { ...lateHire, price: 85 };
  assert.equal(annualAdjustment({ item: fullHire, product: boatHire, volunteerPrice: 0, paidAt: new Date('2026-04-05T12:00:00Z'), now: december }).amount, 1417);
  const key = { id: 'keyhire', price: 50, clubYear: 2026 };
  assert.equal(annualAdjustment({ item: key, product: keyHire, volunteerPrice: 0, paidAt: new Date('2026-04-05T12:00:00Z'), now: august }).amount, 2500);
  assert.equal(annualAdjustment({ item: key, product: keyHire, volunteerPrice: 10, paidAt: august, now: august }), null, 'only free items are refunded pro rata');
});

test('annual refunds are capped by earlier refunds and offered once', () => {
  const item = { id: 'keyhire', price: 50, clubYear: 2026, refunds: [{ amount: 4000, status: 'succeeded' }, { amount: 900, status: 'failed' }] };
  assert.equal(annualAdjustment({ item, product: keyHire, volunteerPrice: 0, paidAt: august, now: august }).amount, 1000);
  const adjusted = { ...item, refunds: [{ amount: 2500, status: 'pending', purpose: VOLUNTEER_ADJUSTMENT }] };
  assert.deepEqual(annualAdjustment({ item: adjusted, product: keyHire, volunteerPrice: 0, now: august }), { adjusted: true, amount: 2500 });
});
