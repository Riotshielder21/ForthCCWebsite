import test from 'node:test';
import assert from 'node:assert/strict';
import { clubYearDates } from './clubYear.js';
import { holdsForClubYear } from './clubYear.js';
import { termEntitlements, termId, termStart } from './membershipTerms.js';

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
