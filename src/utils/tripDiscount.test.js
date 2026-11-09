import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTripDiscounts, currentPrivilegeIds, tripDiscountFor, tripDiscountText, tripDiscountSummary, tripDiscountRules, validateTripDiscounts, isTripEvent, isLockedProduct,
  lockedProductIds, DEFAULT_TRIP_DISCOUNTS, TRIP_DISCOUNT_LIMITS } from './tripDiscount.js';
import { calculateCart } from './pricing.js';
import { PRODUCTS } from '../constants/products.js';

const now = new Date('2026-10-10T12:00:00Z');
const schedule = (mode) => ({ mode, startDate: '2026-11-01', startTime: '09:00', endTime: '16:00', ...(mode === 'single' ? { days: 1 } : { days: 3 }), timeZone: 'Europe/London' });
const trip = { id: 'loch-trip', lineId: 'trip-1', category: 'EVENTS', type: 'event-ticket', basePrice: 40, eventSchedule: schedule('single') };

test('only single-day events are trips', () => {
  assert.equal(isTripEvent(trip), true);
  assert.equal(isTripEvent({ ...trip, eventSchedule: schedule('consecutive') }), false);
  assert.equal(isTripEvent({ id: 'boat-hire', category: 'SERVICES' }), false);
});

test('boat hire and a subscription each give £10 off and stack; key hire gives nothing', () => {
  assert.deepEqual(tripDiscountFor(['boat-hire']), { amount: 10, reasons: ['annual boat hire'] });
  assert.deepEqual(tripDiscountFor(['gold-sub']), { amount: 10, reasons: ['a coaching subscription'] });
  assert.equal(tripDiscountFor(['boat-hire', 'blue-sub', 'gold-sub']).amount, 20, 'two subscriptions still count once');
  assert.equal(tripDiscountFor(['keyhire', 'vouchers']).amount, 0);
});

test('privileges count only from the current club year, which starts on 1 March', () => {
  const privileges = [
    { productId: 'boat-hire', grantedAt: new Date('2026-03-01T00:00:00') },
    { productId: 'blue-sub', grantedAt: new Date('2026-02-27T00:00:00') },
    { productId: 'keyhire', grantedAt: { toDate: () => new Date('2026-06-01') } }
  ];
  assert.deepEqual(currentPrivilegeIds(privileges, now), ['boat-hire', 'keyhire']);
  assert.deepEqual(currentPrivilegeIds(undefined, now), []);
  assert.ok(currentPrivilegeIds(privileges, new Date('2026-02-28T12:00:00')).includes('blue-sub'), 'in February the club year began last March');
});

test('each attendee gets the discount from their own holdings or the same basket', () => {
  const lines = [trip, { ...trip, lineId: 'trip-2' }, { ...trip, lineId: 'course', eventSchedule: schedule('consecutive') },
    { id: 'boat-hire', lineId: 'hire-2', category: 'SERVICES', type: 'yearly-service', basePrice: 85 }];
  const people = [
    { id: 'p1', lineIds: ['trip-1', 'course'] },
    { id: 'p2', lineIds: ['trip-2', 'hire-2'] }
  ];
  const discounted = applyTripDiscounts(lines, people, new Map([['p1', [{ productId: 'gold-sub', grantedAt: now }, { productId: 'boat-hire', grantedAt: now }]]]), now);
  assert.equal(discounted[0].tripDiscount, 20);
  assert.deepEqual(discounted[0].tripDiscountReasons, ['annual boat hire', 'a coaching subscription']);
  assert.equal(discounted[1].tripDiscount, 10, 'boat hire bought in the same basket counts');
  assert.equal(discounted[2].tripDiscount, undefined, 'multi-day courses are not trips');
  assert.equal(discounted[3].tripDiscount, undefined);
  assert.equal(applyTripDiscounts([{ ...trip, tripDiscount: 99 }], [{ id: 'p3', lineIds: ['trip-1'] }])[0].tripDiscount, undefined, 'a discount sent by the browser is dropped');
});

test('the trip discount comes off the ticket price before promo codes and never below zero', () => {
  const priced = calculateCart([{ ...trip, tripDiscount: 20 }, { ...trip, lineId: 'cheap', basePrice: 15, tripDiscount: 20 }], true, null, now);
  assert.equal(priced.items[0].displayPrice, 20);
  assert.equal(priced.items[1].displayPrice, 0);
  assert.equal(priced.tripDiscountValue, 35);
  assert.equal(priced.total, 20);
  const promo = calculateCart([{ ...trip, tripDiscount: 10 }], true, { type: 'multiplier', discountValue: 0.5, productIds: [] }, now);
  assert.equal(promo.items[0].displayPrice, 15);
  assert.equal(calculateCart([trip], true, null, now).tripDiscountValue, 0);
});

test('the products in the current rules are locked', () => {
  assert.equal(isLockedProduct('boat-hire'), true);
  assert.equal(isLockedProduct('keyhire'), false);
  assert.deepEqual(lockedProductIds(), ['boat-hire', 'blue-sub', 'gold-sub']);
  const keyRule = [{ id: 'key', productIds: ['keyhire'], amount: 5, label: 'key hire', short: 'Key hire' }];
  assert.equal(isLockedProduct('keyhire', keyRule), true);
  assert.equal(isLockedProduct('boat-hire', keyRule), false, 'a product taken out of the rules can be removed');
  assert.equal(isLockedProduct('boat-hire', []), false);
});

test('the own-kit tick neither gives nor takes away the discount', () => {
  const hire = { id: 'boat-hire', lineId: 'hire', category: 'SERVICES', type: 'yearly-service', basePrice: 85 };
  const holder = new Map([['p1', [{ productId: 'boat-hire', grantedAt: now }]]]);
  for (const ownKitLineIds of [[], ['trip-1']]) {
    assert.equal(applyTripDiscounts([trip], [{ id: 'p1', lineIds: ['trip-1'], ownKitLineIds }], holder, now)[0].tripDiscount, 10, 'held boat hire');
    assert.equal(applyTripDiscounts([trip, hire], [{ id: 'p1', lineIds: ['trip-1', 'hire'], ownKitLineIds }], new Map(), now)[0].tripDiscount, 10, 'boat hire in the basket');
    assert.equal(applyTripDiscounts([trip], [{ id: 'p2', lineIds: ['trip-1'], ownKitLineIds }], new Map(), now)[0].tripDiscount, undefined, 'no boat hire');
  }
});

test('saved rules replace the defaults and change the discount', () => {
  assert.equal(tripDiscountRules(undefined), DEFAULT_TRIP_DISCOUNTS);
  assert.equal(tripDiscountRules({}), DEFAULT_TRIP_DISCOUNTS);
  assert.deepEqual(tripDiscountRules({ rules: [] }), [], 'an empty list switches trip discounts off');
  const rules = [{ id: 'boat-hire', productIds: ['boat-hire'], amount: 7.5, label: 'annual boat hire', short: 'Kit hire' },
    { id: 'key', productIds: ['keyhire'], amount: 5, label: 'key hire', short: 'Key hire' }];
  const people = [{ id: 'p1', lineIds: ['trip-1'] }];
  const held = new Map([['p1', [{ productId: 'boat-hire', grantedAt: now }, { productId: 'keyhire', grantedAt: now }, { productId: 'gold-sub', grantedAt: now }]]]);
  const discounted = applyTripDiscounts([trip], people, held, now, rules);
  assert.equal(discounted[0].tripDiscount, 12.5);
  assert.deepEqual(discounted[0].tripDiscountReasons, ['annual boat hire', 'key hire'], 'a subscription no longer counts');
  assert.equal(applyTripDiscounts([trip], people, held, now, [])[0].tripDiscount, undefined);
});

test('admin rules are checked before they are saved', () => {
  const rule = { id: 'boat-hire', productIds: ['boat-hire'], amount: 10, label: 'annual boat hire', short: 'Kit hire' };
  assert.deepEqual(validateTripDiscounts(DEFAULT_TRIP_DISCOUNTS, PRODUCTS), { value: DEFAULT_TRIP_DISCOUNTS }, 'the defaults are valid');
  assert.deepEqual(validateTripDiscounts([], PRODUCTS), { value: [] });
  assert.deepEqual(validateTripDiscounts([{ ...rule, short: '  Kit   hire ', label: ' annual boat hire ', productIds: ['boat-hire', 'boat-hire'], amount: 0.29 }], PRODUCTS).value,
    [{ ...rule, amount: 0.29 }], 'text is tidied and products listed once');
  const invalid = (rules) => validateTripDiscounts(rules, PRODUCTS).error;
  assert.match(invalid(undefined), /Keep up to/);
  assert.match(invalid(Array.from({ length: TRIP_DISCOUNT_LIMITS.rules + 1 }, (_, index) => ({ ...rule, id: `r${index}` }))), /Keep up to 10/);
  assert.match(invalid([{ ...rule, id: 'Bad id!' }]), /identity/);
  assert.match(invalid([rule, { ...rule, short: 'Other', label: 'other' }]), /identity/);
  for (const amount of [0, -5, 101, 10.005, '10', NaN, Infinity]) assert.match(invalid([{ ...rule, amount }]), /between £0.01 and £100/, String(amount));
  assert.match(invalid([{ ...rule, short: '' }]), /short name/);
  assert.match(invalid([{ ...rule, short: 'x'.repeat(31) }]), /short name/);
  assert.match(invalid([{ ...rule, label: '  ' }]), /Describe/);
  assert.match(invalid([{ ...rule, label: 'x'.repeat(61) }]), /Describe/);
  assert.match(invalid([rule, { ...rule, id: 'two', short: 'kit HIRE', productIds: ['keyhire'] }]), /different name/);
  assert.match(invalid([{ ...rule, productIds: [] }]), /Choose between 1 and 10/);
  assert.match(invalid([{ ...rule, productIds: ['no-such-product'] }]), /services or subscriptions in the shop/);
  assert.match(invalid([{ ...rule, productIds: ['membership-adult'] }]), /services or subscriptions/, 'memberships are not entitlements');
  assert.match(invalid([rule, { ...rule, id: 'two', short: 'Other', label: 'other', productIds: ['boat-hire'] }]), /one trip discount only/);
  assert.match(validateTripDiscounts([rule], []).error, /in the shop/, 'products must be in the live catalogue');
});

test('trip cards describe the current rules', () => {
  assert.equal(tripDiscountSummary(), '£10 off with annual boat hire, and £10 off with a coaching subscription.');
  assert.equal(tripDiscountSummary([{ ...DEFAULT_TRIP_DISCOUNTS[0], amount: 7.5 }]), '£7.50 off with annual boat hire.');
  assert.equal(tripDiscountSummary([]), '');
});

test('trip discounts are named briefly at checkout', () => {
  assert.equal(tripDiscountText(['annual boat hire']), 'Kit hire discount applied');
  assert.equal(tripDiscountText(['a coaching subscription']), 'Subscription discount applied');
  assert.equal(tripDiscountText(['annual boat hire', 'a coaching subscription']), 'Kit hire and subscription discounts applied');
  assert.equal(tripDiscountText([]), '');
  const rules = [{ label: 'annual boat hire', short: 'Kit hire' }, { label: 'key hire', short: 'Key hire' }, { label: 'BCU coaching', short: 'BCU coaching' }];
  assert.equal(tripDiscountText(['key hire'], rules), 'Key hire discount applied', 'any configured short name works');
  assert.equal(tripDiscountText(['annual boat hire', 'key hire', 'BCU coaching'], rules), 'Kit hire, key hire and BCU coaching discounts applied');
  assert.equal(tripDiscountText(['a coaching subscription'], rules), '', 'reasons from rules no longer in use are not named');
});
