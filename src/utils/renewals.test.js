import test from 'node:test';
import assert from 'node:assert/strict';
import { needsRenewal, renewalBasket, renewalChoice, renewalEmail, renewalRound, renewalWindow } from './renewals.js';
import { clubYearDates } from './clubYear.js';

const catalog = [
  { id: 'membership-adult', category: 'MEMBERSHIP', membershipTier: 'adult' },
  { id: 'membership-junior', category: 'MEMBERSHIP', membershipTier: 'junior' },
  { id: 'membership-family', category: 'MEMBERSHIP', membershipTier: 'family' },
  { id: 'justgo', category: 'MEMBERSHIP', membershipTier: 'adult', type: 'external' },
  { id: 'locker', category: 'SERVICES', pricingMode: 'fixed' },
  { id: 'coaching', category: 'SUBSCRIPTIONS', pricingMode: 'subscription' },
  { id: 'hoodie', category: 'MERCHANDISE' }
];
const january = new Date('2028-01-10T12:00:00Z');
const end = clubYearDates(2027).end.getTime();
const counter = () => { let next = 0; return () => `id${++next}`; };

test('renewal window opens 1 January, is scheduled from 1 February and links last until 31 March', () => {
  const window = renewalWindow(january);
  assert.equal(window.clubYear, 2027);
  assert.equal(window.renewalYear, 2028);
  assert.equal(window.opens.toISOString(), '2028-01-01T00:00:00.000Z');
  assert.equal(window.scheduledFrom.toISOString(), '2028-02-01T00:00:00.000Z');
  assert.equal(window.reminderFrom.toISOString(), '2028-02-15T00:00:00.000Z');
  assert.equal(window.closes.toISOString(), '2028-03-01T00:00:00.000Z');
  assert.equal(window.expiresAt.toISOString(), '2028-03-31T23:00:00.000Z');
});

test('only active website members whose cover ends this club year need renewing', () => {
  const member = { status: 'active', renewalMethod: 'website', validUntil: end };
  assert.equal(needsRenewal(member, january), true);
  assert.equal(needsRenewal({ ...member, renewalMethod: 'justgo' }, january), false);
  assert.equal(needsRenewal({ ...member, contactOnly: true }, january), false);
  assert.equal(needsRenewal({ ...member, status: 'expired' }, january), false);
  assert.equal(needsRenewal({ ...member, validUntil: clubYearDates(2028).end.getTime() }, january), false);
  assert.equal(needsRenewal({ ...member, validUntil: end }, new Date(end + 1000)), false);
});

test('members who already hold next year are not emailed, even without their extras', () => {
  const member = { status: 'active', renewalMethod: 'website', validUntil: end, clubYears: [2027] };
  assert.equal(needsRenewal(member, january), true);
  assert.equal(needsRenewal({ ...member, clubYears: [2027, 2028] }, january), false);
  assert.equal(needsRenewal({ ...member, clubYears: ['2028'] }, january), false);
});

test('scheduled emails go on 1 February and a reminder on 15 February only', () => {
  assert.equal(renewalRound(january), null);
  assert.equal(renewalRound(new Date('2028-01-31T23:59:00Z')), null);
  assert.equal(renewalRound(new Date('2028-02-01T09:00:00Z')), 'first');
  assert.equal(renewalRound(new Date('2028-02-14T23:59:00Z')), 'first');
  assert.equal(renewalRound(new Date('2028-02-15T09:00:00Z')), 'reminder');
  assert.equal(renewalRound(new Date('2028-02-29T12:00:00Z')), 'reminder');
  assert.equal(renewalRound(new Date('2028-03-01T09:00:00Z')), null);
});

test('renewal basket shares one family membership and carries this year\'s services', () => {
  const members = [
    { id: 'm1', firstName: 'Ann', lastName: 'Lee', dob: '1980-01-01', membershipTier: 'family', privileges: [{ productId: 'locker', clubYear: 2027 }, { productId: 'locker', clubYear: 2027 }, { productId: 'hoodie', clubYear: 2027 }] },
    { id: 'm2', firstName: 'Bo', lastName: 'Lee', dob: '2015-01-01', membershipTier: 'family', privileges: [{ productId: 'locker', clubYear: 2026 }, { productId: 'locker', clubYear: 2027, endedAt: 1 }] }
  ];
  const basket = renewalBasket(members, catalog, 2027, counter());
  assert.deepEqual(basket.items, [{ id: 'membership-family', lineId: 'id3' }, { id: 'locker', lineId: 'id4' }]);
  assert.deepEqual(basket.people.map((person) => [person.membershipId, person.returning, person.lineIds]), [['m1', true, ['id3', 'id4']], ['m2', true, ['id3']]]);
  assert.equal(basket.billingMode, 'annual');
});

test('renewal basket gives individual memberships and keeps monthly billing for active subscriptions', () => {
  const members = [
    { id: 'm1', membershipTier: 'junior', subscriptionItems: [{ productId: 'coaching', clubYear: 2027, status: 'active' }] },
    { id: 'm2', membershipTier: 'adult', subscriptionItems: [{ productId: 'coaching', clubYear: 2027, status: 'cancelled' }] },
    { id: 'm3', membershipTier: 'adult', privileges: [{ productId: 'retired', clubYear: 2027 }] }
  ];
  const basket = renewalBasket(members, catalog, 2027, counter());
  assert.deepEqual(basket.items.map((item) => item.id), ['membership-junior', 'membership-adult', 'membership-adult', 'coaching']);
  assert.deepEqual(basket.people[0].lineIds, ['id4', 'id7']);
  assert.equal(basket.billingMode, 'monthly');
});

test('renewal basket lists the oldest first, so an adult is the family contact', () => {
  const members = [
    { id: 'child', membershipTier: 'family', dob: '2015-04-21' },
    { id: 'undated', membershipTier: 'family' },
    { id: 'parent', membershipTier: 'family', dob: '1985-09-03' }
  ];
  assert.deepEqual(renewalBasket(members, catalog, 2027, counter()).people.map((person) => person.membershipId), ['parent', 'child', 'undated']);
});

test('renewal lines are for next year until 1 March, then this year', () => {
  assert.equal(renewalChoice(2028, january), 'next');
  assert.equal(renewalChoice(2028, new Date('2028-03-10T12:00:00Z')), 'this');
  assert.equal(renewalChoice(2028, new Date('2029-03-10T12:00:00Z')), null);
});

test('renewal email lists the basket, the link and the expiry date', () => {
  const basket = renewalBasket([{ id: 'm1', firstName: 'Ann', lastName: 'Lee', membershipTier: 'adult', privileges: [{ productId: 'locker', clubYear: 2027 }] }], [...catalog.slice(0, 4), { ...catalog[4], name: 'Locker <rental>' }], 2027, counter());
  const email = renewalEmail({ ...basket, catalog: [{ id: 'membership-adult', name: 'Adult membership' }, { id: 'locker', name: 'Locker <rental>' }], renewalYear: 2028,
    link: 'https://example.test/membership?renew=abc', expiresAt: renewalWindow(january).expiresAt });
  assert.equal(email.subject, 'Renew your Forth Canoe Club membership for 2028/29');
  assert.match(email.body, /Renew Ann Lee using the link/);
  assert.match(email.body, /- Adult membership \(Ann\)\n- Locker <rental> \(Ann\)/);
  assert.match(email.body, /works until 31 March 2028/);
  assert.match(email.html, /Locker &lt;rental&gt;/);
  assert.match(email.html, /href="https:\/\/example.test\/membership\?renew=abc"/);
  assert.match(renewalEmail({ ...basket, catalog: [], renewalYear: 2028, link: 'x', expiresAt: renewalWindow(january).expiresAt, reminder: true }).subject, /^Reminder: renew your/);
});
