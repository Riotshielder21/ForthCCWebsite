import test from 'node:test';
import assert from 'node:assert/strict';
import {
  holdsForClubYear,
  londonMidnight, clubYearOf, clubYearDates, joiningShare, nextFirst, fullMonthsAfterCurrent, clubYearChoices,
  resolveClubYearChoice, clubYearsFor, monthlyDebits, clubYearLabel, recordClubYear, clubYearKind
} from './clubYear.js';

const london = (year, month, day, hour = 12) => new Date(londonMidnight(year, month, day).getTime() + hour * 60 * 60 * 1000);
const membership = { category: 'MEMBERSHIP', type: 'annual-oneoff' };
const monthly = { category: 'SUBSCRIPTIONS', type: 'subscription', pricingMode: 'subscription' };
const boatHire = { category: 'SERVICES', type: 'yearly-service', pricingMode: 'prorated' };
const event = { category: 'EVENTS', type: 'event-ticket' };

test('London midnight follows British Summer Time', () => {
  assert.equal(londonMidnight(2027, 2, 1).toISOString(), '2027-03-01T00:00:00.000Z');
  assert.equal(londonMidnight(2027, 6, 1).toISOString(), '2027-06-30T23:00:00.000Z');
  assert.equal(londonMidnight(2027, 12, 1).toISOString(), '2028-01-01T00:00:00.000Z');
});

test('the club year is named by the year it starts and changes at London midnight on 1 March', () => {
  assert.equal(clubYearOf(london(2028, 1, 29)), 2027);
  assert.equal(clubYearOf(london(2028, 2, 1, 0)), 2028);
  assert.equal(clubYearOf(new Date('2028-02-29T23:59:00Z')), 2027);
  assert.equal(clubYearLabel(2027), '2027/28');
  assert.equal(clubYearLabel(2099), '2099/00');
  const dates = clubYearDates(2027);
  assert.equal(dates.salesCutoff.toISOString(), '2028-02-15T00:00:00.000Z');
  assert.equal(dates.membershipSaleEnds.toISOString(), '2028-02-08T00:00:00.000Z');
  assert.equal(dates.end.toISOString(), '2028-03-01T00:00:00.000Z');
});

test('the joining-month charge rounds the rest of the month up to the next 20%', () => {
  // A 30-day month: 1st–6th 100%, 7th–12th 80%, 13th–18th 60%, 19th–24th 40%, 25th onwards 20%.
  const expected = { 1: 1, 6: 1, 7: 0.8, 12: 0.8, 13: 0.6, 18: 0.6, 19: 0.4, 24: 0.4, 25: 0.2, 30: 0.2 };
  for (const [day, share] of Object.entries(expected)) assert.equal(joiningShare(london(2027, 8, Number(day))), share, `September ${day}`);
  // Real month lengths: the 28th of a 28-day February is 1/28 left, the 29th of a leap February 1/29.
  assert.equal(joiningShare(london(2027, 1, 28)), 0.2);
  assert.equal(joiningShare(london(2028, 1, 29)), 0.2);
  assert.equal(joiningShare(london(2027, 0, 7)), 1);
  assert.equal(joiningShare(london(2027, 0, 8)), 0.8);
});

test('monthly debits include the full February payment and stop at the 1 March club-year end', () => {
  assert.equal(nextFirst(london(2027, 9, 15)).toISOString(), '2027-11-01T00:00:00.000Z');
  assert.equal(nextFirst(london(2027, 11, 31)).toISOString(), '2028-01-01T00:00:00.000Z');
  assert.equal(fullMonthsAfterCurrent(london(2027, 2, 1)), 11);
  assert.equal(fullMonthsAfterCurrent(london(2027, 9, 9)), 4);
  assert.equal(fullMonthsAfterCurrent(london(2028, 0, 20)), 1);
  assert.equal(fullMonthsAfterCurrent(london(2028, 1, 3)), 0);
  const january = monthlyDebits(2027, london(2028, 0, 20));
  assert.deepEqual([january.firstDebit.toISOString(), january.debits], ['2028-02-01T00:00:00.000Z', 1]);
  assert.deepEqual(monthlyDebits(2027, london(2028, 1, 3)), { firstDebit: null, debits: 0, subscriptionEnd: clubYearDates(2027).end });
  const next = monthlyDebits(2028, london(2028, 0, 20));
  assert.deepEqual([next.firstDebit.toISOString(), next.debits, next.subscriptionEnd.toISOString()], ['2028-03-01T00:00:00.000Z', 12, '2029-03-01T00:00:00.000Z']);
});

test('only membership, services and subscriptions have a club year', () => {
  assert.deepEqual([membership, monthly, boatHire, event].map(clubYearKind), ['membership', 'monthly', 'service', null]);
  assert.deepEqual(clubYearChoices(event, london(2028, 0, 10)), []);
  assert.equal(resolveClubYearChoice(event, 'next', london(2028, 0, 10)), null);
});

test('next year is on sale from 1 January; this year stops on 8 February for membership and 15 February otherwise', () => {
  const at = (month, day) => london(month < 2 ? 2028 : 2027, month, day);
  assert.deepEqual(clubYearChoices(membership, at(11, 31)), ['this']);
  assert.deepEqual(clubYearChoices(membership, at(0, 1)), ['this', 'next', 'both']);
  assert.deepEqual(clubYearChoices(membership, at(1, 7)), ['this', 'next', 'both']);
  assert.deepEqual(clubYearChoices(membership, at(1, 8)), ['next']);
  assert.deepEqual(clubYearChoices(monthly, at(1, 14)), ['this', 'next', 'both']);
  assert.deepEqual(clubYearChoices(monthly, at(1, 15)), ['next']);
  assert.deepEqual(clubYearChoices(boatHire, at(1, 15)), ['next']);
  assert.deepEqual(clubYearChoices(monthly, london(2028, 2, 1)), ['this']);
  assert.equal(resolveClubYearChoice(membership, undefined, at(1, 8)), 'next');
  assert.equal(resolveClubYearChoice(membership, 'both', at(1, 8)), null);
  assert.equal(resolveClubYearChoice(membership, 'next', at(11, 1)), null);
  assert.deepEqual(clubYearsFor('both', at(0, 5)), [2027, 2028]);
  assert.deepEqual(clubYearsFor('next', at(0, 5)), [2028]);
});

test('sales close on 15 February while subscriptions continue through the February debit', () => {
  const monthlySalesEnd = clubYearDates(2027).salesCutoff;
  const subscriptionEnd = clubYearDates(2027).end;
  assert.equal(monthlySalesEnd.toISOString(), '2028-02-15T00:00:00.000Z');
  assert.equal(subscriptionEnd.toISOString(), '2028-03-01T00:00:00.000Z');
  assert.deepEqual(clubYearChoices(monthly, new Date('2028-02-14T12:00:00Z')), ['this', 'next', 'both']);
  assert.deepEqual(clubYearChoices(monthly, new Date('2028-02-15T00:00:00Z')), ['next']);
  assert.deepEqual(monthlyDebits(2027, london(2028, 0, 20)), {
    firstDebit: londonMidnight(2028, 1, 1), debits: 1, subscriptionEnd
  });
});

test('older records take their club year from when they were granted', () => {
  assert.equal(recordClubYear({ clubYear: 2030, grantedAt: london(2027, 5, 1) }), 2030);
  assert.equal(recordClubYear({ grantedAt: london(2028, 1, 1) }), 2027);
  assert.equal(recordClubYear({ grantedAt: { _seconds: london(2028, 2, 2).getTime() / 1000 } }), 2028);
  assert.equal(recordClubYear({}), null);
});

test('an item already held for a club year is recognised from privileges and monthly items', () => {
  const member = {
    privileges: [{ productId: 'hire', grantedAt: new Date(2026, 5, 1) }, { productId: 'old', clubYear: 2026, endedAt: new Date(2026, 6, 1) }],
    subscriptionItems: [{ productId: 'coach', clubYear: 2027, status: 'active' }, { productId: 'gone', clubYear: 2026, status: 'cancelled' }]
  };
  assert.equal(holdsForClubYear(member, 'hire', 2026), true);
  assert.equal(holdsForClubYear(member, 'hire', 2027), false);
  assert.equal(holdsForClubYear(member, 'old', 2026), false);
  assert.equal(holdsForClubYear(member, 'coach', 2027), true);
  assert.equal(holdsForClubYear(member, 'gone', 2026), false);
  assert.equal(holdsForClubYear(undefined, 'hire', 2026), false);
});
