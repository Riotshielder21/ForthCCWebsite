import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTripDiscounts, currentPrivilegeIds, tripDiscountFor, isTripEvent, isLockedProduct } from './tripDiscount.js';
import { calculateCart } from './pricing.js';
import { normaliseProduct, resolveCatalogue } from './catalogue.js';

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
  const promo = calculateCart([{ ...trip, tripDiscount: 10 }], true, { discountType: 'multiplier', discountValue: 0.5, productIds: [] }, now);
  assert.equal(promo.items[0].displayPrice, 15);
  assert.equal(calculateCart([trip], true, null, now).tripDiscountValue, 0);
});

test('the trip discount products cannot be deleted from the shop', () => {
  assert.equal(isLockedProduct('boat-hire'), true);
  assert.equal(isLockedProduct('keyhire'), false);
  const defaults = [{ id: 'boat-hire', name: 'Hire', basePrice: 85 }, { id: 'keyhire', name: 'Key', basePrice: 50 }];
  const catalogue = resolveCatalogue(defaults, [{ id: 'boat-hire', deleted: true, basePrice: 90 }, { id: 'keyhire', deleted: true }]);
  assert.deepEqual(catalogue, [normaliseProduct({ id: 'boat-hire', name: 'Hire', basePrice: 90 })]);
});
