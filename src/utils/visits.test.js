import test from 'node:test';
import assert from 'node:assert/strict';
import { NON_MEMBER_VISIT_LIMIT, clubYearDateRange, nonMemberCheckinVisits, nonMemberEventVisits, visitSummary, validateSelfAssessmentChange } from './visits.js';

test('the club year runs from 1 March to the end of February', () => {
  assert.deepEqual(clubYearDateRange(2027), { first: '2027-03-01', last: '2028-02-29' });
});

test('non-member check-ins count once per session date within the club year', () => {
  const checkins = [
    { date: '2027-03-03', sessionId: 'club-night', membershipActive: false },
    { date: '2027-03-03', sessionId: 'club-night', membershipActive: false },
    { date: '2027-03-03', sessionId: 'pool', membershipActive: false },
    { date: '2027-03-10', sessionId: 'club-night', membershipActive: true },
    { date: '2027-02-24', sessionId: 'club-night', membershipActive: false },
    { date: '2028-03-01', sessionId: 'club-night', membershipActive: false }
  ];
  assert.equal(nonMemberCheckinVisits(checkins, 2027), 2, 'a second session the same day counts; member visits and other years do not');
});

test('paid tickets for events open to non-members count once per event in the club year', () => {
  const products = [
    { id: 'taster', category: 'EVENTS', membershipRequired: false, eventSchedule: { startDate: '2027-04-01' } },
    { id: 'course', category: 'EVENTS', membershipRequired: false, eventSchedule: { startDate: '2027-05-01' } },
    { id: 'members-trip', category: 'EVENTS', eventSchedule: { startDate: '2027-04-01' } },
    { id: 'last-year', category: 'EVENTS', membershipRequired: false, eventSchedule: { startDate: '2027-02-01' } }
  ];
  const order = (id, items, extra = {}) => ({ id, status: 'paid', people: [{ membershipId: 'm1', lineIds: items.map((item) => item.lineId) }], items, ...extra });
  const orders = [
    order('a', [{ id: 'taster', lineId: 'l1' }, { id: 'members-trip', lineId: 'l2' }, { id: 'last-year', lineId: 'l3' }]),
    order('b', [{ id: 'taster', lineId: 'l4' }]),
    order('c', [{ id: 'course', lineId: 'l5', revokedAt: new Date() }]),
    order('d', [{ id: 'course', lineId: 'l6' }], { status: 'pending' }),
    { id: 'e', status: 'paid', people: [{ membershipId: 'm2', lineIds: ['l7'] }], items: [{ id: 'course', lineId: 'l7' }] }
  ];
  assert.equal(nonMemberEventVisits(orders, 'm1', products, 2027), 1);
  assert.equal(nonMemberEventVisits(orders, 'm2', products, 2027), 1);
  assert.equal(nonMemberEventVisits(orders, 'm1', products, 2026), 1, 'the February event belongs to the previous club year');
});

test('visit labels warn once past the limit', () => {
  assert.equal(NON_MEMBER_VISIT_LIMIT, 3);
  assert.deepEqual(visitSummary(3), { count: 3, overLimit: false, label: '3 of 3 this club year' });
  assert.deepEqual(visitSummary(4), { count: 4, overLimit: true, label: '4 of 3 this club year – membership needed' });
});

test('unticking self-assessment needs a note', () => {
  assert.match(validateSelfAssessmentChange({}).error, /Choose/);
  assert.deepEqual(validateSelfAssessmentChange({ passed: true }).value, { passed: true, note: '' });
  assert.match(validateSelfAssessmentChange({ passed: false, note: ' x ' }).error, /note/);
  assert.deepEqual(validateSelfAssessmentChange({ passed: false, note: '  Needs a rolling lesson ' }).value, { passed: false, note: 'Needs a rolling lesson' });
});
