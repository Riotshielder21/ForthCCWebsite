import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCart } from './pricing.js';
import { PRODUCTS } from '../constants/products.js';

const now = new Date(2026, 9, 9);
const membership = { id: 'member', category: 'MEMBERSHIP', type: 'annual-oneoff', basePrice: 30 };
const service = { id: 'service', category: 'SERVICES', type: 'annual-oneoff', basePrice: 85 };
const subscription = { id: 'sub', category: 'SUBSCRIPTIONS', type: 'subscription', basePrice: 25, hasAnnualDiscount: true };

test('each purchasable starter product can be priced as a one-item cart', () => {
  const now = new Date(2026, 9, 9);
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
  const result = calculateCart([membership, service], true, { discountType: 'multiplier', discountValue: 0.5, productIds: ['member'] }, now);
  assert.equal(result.items[0].displayPrice, 15);
  assert.equal(result.items[1].displayPrice, 85);
  const unscoped = calculateCart([membership, service], true, { discountType: 'credit', discountValue: 10, productIds: ['service'] }, now);
  assert.equal(unscoped.total, 105);
});

test('voucher credit applies to non-membership items, including vouchers, and is capped', () => {
  const voucher = { id: 'gift', category: 'VOUCHERS', type: 'voucher', basePrice: 60 };
  const result = calculateCart([membership, service, voucher], true, { discountType: 'credit', discountValue: 200 }, now);
  assert.equal(result.total, 30);
  assert.equal(result.items[0].displayPrice, 30);
  assert.equal(result.promoDiscountValue, 145);
});

test('percentage discount excludes membership but includes services', () => {
  const result = calculateCart([membership, service], true, { discountType: 'multiplier', discountValue: 0.2 }, now);
  assert.equal(result.total, 98);
  assert.equal(result.items[0].displayPrice, 30);
});

test('flat subscription savings are deducted once without annual stacking', () => {
  const result = calculateCart([subscription], true, { discountType: 'flat', discountValue: 5 }, now);
  assert.equal(result.total, 100);
  assert.equal(result.promoDiscountValue, 25);
  assert.equal(result.annualSaving, 0);
});

test('voucher credit does not reduce future monthly subscription payments', () => {
  const result = calculateCart([membership, subscription], false, { discountType: 'credit', discountValue: 60 }, now);
  assert.equal(result.total, 30);
  assert.equal(result.recurringMonthlyTotal, 25);
});

test('annual discounts still apply before voucher credit', () => {
  const result = calculateCart([subscription], true, { discountType: 'credit', discountValue: 60 }, now);
  assert.equal(result.subtotal, 100);
  assert.equal(result.total, 40);
  assert.equal(result.annualSaving, 25);
});

test('credit skips memberships and is consumed in cart order across eligible items', () => {
  const voucher = { id: 'gift', category: 'VOUCHERS', type: 'voucher', basePrice: 60 };
  const result = calculateCart([membership, service, voucher], false, { discountType: 'credit', discountValue: 100 }, now);
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
    discountType: 'credit', discountValue: 40, productIds: ['member']
  }, now);
  assert.deepEqual(result.items.map(({ displayPrice, promoEligible }) => ({ displayPrice, promoEligible })), [
    { displayPrice: 0, promoEligible: true },
    { displayPrice: 85, promoEligible: false }
  ]);
  assert.equal(result.promoDiscountValue, 30);
});

test('an empty product scope uses the default non-membership eligibility', () => {
  const result = calculateCart([membership, service], false, {
    discountType: 'credit', discountValue: 10, productIds: []
  }, now);
  assert.deepEqual(result.items.map(({ displayPrice, promoEligible }) => ({ displayPrice, promoEligible })), [
    { displayPrice: 30, promoEligible: false },
    { displayPrice: 75, promoEligible: true }
  ]);
});

test('credit is capped at eligible spend and unused credit is not included in the discount total', () => {
  const result = calculateCart([membership, service], false, {
    discountType: 'credit', discountValue: 500
  }, now);
  assert.equal(result.items[0].displayPrice, 30);
  assert.equal(result.items[1].displayPrice, 0);
  assert.equal(result.promoDiscountValue, 85);
  assert.equal(result.total, 30);
});

test('zero or negative credit does not increase prices or create savings', () => {
  for (const discountValue of [0, -10]) {
    const result = calculateCart([service], false, { discountType: 'credit', discountValue }, now);
    assert.equal(result.items[0].displayPrice, 85);
    assert.equal(result.promoDiscountValue, 0);
    assert.equal(result.total, 85);
  }
});

test('a full multiplier discount reduces eligible prices and monthly recurring cost to zero', () => {
  const result = calculateCart([subscription], false, {
    discountType: 'multiplier', discountValue: 1
  }, now);
  assert.equal(result.items[0].displayPrice, 0);
  assert.equal(result.items[0].recurringMonthlyCost, 0);
  assert.equal(result.promoDiscountValue, 25);
  assert.equal(result.recurringMonthlyTotal, 0);
});

test('flat discounts affect subscriptions only and cannot reduce them below zero', () => {
  const expensiveFlat = calculateCart([subscription], false, {
    discountType: 'flat', discountValue: 40
  }, now);
  assert.equal(expensiveFlat.items[0].displayPrice, 0);
  assert.equal(expensiveFlat.items[0].promoSaving, 25);
  assert.equal(expensiveFlat.items[0].recurringMonthlyCost, 0);

  const oneOff = calculateCart([service], false, { discountType: 'flat', discountValue: 40 }, now);
  assert.equal(oneOff.items[0].displayPrice, 85);
  assert.equal(oneOff.items[0].promoSaving, 0);
});

test('flat annual subscription discounts stack with annual savings only when explicitly allowed', () => {
  const promo = { discountType: 'flat', discountValue: 5 };
  const withoutStacking = calculateCart([subscription], true, promo, now);
  const withStacking = calculateCart([subscription], true, { ...promo, allowsAnnualStacking: true }, now);

  assert.deepEqual(
    [withoutStacking.subtotal, withoutStacking.total, withoutStacking.annualSaving, withoutStacking.promoDiscountValue],
    [125, 100, 0, 25]
  );
  assert.deepEqual(
    [withStacking.subtotal, withStacking.total, withStacking.annualSaving, withStacking.promoDiscountValue],
    [100, 80, 25, 20]
  );
});

test('monthly subscription pricing has no annual saving and reports its discounted recurring amount', () => {
  const result = calculateCart([subscription], false, {
    discountType: 'multiplier', discountValue: 0.2
  }, now);
  assert.equal(result.subtotal, 25);
  assert.equal(result.items[0].displayPrice, 20);
  assert.equal(result.items[0].annualSaving, 0);
  assert.equal(result.items[0].recurringMonthlyCost, 20);
  assert.equal(result.recurringMonthlyTotal, 20);
});

test('annual subscription totals and savings use the remaining club-year months', () => {
  const february = calculateCart([subscription], true, null, new Date(2027, 1, 28));
  const march = calculateCart([subscription], true, null, new Date(2027, 2, 1));
  assert.deepEqual([february.items[0].clubYear.monthsRemaining, february.subtotal, february.annualSaving], [1, 20, 5]);
  assert.deepEqual([march.items[0].clubYear.monthsRemaining, march.subtotal, march.annualSaving], [12, 240, 60]);
  assert.equal(february.recurringMonthlyTotal, 0);
  assert.equal(march.recurringMonthlyTotal, 0);
});

test('prorated service pricing changes at the four-month club-year boundary', () => {
  const yearlyService = { id: 'annual-service', category: 'SERVICES', type: 'yearly-service', pricingMode: 'prorated', basePrice: 85 };
  const october = calculateCart([yearlyService], false, null, new Date(2026, 9, 31));
  const november = calculateCart([yearlyService], false, null, new Date(2026, 10, 1));
  assert.deepEqual([october.items[0].clubYear.monthsRemaining, october.subtotal, october.annualSaving], [5, 85, 0]);
  assert.deepEqual([november.items[0].clubYear.monthsRemaining, november.subtotal, november.annualSaving], [4, 51, 34]);
});

test('percentage savings round to pennies before subtracting from the line price', () => {
  const item = { id: 'pennies', category: 'SERVICES', type: 'annual-oneoff', basePrice: 19.99 };
  const result = calculateCart([item], false, { discountType: 'multiplier', discountValue: 0.333 }, now);
  assert.equal(result.items[0].promoSaving, 6.66);
  assert.equal(result.items[0].displayPrice, 13.33);
  assert.equal(result.total, 13.33);
});

test('duplicate cart lines are priced independently and consume credit in line order', () => {
  const duplicate = { id: 'same-service', category: 'SERVICES', type: 'annual-oneoff', basePrice: 85 };
  const result = calculateCart([duplicate, duplicate], false, { discountType: 'credit', discountValue: 100 }, now);
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
    discountType: 'multiplier', discountValue: 0.1, productIds: ['same-service', 'same-service']
  }, now);
  assert.deepEqual(result.items.map(({ displayPrice, promoSaving }) => ({ displayPrice, promoSaving })), [
    { displayPrice: 76.5, promoSaving: 8.5 },
    { displayPrice: 76.5, promoSaving: 8.5 }
  ]);
  assert.equal(result.total, 153);
});

test('seasonal prorated service savings are calculated before voucher credit is applied', () => {
  const yearlyService = { id: 'annual-service', category: 'SERVICES', type: 'yearly-service', pricingMode: 'prorated', basePrice: 85 };
  const result = calculateCart([yearlyService], false, { discountType: 'credit', discountValue: 20 }, new Date(2026, 10, 1));
  assert.equal(result.subtotal, 51);
  assert.equal(result.items[0].displayPrice, 31);
  assert.equal(result.items[0].annualSaving, 34);
  assert.equal(result.promoDiscountValue, 20);
});
test('credit limited to categories or products only covers those items', () => {
  const event = { id: 'trip', category: 'EVENTS', type: 'event-ticket', basePrice: 30 };
  const hire = { id: 'boat-hire', category: 'SERVICES', type: 'yearly-service', pricingMode: 'fixed', basePrice: 85 };
  const credit = (scope) => calculateCart([membership, hire, event], true, { discountType: 'credit', discountValue: 200, ...scope }, now);
  assert.equal(credit({ categories: ['EVENTS'] }).total, 115);
  assert.equal(credit({ productIds: ['boat-hire'] }).total, 60);
  assert.equal(credit({ categories: ['EVENTS'], productIds: ['boat-hire'] }).total, 30);
  assert.equal(credit({}).total, 30);
  assert.equal(credit({ categories: ['MERCHANDISE'] }).promoDiscountValue, 0);
});
