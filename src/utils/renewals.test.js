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
    { id: 'm1', firstName: 'Ann', lastName: 'Lee', dob: '1980-01-01', membershipTier: 'family', entitlements: [{ productId: 'locker', clubYear: 2027 }, { productId: 'locker', clubYear: 2027 }, { productId: 'hoodie', clubYear: 2027 }] },
    { id: 'm2', firstName: 'Bo', lastName: 'Lee', dob: '2015-01-01', membershipTier: 'family', entitlements: [{ productId: 'locker', clubYear: 2026 }, { productId: 'locker', clubYear: 2027, endedAt: 1 }] }
  ];
  const basket = renewalBasket(members, catalog, 2027, counter());
  assert.deepEqual(basket.items, [{ id: 'membership-family', lineId: 'id3' }, { id: 'locker', lineId: 'id4' }]);
  assert.deepEqual(basket.people.map((person) => [person.membershipId, person.returning, person.lineIds]), [['m1', true, ['id3', 'id4']], ['m2', true, ['id3']]]);
  assert.equal(basket.billingMode, 'annual');
});

test('renewal basket gives individual memberships and leaves subscriptions, which carry on, out', () => {
  const members = [
    { id: 'm1', membershipTier: 'junior', subscriptionItems: [{ productId: 'coaching', clubYear: 2027, interval: 'month', status: 'active' }],
      entitlements: [{ productId: 'coaching', clubYear: 2027 }] },
    { id: 'm2', membershipTier: 'adult', subscriptionItems: [{ productId: 'coaching', clubYear: 2027, interval: 'month', status: 'cancelled' }] },
    { id: 'm3', membershipTier: 'adult', entitlements: [{ productId: 'retired', clubYear: 2027 }] }
  ];
  const basket = renewalBasket(members, catalog, 2027, counter());
  assert.deepEqual(basket.items.map((item) => item.id), ['membership-junior', 'membership-adult', 'membership-adult']);
  assert.deepEqual(basket.people[0].lineIds, ['id4']);
  assert.deepEqual([basket.billingMode, basket.subscriptionsContinue], ['annual', true]);
  assert.equal(renewalBasket([members[1]], catalog, 2027, counter()).subscriptionsContinue, false, 'a cancelled one does not carry on');
  const stopping = { id: 'm4', membershipTier: 'adult', subscriptionItems: [{ productId: 'coaching', clubYear: 2027, interval: 'month', status: 'active', endsAt: new Date('2028-03-01T00:00:00Z') }] };
  assert.equal(renewalBasket([stopping], catalog, 2027, counter()).subscriptionsContinue, false, 'nor one stopping when the renewal year starts');
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
  const basket = renewalBasket([{ id: 'm1', firstName: 'Ann', lastName: 'Lee', membershipTier: 'adult', entitlements: [{ productId: 'locker', clubYear: 2027 }] }], [...catalog.slice(0, 4), { ...catalog[4], name: 'Locker <rental>' }], 2027, counter());
  const email = renewalEmail({ renewalYear: 2028, basket: { ...basket, catalog: [{ id: 'membership-adult', name: 'Adult membership' }, { id: 'locker', name: 'Locker <rental>' }],
    link: 'https://example.test/membership?renew=abc', expiresAt: renewalWindow(january).expiresAt } });
  assert.equal(email.subject, 'Renew your Forth Canoe Club membership for 2028/29');
  assert.match(email.body, /Renew Ann Lee: the link fills your basket with:/);
  assert.match(email.body, /- Adult membership \(Ann\)\n- Locker <rental> \(Ann\)/);
  assert.match(email.body, /works until 31 March 2028/);
  assert.match(email.html, /Locker &lt;rental&gt;/);
  assert.match(email.html, /href="https:\/\/example.test\/membership\?renew=abc"/);
  assert.match(renewalEmail({ renewalYear: 2028, reminder: true, basket: { ...basket, catalog: [], link: 'x', expiresAt: renewalWindow(january).expiresAt } }).subject, /^Reminder: renew your/);
  assert.doesNotMatch(email.html, /Confirm all|Cancel/, 'with nothing else to confirm there is just the basket');
});

test('one renewal email has a Confirm for each part, then Confirm all, then Cancel at the bottom', () => {
  const basket = renewalBasket([{ id: 'm1', firstName: 'Ann', lastName: 'Lee', membershipTier: 'adult' }], catalog, 2027, counter());
  const subscription = { lines: [{ name: 'Gold', names: ['Ann Lee'], price: '£15.00 a month', nextPrice: '£30.00 a month', ifVolunteering: '£10.00 a month', volunteers: ['Ann'] }],
    confirmUrl: 'https://site/subscription?key=k&answer=confirm', cancelUrl: 'https://site/subscription?key=k&answer=cancel' };
  const email = renewalEmail({ renewalYear: 2028, contact: 'treasurer@example.test', confirmAllUrl: 'https://site/subscription?all=b&basket=abc',
    basket: { ...basket, catalog: [{ id: 'membership-adult', name: 'Adult membership' }], link: 'https://site/membership?renew=abc', expiresAt: renewalWindow(january).expiresAt },
    volunteers: [{ name: 'Ann Lee', firstName: 'Ann', commitment: '40+ hour', keepUrl: 'https://site/volunteering?volunteerRenew=v', changeUrl: 'https://site/volunteering?volunteerRenew=v&change=1' }],
    subscriptions: [subscription] });
  const buttons = ['Confirm: go to the basket', 'Confirm volunteering for Ann', 'Confirm subscription', 'Confirm all and go to the basket', 'Cancel subscription']
    .map((label) => email.html.indexOf(`>${label}</a>`));
  assert.ok(buttons.every((position, index) => position > (index ? buttons[index - 1] : -1)), `in order: ${buttons}`);
  assert.match(email.html, /background:#15803d"><a href="https:\/\/site\/subscription\?key=k&amp;answer=confirm"[^>]*>Confirm subscription<\/a>/);
  assert.match(email.html, /background:#b91c1c"><a href="https:\/\/site\/subscription\?key=k&amp;answer=cancel"[^>]*>Cancel subscription<\/a>/);
  assert.match(email.body, /- Gold \(Ann Lee\): £10\.00 a month if Ann volunteers again, otherwise £30\.00 a month/);
  assert.match(email.body, /Keep your 40\+ hour commitment/);
  assert.match(email.body, /Confirm all and go to the basket: https:\/\/site\/subscription\?all=b&basket=abc/);
  const only = renewalEmail({ renewalYear: 2028, subscriptions: [subscription] });
  assert.equal(only.subject, 'Confirm or cancel your Forth Canoe Club subscription for 2028/29', 'a payer with nothing to renew');
  assert.doesNotMatch(only.body, /Confirm all|basket/);
});
