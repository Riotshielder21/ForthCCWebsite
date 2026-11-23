import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCart, expandClubYearLines, expandPeopleLines } from './pricing.js';
import { PRODUCTS } from '../constants/products.js';

const now = new Date(2026, 9, 1);
const membership = { id: 'member', category: 'MEMBERSHIP', type: 'annual-oneoff', basePrice: 30 };
const service = { id: 'service', category: 'SERVICES', type: 'annual-oneoff', basePrice: 85 };
const subscription = { id: 'sub', category: 'SUBSCRIPTIONS', type: 'subscription', pricingMode: 'subscription', allowMonthly: true, basePrice: 25, hasAnnualDiscount: true };

test('each purchasable starter product can be priced as a one-item cart', () => {
  // 1 September: before prorated items drop to 60%, and a whole joining month for monthly items.
  const now = new Date(2026, 8, 1);
  const products = PRODUCTS.filter((product) => product.type !== 'external');
  assert.ok(products.length > 0);

  for (const product of products) {
    const result = calculateCart([product], false, null, now);
    assert.equal(result.items.length, 1, `${product.id} has one priced line`);
    assert.equal(result.items[0].displayPrice, product.basePrice, `${product.id} retains its one-off/monthly price`);
    assert.equal(result.total, product.basePrice, `${product.id} total matches its displayed price`);
  }
});

test('a code scoped to specific products only discounts those products', () => {
  const result = calculateCart([membership, service], true, { type: 'multiplier', discountValue: 0.5, productIds: ['member'] }, now);
  assert.equal(result.items[0].displayPrice, 15);
  assert.equal(result.items[1].displayPrice, 85);
  const unscoped = calculateCart([membership, service], true, { type: 'credit', discountValue: 10, productIds: ['service'] }, now);
  assert.equal(unscoped.total, 105);
});

test('voucher credit applies to non-membership items, including vouchers, and is capped', () => {
  const voucher = { id: 'gift', category: 'VOUCHERS', type: 'voucher', basePrice: 60 };
  const result = calculateCart([membership, service, voucher], true, { type: 'credit', discountValue: 200 }, now);
  assert.equal(result.total, 30);
  assert.equal(result.items[0].displayPrice, 30);
  assert.equal(result.promoDiscountValue, 145);
});

test('percentage discount excludes membership but includes services', () => {
  const result = calculateCart([membership, service], true, { type: 'multiplier', discountValue: 0.2 }, now);
  assert.equal(result.total, 98);
  assert.equal(result.items[0].displayPrice, 30);
});

test('flat subscription savings are deducted once without annual stacking', () => {
  // 1 October is past 40% of the club year, so the first annual payment is 60% of a year.
  const result = calculateCart([subscription], true, { type: 'flat', discountValue: 5 }, now);
  assert.equal(result.total, 144);
  assert.equal(result.promoDiscountValue, 36);
  assert.equal(result.annualSaving, 0);
  assert.equal(result.recurringYearlyTotal, 240, 'then twelve discounted months a year, without the annual discount');
});

test('voucher credit does not reduce future monthly subscription payments', () => {
  const result = calculateCart([membership, subscription], false, { type: 'credit', discountValue: 60 }, now);
  assert.equal(result.total, 30);
  assert.equal(result.recurringMonthlyTotal, 25);
});

test('annual discounts still apply before voucher credit', () => {
  const result = calculateCart([subscription], true, { type: 'credit', discountValue: 60 }, now);
  assert.equal(result.subtotal, 144);
  assert.equal(result.total, 84);
  assert.equal(result.annualSaving, 36);
  assert.equal(result.recurringYearlyTotal, 240, 'credit never reduces the yearly payments');
});

test('credit skips memberships and is consumed in cart order across eligible items', () => {
  const voucher = { id: 'gift', category: 'VOUCHERS', type: 'voucher', basePrice: 60 };
  const result = calculateCart([membership, service, voucher], false, { type: 'credit', discountValue: 100 }, now);
  assert.deepEqual(result.items.map(({ displayPrice, promoSaving, promoEligible }) => ({ displayPrice, promoSaving, promoEligible })), [
    { displayPrice: 30, promoSaving: 0, promoEligible: false },
    { displayPrice: 0, promoSaving: 85, promoEligible: true },
    { displayPrice: 45, promoSaving: 15, promoEligible: true }
  ]);
  assert.equal(result.total, 75);
  assert.equal(result.promoDiscountValue, 100);
});

test('a non-empty product scope replaces default eligibility and can include memberships', () => {
  const result = calculateCart([membership, service], false, {
    type: 'credit', discountValue: 40, productIds: ['member']
  }, now);
  assert.deepEqual(result.items.map(({ displayPrice, promoEligible }) => ({ displayPrice, promoEligible })), [
    { displayPrice: 0, promoEligible: true },
    { displayPrice: 85, promoEligible: false }
  ]);
  assert.equal(result.promoDiscountValue, 30);
});

test('an empty product scope uses the default non-membership eligibility', () => {
  const result = calculateCart([membership, service], false, {
    type: 'credit', discountValue: 10, productIds: []
  }, now);
  assert.deepEqual(result.items.map(({ displayPrice, promoEligible }) => ({ displayPrice, promoEligible })), [
    { displayPrice: 30, promoEligible: false },
    { displayPrice: 75, promoEligible: true }
  ]);
});

test('credit is capped at eligible spend and unused credit is not included in the discount total', () => {
  const result = calculateCart([membership, service], false, {
    type: 'credit', discountValue: 500
  }, now);
  assert.equal(result.items[0].displayPrice, 30);
  assert.equal(result.items[1].displayPrice, 0);
  assert.equal(result.promoDiscountValue, 85);
  assert.equal(result.total, 30);
});

test('zero or negative credit does not increase prices or create savings', () => {
  for (const discountValue of [0, -10]) {
    const result = calculateCart([service], false, { type: 'credit', discountValue }, now);
    assert.equal(result.items[0].displayPrice, 85);
    assert.equal(result.promoDiscountValue, 0);
    assert.equal(result.total, 85);
  }
});

test('a full multiplier discount reduces eligible prices and monthly recurring cost to zero', () => {
  const result = calculateCart([subscription], false, {
    type: 'multiplier', discountValue: 1
  }, now);
  assert.equal(result.items[0].displayPrice, 0);
  assert.equal(result.items[0].recurringMonthlyCost, 0);
  assert.equal(result.promoDiscountValue, 25);
  assert.equal(result.recurringMonthlyTotal, 0);
});

test('flat discounts affect subscriptions only and cannot reduce them below zero', () => {
  const expensiveFlat = calculateCart([subscription], false, {
    type: 'flat', discountValue: 40
  }, now);
  assert.equal(expensiveFlat.items[0].displayPrice, 0);
  assert.equal(expensiveFlat.items[0].promoSaving, 25);
  assert.equal(expensiveFlat.items[0].recurringMonthlyCost, 0);

  const oneOff = calculateCart([service], false, { type: 'flat', discountValue: 40 }, now);
  assert.equal(oneOff.items[0].displayPrice, 85);
  assert.equal(oneOff.items[0].promoSaving, 0);
});

test('flat annual subscription discounts stack with annual savings only when explicitly allowed', () => {
  const promo = { type: 'flat', discountValue: 5 };
  const withoutStacking = calculateCart([subscription], true, promo, now);
  const withStacking = calculateCart([subscription], true, { ...promo, allowsAnnualStacking: true }, now);

  assert.deepEqual(
    [withoutStacking.subtotal, withoutStacking.total, withoutStacking.annualSaving, withoutStacking.promoDiscountValue],
    [180, 144, 0, 36]
  );
  assert.deepEqual(
    [withStacking.subtotal, withStacking.total, withStacking.annualSaving, withStacking.promoDiscountValue],
    [144, 115.2, 36, 28.8]
  );
  assert.deepEqual([withoutStacking.recurringYearlyTotal, withStacking.recurringYearlyTotal], [240, 192]);
});

test('monthly subscription pricing has no annual saving and reports its discounted recurring amount', () => {
  const result = calculateCart([subscription], false, {
    type: 'multiplier', discountValue: 0.2
  }, now);
  assert.equal(result.subtotal, 25);
  assert.equal(result.items[0].displayPrice, 20);
  assert.equal(result.items[0].annualSaving, 0);
  assert.equal(result.items[0].recurringMonthlyCost, 20);
  assert.equal(result.recurringMonthlyTotal, 20);
});

test('annual subscriptions charge the rest of the club year in 20% steps, then the full year every 1 March', () => {
  const at = (date, product = subscription) => calculateCart([product], true, null, date);
  // A fifth of the 2026/27 club year has gone on 13 May, two fifths on 25 July, three on 6 October, four on 18 December.
  assert.deepEqual([[2026, 2, 1], [2026, 4, 12], [2026, 4, 13], [2026, 6, 25], [2026, 9, 6], [2026, 11, 17], [2026, 11, 18], [2027, 1, 28]]
    .map(([year, month, day]) => at(new Date(year, month, day, 12)).total), [240, 240, 192, 144, 96, 96, 48, 48]);
  const february = at(new Date(2027, 1, 28));
  assert.deepEqual([february.subtotal, february.annualSaving, february.recurringYearlyTotal, february.recurringMonthlyTotal], [48, 12, 240, 0]);
  assert.equal(february.items[0].firstDebit.toISOString(), '2027-03-01T00:00:00.000Z');
  assert.deepEqual(february.recurringSchedule.map(({ interval, amount, firstCharge }) => [interval, amount, firstCharge.toISOString()]),
    [['year', 240, '2027-03-01T00:00:00.000Z']]);
  const unprorated = at(new Date(2027, 1, 28), { ...subscription, thresholdProration: false });
  assert.deepEqual([unprorated.total, unprorated.recurringYearlyTotal], [240, 240], 'a product can opt out and charge the full year');
  const annualOnly = { ...subscription, allowMonthly: false };
  assert.equal(calculateCart([annualOnly], false, null, new Date(2027, 1, 28)).recurringYearlyTotal, 240, 'annual-only subscriptions are yearly in a monthly basket');
});

test('prorated service pricing drops to 60% on 1 October', () => {
  const yearlyService = { id: 'annual-service', category: 'SERVICES', type: 'yearly-service', pricingMode: 'prorated', basePrice: 85 };
  const september = calculateCart([yearlyService], false, null, new Date(2026, 8, 30));
  const october = calculateCart([yearlyService], false, null, new Date(2026, 9, 1));
  const february = calculateCart([yearlyService], false, null, new Date(2027, 1, 28));
  const march = calculateCart([yearlyService], false, null, new Date(2027, 2, 1));
  assert.deepEqual([september.items[0].clubYearInfo.monthsRemaining, september.subtotal, september.annualSaving], [6, 85, 0]);
  assert.deepEqual([october.items[0].clubYearInfo.monthsRemaining, october.subtotal, october.annualSaving], [5, 51, 34]);
  assert.equal(february.subtotal, 51);
  assert.equal(march.subtotal, 85);
});

test('percentage savings round to pennies before subtracting from the line price', () => {
  const item = { id: 'pennies', category: 'SERVICES', type: 'annual-oneoff', basePrice: 19.99 };
  const result = calculateCart([item], false, { type: 'multiplier', discountValue: 0.333 }, now);
  assert.equal(result.items[0].promoSaving, 6.66);
  assert.equal(result.items[0].displayPrice, 13.33);
  assert.equal(result.total, 13.33);
});

test('duplicate cart lines are priced independently and consume credit in line order', () => {
  const duplicate = { id: 'same-service', category: 'SERVICES', type: 'annual-oneoff', basePrice: 85 };
  const result = calculateCart([duplicate, duplicate], false, { type: 'credit', discountValue: 100 }, now);
  assert.deepEqual(result.items.map(({ displayPrice, promoSaving }) => ({ displayPrice, promoSaving })), [
    { displayPrice: 0, promoSaving: 85 },
    { displayPrice: 70, promoSaving: 15 }
  ]);
  assert.equal(result.subtotal, 170);
  assert.equal(result.total, 70);
});

test('a scoped multiplier discounts every duplicate line with a matching product id', () => {
  const duplicate = { id: 'same-service', category: 'SERVICES', type: 'annual-oneoff', basePrice: 85 };
  const result = calculateCart([duplicate, duplicate], false, {
    type: 'multiplier', discountValue: 0.1, productIds: ['same-service', 'same-service']
  }, now);
  assert.deepEqual(result.items.map(({ displayPrice, promoSaving }) => ({ displayPrice, promoSaving })), [
    { displayPrice: 76.5, promoSaving: 8.5 },
    { displayPrice: 76.5, promoSaving: 8.5 }
  ]);
  assert.equal(result.total, 153);
});

test('seasonal prorated service savings are calculated before voucher credit is applied', () => {
  const yearlyService = { id: 'annual-service', category: 'SERVICES', type: 'yearly-service', pricingMode: 'prorated', basePrice: 85 };
  const result = calculateCart([yearlyService], false, { type: 'credit', discountValue: 20 }, new Date(2026, 10, 1));
  assert.equal(result.subtotal, 51);
  assert.equal(result.items[0].displayPrice, 31);
  assert.equal(result.items[0].annualSaving, 34);
  assert.equal(result.promoDiscountValue, 20);
});
test('credit limited to categories or products only covers those items', () => {
  const event = { id: 'trip', category: 'EVENTS', type: 'event-ticket', basePrice: 30 };
  const hire = { id: 'boat-hire', category: 'SERVICES', type: 'yearly-service', pricingMode: 'fixed', basePrice: 85 };
  const credit = (scope) => calculateCart([membership, hire, event], true, { type: 'credit', discountValue: 200, ...scope }, now);
  assert.equal(credit({ categories: ['EVENTS'] }).total, 115);
  assert.equal(credit({ productIds: ['boat-hire'] }).total, 60);
  assert.equal(credit({ categories: ['EVENTS'], productIds: ['boat-hire'] }).total, 30);
  assert.equal(credit({}).total, 30);
  assert.equal(credit({ categories: ['MERCHANDISE'] }).promoDiscountValue, 0);
});

test('monthly items charge the joining-month share now and are debited from the next 1st', () => {
  const october = calculateCart([subscription], false, null, new Date(2026, 9, 9));
  // 23 of October's 31 days are left, which rounds up to 80%.
  assert.deepEqual([october.total, october.items[0].monthlyAmount, october.items[0].interval], [20, 25, 'month']);
  assert.equal(october.items[0].firstDebit.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.deepEqual(october.recurringSchedule.map(({ interval, amount, clubYear }) => [interval, amount, clubYear]), [['month', 25, 2026]]);
  const upFront = calculateCart([subscription], true, null, new Date(2026, 9, 9));
  // Three fifths of the club year have gone, so 40% of the year price, which already has 20% off for paying up front.
  assert.equal(upFront.total, 96);
});

test('monthly items bought in February carry on from 1 March', () => {
  const february = calculateCart([subscription], false, null, new Date(2027, 1, 10));
  assert.deepEqual([february.total, february.recurringMonthlyTotal], [20, 25]);
  assert.equal(february.items[0].firstDebit.toISOString(), '2027-03-01T00:00:00.000Z');
  assert.equal(february.items[0].label, 'Rest of February now (20% off), then £25.00 a month from 1 Mar 2027 until you cancel');
});

test('subscription labels state the first payment and what follows until cancelled', () => {
  const label = (date, part = 'this', annual = false, product = subscription) =>
    calculateCart([{ ...product, clubYearPart: part }], annual, null, date).items[0].label;
  assert.equal(label(new Date('2026-10-28T12:00:00Z')), 'Rest of October now (80% off), then £25.00 a month from 1 Nov 2026 until you cancel');
  assert.equal(label(new Date('2027-01-15T12:00:00Z')), 'Rest of January now (40% off), then £25.00 a month from 1 Feb 2027 until you cancel');
  assert.equal(label(new Date('2027-01-15T12:00:00Z'), 'next'), '£25.00 a month from 1 Mar 2027 until you cancel');
  assert.equal(label(new Date('2027-01-15T12:00:00Z'), 'this', true), 'Rest of the club year now (80% off), then £240.00 a year from 1 Mar 2027 until you cancel');
  assert.equal(label(new Date('2027-01-15T12:00:00Z'), 'next', true), '£240.00 a year from 1 Mar 2027 until you cancel');
  assert.equal(label(new Date('2027-01-15T12:00:00Z'), 'this', true, { ...subscription, thresholdProration: false }),
    'This club year now, then £240.00 a year from 1 Mar 2027 until you cancel');
});

test('next year: membership and up-front items are charged now; subscriptions start on 1 March', () => {
  const january = new Date(2027, 0, 20);
  const boatHire = { id: 'boat', category: 'SERVICES', type: 'yearly-service', pricingMode: 'prorated', basePrice: 85 };
  const lines = expandClubYearLines([
    { ...membership, lineId: 'm', clubYearChoice: 'next' },
    { ...subscription, lineId: 's', clubYearChoice: 'next' },
    { ...boatHire, lineId: 'b', clubYearChoice: 'both' }
  ]);
  assert.deepEqual(lines.map((line) => [line.lineId, line.clubYearPart || 'this', line.sourceLineId]),
    [['m', 'next', 'm'], ['s', 'next', 's'], ['b', 'this', 'b'], ['b~next', 'next', 'b']]);
  const result = calculateCart(lines, false, null, january);
  assert.deepEqual(result.items.map((item) => [item.lineId, item.clubYear, item.displayPrice]),
    [['m', 2027, 30], ['s', 2027, 0], ['b', 2026, 51], ['b~next', 2027, 85]]);
  assert.deepEqual(result.recurringSchedule.map(({ interval, firstCharge, amount }) => [interval, firstCharge.toISOString(), amount]),
    [['month', '2027-03-01T00:00:00.000Z', 25]]);
  const annualNextYear = calculateCart([{ ...subscription, clubYearPart: 'next' }], true, null, january);
  assert.deepEqual([annualNextYear.total, annualNextYear.recurringYearlyTotal], [0, 240], 'the card is saved now and the year is charged on 1 March');
  assert.deepEqual(expandPeopleLines([{ id: 'p', lineIds: ['m', 's', 'b'] }], [{ lineId: 'b', clubYearChoice: 'both' }])[0].lineIds, ['m', 's', 'b', 'b~next']);
});
