import test from 'node:test';
import assert from 'node:assert/strict';
import { clubYearDates } from './clubYear.js';
import { holdsForClubYear } from './clubYear.js';
import { legacyTerms, termEntitlements, termId, termStart } from './membershipTerms.js';

const ts = (iso) => ({ toDate: () => new Date(iso), toMillis: () => new Date(iso).getTime() });

test('term ids and entitlements carry the club year of their term', () => {
  assert.equal(termId('M0001', 2026), 'M0001_2026');
  const entitlements = termEntitlements([{ clubYear: 2026, items: [{ productId: 'boat-hire' }] }, { clubYear: 2027, items: [{ productId: 'keyhire', endedAt: 1 }] }, { clubYear: 2028 }]);
  assert.deepEqual(entitlements, [{ productId: 'boat-hire', clubYear: 2026 }, { productId: 'keyhire', endedAt: 1, clubYear: 2027 }]);
  assert.equal(holdsForClubYear({ entitlements }, 'boat-hire', 2026), true);
  assert.equal(holdsForClubYear({ entitlements }, 'keyhire', 2027), false);
});

test('a membership starts when it is paid for, or on 1 March when bought ahead', () => {
  assert.deepEqual(termStart(2026, ts('2026-07-10T12:00:00Z')), new Date('2026-07-10T12:00:00Z'));
  assert.deepEqual(termStart(2027, ts('2027-01-20T12:00:00Z')), clubYearDates(2027).start);
});

test('an old-shape website record becomes one term per club year with its entitlements', () => {
  const fields = {
    source: 'website', membershipTier: 'adult', clubYears: [2025, 2026], validUntil: ts(clubYearDates(2026).end.toISOString()),
    privileges: [
      { productId: 'boat-hire', name: 'Boat hire', orderRef: 'O1', lineId: 'l2', grantedAt: ts('2025-04-01T10:00:00Z') },
      { productId: 'keyhire', name: 'Key hire', orderRef: 'O2', lineId: 'k1', clubYear: 2026, grantedAt: ts('2026-03-05T10:00:00Z'), endedAt: ts('2026-06-01T00:00:00Z') }
    ],
    history: [{ orderRef: 'O1', paidAt: ts('2025-04-01T10:00:00Z') }, { orderRef: 'O2', paidAt: ts('2026-03-05T10:00:00Z') }]
  };
  const orders = new Map([
    ['O1', { paidAt: ts('2025-04-01T10:00:00Z'), people: [{ membershipId: 'M1', lineIds: ['l1', 'l2'] }],
      items: [{ lineId: 'l1', id: 'adult', category: 'MEMBERSHIP', membershipTier: 'adult' }, { lineId: 'l2', id: 'boat-hire', category: 'HIRE' }] }],
    ['O2', { paidAt: ts('2026-03-05T10:00:00Z'), stripeSubscriptionId: 'sub_1', stripeMode: 'test', people: [{ membershipId: 'M1', lineIds: ['m2', 'k1'] }],
      items: [{ lineId: 'm2', id: 'adult', category: 'MEMBERSHIP', type: 'subscription', membershipTier: 'adult', clubYear: 2026 }, { lineId: 'k1', id: 'keyhire' }] }]
  ]);
  const plan = legacyTerms('M1', fields, orders);
  assert.deepEqual(plan.orderRefs, ['O1', 'O2']);
  const [first, second] = plan.terms.sort((a, b) => a.clubYear - b.clubYear);
  assert.equal(first.clubYear, 2025);
  assert.equal(first.source, 'website');
  assert.equal(first.orderRef, 'O1');
  assert.equal(first.tier, 'adult');
  assert.deepEqual(first.start, new Date('2025-04-01T10:00:00Z'));
  assert.deepEqual(first.end, clubYearDates(2025).end);
  assert.deepEqual(first.items.map((item) => item.productId), ['boat-hire']);
  assert.equal(second.orderRef, 'O2');
  assert.equal(second.items[0].productId, 'keyhire');
  assert.ok(second.items[0].endedAt, 'an ended entitlement stays ended');
  assert.equal('clubYear' in second.items[0], false, 'the club year lives on the term');
  assert.deepEqual(plan.stripeMembership, { stripeMembershipSubscriptionId: 'sub_1', stripeMembershipMode: 'test' });
  assert.equal(plan.keyAccess, null, 'ended key hire grants nothing');
});

test('a membership cut short ends at validUntil, and imported years without an order keep the record source', () => {
  const cut = ts('2026-08-01T00:00:00Z');
  const plan = legacyTerms('M2', { source: 'justgo', justgoSyncStatus: 'synced', membershipTier: 'junior', clubYears: [2026], validUntil: cut,
    stripeMembershipSubscriptionId: '' });
  assert.equal(plan.terms.length, 1);
  assert.equal(plan.terms[0].source, 'justgo');
  assert.equal(plan.terms[0].orderRef, '');
  assert.deepEqual(plan.terms[0].start, clubYearDates(2026).start);
  assert.deepEqual(plan.terms[0].end, new Date('2026-08-01T00:00:00Z'));
  assert.equal(plan.stripeMembership, null, 'a record that already has a subscription reference is left alone');
});

test('membership included with another purchase is recorded as included, and old key hire becomes key access', () => {
  const plan = legacyTerms('M3', {
    clubYears: [2026], membershipTier: 'adult', source: 'website',
    privileges: [{ productId: 'keyhire', name: 'Key hire', orderRef: 'O3', clubYear: 2026, grantedAt: ts('2026-05-01T00:00:00Z') }],
    history: [{ orderRef: 'O3', paidAt: ts('2026-05-01T00:00:00Z') }]
  }, new Map([['O3', { paidAt: ts('2026-05-01T00:00:00Z'), people: [{ membershipId: 'M3', lineIds: ['c1', 'k1'], grantMembershipYears: [2026] }],
    items: [{ lineId: 'c1', id: 'course', name: 'Course', category: 'SERVICES', membershipRule: 'included', clubYear: 2026 }, { lineId: 'k1', id: 'keyhire', clubYear: 2026 }] }]]));
  assert.equal(plan.terms[0].source, 'included');
  assert.deepEqual(plan.terms[0].includedWith, { productId: 'course', name: 'Course' });
  assert.deepEqual(plan.stripeMembership, { stripeMembershipSubscriptionId: '', stripeMembershipMode: '' });
  assert.equal(plan.keyAccess.source, 'purchase');
  assert.ok(plan.keyAccess.grantedAt);
});

test('a revoked membership line is not counted as buying that year', () => {
  const plan = legacyTerms('M4', { source: 'website', membershipTier: 'adult', clubYears: [2026], history: [{ orderRef: 'O4' }] },
    new Map([['O4', { paidAt: ts('2026-04-01T00:00:00Z'), people: [{ membershipId: 'M4', lineIds: ['l1'] }],
      items: [{ lineId: 'l1', id: 'adult', category: 'MEMBERSHIP', clubYear: 2026, revokedAt: ts('2026-05-01T00:00:00Z') }] }]]));
  assert.equal(plan.terms[0].orderRef, '');
  assert.equal(plan.terms[0].source, 'website');
});
