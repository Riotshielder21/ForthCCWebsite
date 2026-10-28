import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseProduct, productTerms, productMembershipRule, resolveCatalogue, validateEventSchedule, eventSessions, eventScheduleLabel } from './catalogue.js';
import { calculateCart } from './pricing.js';
import { PRODUCTS } from '../constants/products.js';

test('first saved product preserves starter catalogue; overrides and deletions stay explicit', () => {
  const defaults = [{ id: 'starter', name: 'Starter' }, { id: 'other' }];
  assert.equal(resolveCatalogue(defaults, [{ id: 'new' }]).length, 3);
  assert.deepEqual(resolveCatalogue(defaults, [{ id: 'starter', name: 'Edited' }])[0], normaliseProduct({ id: 'starter', name: 'Edited' }));
  assert.deepEqual(resolveCatalogue(defaults, [{ id: 'starter', deleted: true }]), [normaliseProduct({ id: 'other' })]);
  assert.deepEqual(resolveCatalogue(defaults, [{ id: 'starter', deleted: true }, { id: 'other', deleted: true }]), []);
});

test('only event products retain event schedule metadata', () => {
  const straySchedule = { mode: 'invalid' };
  assert.equal(Object.hasOwn(normaliseProduct({ category: 'MEMBERSHIP', eventSchedule: straySchedule }), 'eventSchedule'), false);
  assert.equal(Object.hasOwn(normaliseProduct({ category: 'SERVICES', eventSchedule: straySchedule }), 'eventSchedule'), false);
  assert.deepEqual(normaliseProduct({ category: 'EVENTS', eventSchedule: straySchedule }).eventSchedule, straySchedule);
});

test('event tickets support a single session or consecutive course days across months', () => {
  const schedule = { mode: 'consecutive', startDate: '2027-02-27', startTime: '15:00', endTime: '17:00', days: 5, timeZone: 'Europe/London' };
  assert.deepEqual(eventSessions(schedule).map((session) => session.date), ['2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02', '2027-03-03']);
  assert.equal(eventSessions({ ...schedule, mode: 'single' }).length, 1);
  assert.ok(eventScheduleLabel(schedule).includes('5 days'));
  assert.ok(eventScheduleLabel(schedule).includes('120 minutes per session'));
  for (const change of [{ startDate: '2027-02-30' }, { endTime: '14:00' }, { days: 0 }, { days: 2.5 }, { timeZone: 'UTC' }]) {
    assert.throws(() => validateEventSchedule({ ...schedule, ...change }));
  }
});

test('event ticket prices are one-off and unaffected by annual or monthly subscription billing', () => {
  const event = { id: 'event', name: 'Course ticket', category: 'EVENTS', type: 'event-ticket', basePrice: 50, hasAnnualDiscount: false };
  const now = new Date('2026-10-11');
  assert.equal(calculateCart([event], true, null, now).total, 50);
  assert.equal(calculateCart([event], false, null, now).total, 50);
});

test('weekly courses keep the same weekday and local times across month and daylight-saving boundaries', () => {
  const schedule = { mode: 'weekly', startDate: '2027-03-21', startTime: '15:00', endTime: '17:00', weeks: 5, timeZone: 'Europe/London' };
  const sessions = eventSessions(schedule);
  assert.deepEqual(sessions.map((session) => session.date), ['2027-03-21', '2027-03-28', '2027-04-04', '2027-04-11', '2027-04-18']);
  assert.ok(sessions.every((session) => session.startTime === '15:00' && session.endTime === '17:00'));
  assert.equal(validateEventSchedule(schedule).weeks, 5);
  assert.ok(eventScheduleLabel(schedule).includes('5 weeks'));
  assert.ok(eventScheduleLabel(schedule).includes('15:00–17:00 weekly'));
  for (const weeks of [0, 61, 1.5, undefined]) assert.throws(() => validateEventSchedule({ ...schedule, weeks }));
});

test('course-place voucher purchase value can be applied as scoped credit to a course item', () => {
  const voucher = PRODUCTS.find(({ id }) => id === 'vouchers');
  const course = { id: 'course-place', category: 'EVENTS', type: 'event-ticket', basePrice: 75 };
  const purchase = calculateCart([voucher], false);
  const redemption = calculateCart([course], false, {
    discountType: 'credit',
    discountValue: purchase.items[0].displayPrice,
    productIds: [course.id]
  });

  assert.equal(purchase.total, 60);
  assert.equal(redemption.items[0].promoEligible, true);
  assert.equal(redemption.items[0].promoSaving, 60);
  assert.equal(redemption.total, 15);
});
test('product terms follow the category, and only services choose a pricing mode', () => {
  assert.deepEqual(productTerms({ category: 'MEMBERSHIP', type: 'subscription', allowMonthly: true }), { type: 'annual-oneoff', pricingMode: 'fixed', allowMonthly: false });
  assert.equal(productTerms({ category: 'MEMBERSHIP', type: 'external' }).type, 'external');
  assert.deepEqual(productTerms({ category: 'SERVICES', type: 'yearly-service' }), { type: 'yearly-service', pricingMode: 'prorated', allowMonthly: false });
  assert.equal(productTerms({ id: 'keyhire', category: 'SERVICES', type: 'yearly-service' }).pricingMode, 'fixed');
  assert.equal(productTerms({ category: 'SERVICES', pricingMode: 'fixed', type: 'yearly-service' }).pricingMode, 'fixed');
  assert.deepEqual(productTerms({ category: 'SERVICES', pricingMode: 'prorated', allowMonthly: true }), { type: 'yearly-service', pricingMode: 'prorated', allowMonthly: false });
  assert.deepEqual(productTerms({ category: 'SERVICES', type: 'subscription' }), { type: 'subscription', pricingMode: 'subscription', allowMonthly: true });
  assert.equal(productTerms({ category: 'SERVICES', pricingMode: 'subscription', allowMonthly: false }).allowMonthly, false);
  assert.equal(productTerms({ category: 'SERVICES', pricingMode: 'subscription', allowMonthly: true }).allowMonthly, true);
  assert.deepEqual(productTerms({ category: 'SUBSCRIPTIONS' }), { type: 'subscription', pricingMode: 'subscription', allowMonthly: true });
  assert.equal(productTerms({ category: 'SUBSCRIPTIONS', allowMonthly: false }).allowMonthly, false);
  for (const [category, type] of [['VOUCHERS', 'voucher'], ['EVENTS', 'event-ticket'], ['MERCHANDISE', 'merchandise']]) {
    assert.deepEqual(productTerms({ category, type: 'subscription', pricingMode: 'prorated', allowMonthly: true }), { type, pricingMode: 'fixed', allowMonthly: false });
  }
  const defaults = resolveCatalogue(PRODUCTS, []);
  assert.ok(defaults.every((product) => product.pricingMode));
  assert.deepEqual(['boat-hire', 'keyhire'].map((id) => defaults.find((product) => product.id === id).pricingMode), ['prorated', 'fixed']);
});

test('a subscription that does not allow monthly payments is charged up front even in monthly mode', () => {
  const now = new Date(2026, 9, 1);
  const upfront = normaliseProduct({ id: 'up', category: 'SUBSCRIPTIONS', basePrice: 10, allowMonthly: false });
  const monthly = normaliseProduct({ id: 'mo', category: 'SUBSCRIPTIONS', basePrice: 10 });
  const fixed = normaliseProduct({ id: 'fx', category: 'SERVICES', type: 'yearly-service', pricingMode: 'fixed', basePrice: 85 });
  const cart = calculateCart([upfront, monthly, fixed], false, null, now);
  assert.deepEqual(cart.items.map((item) => item.monthlyBilling), [false, true, false]);
  assert.equal(cart.items[0].displayPrice, 50);
  assert.equal(cart.items[1].displayPrice, 10);
  assert.equal(cart.items[2].displayPrice, 85);
  assert.equal(calculateCart([fixed], true, null, new Date(2027, 0, 9)).total, 85);
  assert.equal(calculateCart([{ ...fixed, pricingMode: 'prorated' }], true, null, new Date(2027, 0, 9)).total, 51);
});

test('the membership rule applies to events, services and subscriptions, mapping the old event flag', () => {
  assert.equal(productMembershipRule({ category: 'EVENTS' }), 'required');
  assert.equal(productMembershipRule({ category: 'EVENTS', membershipRequired: false }), 'none');
  assert.equal(productMembershipRule({ category: 'SERVICES', membershipRule: 'included' }), 'included');
  assert.equal(productMembershipRule({ category: 'SUBSCRIPTIONS', membershipRule: 'bogus' }), 'required');
  assert.equal(productMembershipRule({ category: 'MERCHANDISE', membershipRule: 'included' }), null);
  const open = normaliseProduct({ id: 'e', category: 'EVENTS', membershipRule: 'none' });
  assert.equal(open.membershipRequired, false);
  const included = normaliseProduct({ id: 'e', category: 'EVENTS', membershipRequired: false, membershipRule: 'included' });
  assert.deepEqual([included.membershipRule, included.membershipRequired], ['included', true]);
  const merch = normaliseProduct({ id: 'm', category: 'MERCHANDISE', membershipRule: 'included', membershipRequired: true });
  assert.equal('membershipRule' in merch || 'membershipRequired' in merch, false);
});
