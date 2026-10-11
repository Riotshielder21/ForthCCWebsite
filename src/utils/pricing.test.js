import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCart } from './pricing.js';

const now = new Date(2026, 9, 9);
const membership = { id: 'member', category: 'MEMBERSHIP', type: 'annual-oneoff', basePrice: 30 };
const service = { id: 'service', category: 'SERVICES', type: 'annual-oneoff', basePrice: 85 };
const subscription = { id: 'sub', category: 'SUBSCRIPTIONS', type: 'subscription', basePrice: 25, hasAnnualDiscount: true };

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