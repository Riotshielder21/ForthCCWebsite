import test from 'node:test';
import assert from 'node:assert/strict';
import { clubYearDates } from './clubYear.js';
import { holdsForClubYear } from './clubYear.js';
import { continuingEntitlements, termEntitlements, termId, termStart } from './membershipTerms.js';

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

test('a subscription that carries on is an entitlement in each later club year until it stops', () => {
  const now = new Date('2028-06-01T12:00:00Z');
  const item = { productId: 'blue-sub', name: 'Blue', subscriptionId: 'sub_1', lineId: 'l1', orderRef: 'O1', clubYear: 2026, interval: 'month', status: 'active' };
  assert.deepEqual(continuingEntitlements([item], now).map((entry) => [entry.productId, entry.clubYear, entry.endedAt]), [['blue-sub', 2027, undefined], ['blue-sub', 2028, undefined]],
    'the year it was bought for is already on its term');
  const cancelling = { ...item, endsAt: ts('2028-03-01T00:00:00Z') };
  assert.deepEqual(continuingEntitlements([cancelling], now).map((entry) => entry.clubYear), [2027], 'one the member stopped at a year end does not carry on');
  const stopped = { ...item, status: 'cancelled', paidUntil: ts('2027-09-01T00:00:00Z') };
  assert.deepEqual(continuingEntitlements([stopped], now).map((entry) => [entry.clubYear, entry.endedAt.toISOString()]), [[2027, '2027-09-01T00:00:00.000Z']]);
  assert.deepEqual(continuingEntitlements([{ ...item, clubYear: 2028 }], now), [], 'nothing extra in the year it started');
  assert.deepEqual(continuingEntitlements([{ ...item, status: 'cancelled' }], now), [], 'a stop with no date leaves nothing');
  assert.deepEqual(continuingEntitlements([{ ...item, interval: undefined }], now), [], 'items from before subscriptions carried on end with their club year');
});
