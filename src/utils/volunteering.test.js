import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVolunteerBenefits, DEFAULT_VOLUNTEER_BENEFITS as tiers, needsVolunteerRenewal, normaliseVolunteerLevels, validateVolunteerBenefits, volunteerLevelLabel, volunteerProfileLabels, volunteerBenefitText, volunteerPrivileges } from './volunteering.js';
import { clubYearOf } from './clubYear.js';
import { calculateCart } from './pricing.js';
import { volunteerCancellationPhases } from './volunteerCancellation.js';

const now = new Date('2027-04-01T12:00:00Z');
const member = (tier, active = true) => ({ volunteer: { inducted: true, years: { 2027: { active, tier, benefits: ['Free key hire'] } } } });
const people = [{ membershipId: 'm1', lineIds: ['line'] }];
const line = { id: 'gold-sub', lineId: 'line', category: 'SUBSCRIPTIONS', pricingMode: 'subscription', basePrice: 25, allowMonthly: true };
const price = (tier, item = line, holders = people, records = new Map([['m1', member(tier)]])) => applyVolunteerBenefits([item], holders, records, tiers, now)[0];

test('20+, 40+ and 60+ volunteer subscription rates are exact, never negative and apply to Blue and Gold only', () => {
  assert.equal(price('20').basePrice, 20);
  assert.equal(price('40').basePrice, 10);
  assert.equal(price('60').basePrice, 0);
  assert.equal(price('20', { ...line, basePrice: 3 }).basePrice, 0);
  assert.equal(price('40', { ...line, basePrice: 8 }).basePrice, 8);
  assert.equal(price('20', { ...line, id: 'blue-sub' }).basePrice, 20);
  assert.equal(price('60', { ...line, id: 'coaching' }).basePrice, 25);
  assert.equal(price('60', { ...line, id: 'membership-adult' }).basePrice, 25);
});

test('discounted monthly rates also determine the annual and prorated upfront prices', () => {
  const annual = calculateCart([price('20')], true, null, now);
  const original = calculateCart([line], true, null, now);
  assert.equal(annual.items[0].displayPrice, original.items[0].displayPrice * 0.8);
  assert.equal(calculateCart([price('40')], false, null, now).items[0].monthlyAmount, 10);
});

test('benefits require induction, activation and the correct year; shared lines cannot discount another person', () => {
  assert.equal(price('20', line, people, new Map()).basePrice, 25);
  assert.equal(price('20', line, people, new Map([['m1', member('20', false)]])).basePrice, 25);
  assert.equal(price('20', { ...line, clubYearPart: 'next' }).basePrice, 25);
  assert.equal(price('60', line, [...people, { membershipId: 'm2', lineIds: ['line'] }]).basePrice, 25);
  const uninducted = member('60'); uninducted.volunteer.inducted = false;
  assert.equal(price('60', line, people, new Map([['m1', uninducted]])).basePrice, 25);
  assert.equal(price('20', { ...line, id: 'keyhire' }).basePrice, 0);
  assert.equal(price('20', { ...line, id: 'boat-hire' }).basePrice, 25);
  assert.equal(price('40', { ...line, id: 'boat-hire' }).basePrice, 0);
  assert.deepEqual(volunteerPrivileges(member('40'), tiers, now).map((privilege) => privilege.productId), ['boat-hire', 'keyhire']);
});

test('yearly volunteer renewal is independent of next-year membership and paid benefits', () => {
  const current = { ...member('40'), clubYears: [2027, 2028], privileges: [{ productId: 'boat-hire', clubYear: 2028 }] };
  assert.equal(needsVolunteerRenewal(current, 2028), true);
  current.volunteer.years[2028] = { active: true, tier: '20' };
  assert.equal(needsVolunteerRenewal(current, 2028), false);
  assert.match(volunteerProfileLabels(current, now).join(' '), /Inducted volunteer.*Active volunteer.*Free key hire/);
});

test('levels are validated and other benefits describe manual CVC or Tully, not an automatic course discount', () => {
  assert.equal(validateVolunteerBenefits({ tiers }).error, undefined);
  assert.equal(validateVolunteerBenefits({ tiers: tiers.slice(1) }).error, undefined, 'levels can be deleted');
  const added = { id: 'level-abc123', hours: 10, title: 'Taster', description: '', extra: '', monthlyDiscount: 2, monthlyCap: null, freeProductIds: [] };
  assert.deepEqual(validateVolunteerBenefits({ tiers: [...tiers, added] }).value.map((tier) => tier.id), ['level-abc123', '20', '40', '60']);
  assert.ok(validateVolunteerBenefits({ tiers: [] }).error);
  assert.ok(validateVolunteerBenefits({ tiers: [null, tiers[1], tiers[2]] }).error);
  assert.ok(validateVolunteerBenefits({ tiers: tiers.map((tier) => ({ ...tier, monthlyCap: -1 })) }).error);
  assert.ok(validateVolunteerBenefits({ tiers: [tiers[0], { ...tiers[1], hours: 20 }] }).error, 'hours must differ');
  assert.ok(validateVolunteerBenefits({ tiers: [tiers[0], { ...tiers[1], id: '20' }] }).error, 'ids must differ');
  assert.ok(validateVolunteerBenefits({ tiers: [{ ...tiers[0], title: ' ' }] }).error, 'title required');
  assert.ok(validateVolunteerBenefits({ tiers: [{ ...tiers[0], id: 'Bad id' }] }).error);
  const text = volunteerBenefitText(tiers[2]);
  assert.match(text, /25% off CVC or camping paid for at our Tully/);
  assert.doesNotMatch(text, /coaching/);
});

test('levels saved before titles existed keep their defaults, and labels use stored hours', () => {
  const [legacy] = normaliseVolunteerLevels([{ id: '60', hours: 60, monthlyDiscount: 0, monthlyCap: 0, freeProductIds: [] }]);
  assert.equal(legacy.title, 'Core Team');
  assert.match(legacy.extra, /Tully/);
  assert.equal(normaliseVolunteerLevels(undefined).length, 3);
  assert.equal(volunteerLevelLabel([{ id: 'level-x', hours: 80 }], 'level-x'), '80+ hours');
  assert.equal(volunteerLevelLabel([], '40'), '40+ hours');
  const member = { volunteer: { inducted: true, years: { [clubYearOf(now)]: { active: true, tier: 'level-x', hours: 80 } } } };
  assert.match(volunteerProfileLabels(member, now).join(' '), /Active volunteer \(80\+ hours\)/);
});

test('scheduled cancellation preserves all items in the paid phase and the unrelated item afterwards', () => {
  const subscription = { current_period_end: 200, cancel_at: 900, items: { data: [
    { id: 'free', price: { id: 'p1' }, quantity: 1 }, { id: 'paid', price: { id: 'p2' }, quantity: 2 }
  ] } };
  const result = volunteerCancellationPhases(subscription, { current_phase: { start_date: 100 } }, 'free');
  const params = Object.fromEntries(result.params);
  assert.equal(result.endsAt, 200);
  assert.equal(params['phases[0][items][0][price]'], 'p1');
  assert.equal(params['phases[0][items][1][price]'], 'p2');
  assert.equal(params['phases[1][items][0][price]'], 'p2');
  assert.equal(params['phases[1][items][0][quantity]'], '2');
  assert.equal(params['phases[1][end_date]'], '900');
  assert.equal(params['proration_behavior'], 'none');
  assert.throws(() => volunteerCancellationPhases({ ...subscription, discounts: [{}] }, {}, 'free'), /additional billing/);
  const whole = volunteerCancellationPhases({ ...subscription, items: { data: [subscription.items.data[0]] } }, { current_phase: { start_date: 100 } }, 'free');
  assert.equal(Object.fromEntries(whole.params)['phases[1][start_date]'], undefined, 'nothing else is charged when the final item ends');
});
