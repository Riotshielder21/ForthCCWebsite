import test from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, identityEmails, matchesIdentity, redactOrder, redactSubscription, sharedDetailsErrors, sharedDetailsUpdate, ticketsToReview } from './erasure.js';

const member = { firstName: 'Jo', lastName: 'Lee', dob: '1990-01-02', email: 'Jo@Example.com', affiliationNumber: 'PS1' };

test('an erasure request must match name, date of birth and email, and the membership number only when both sides have one', () => {
  const request = { email: ' jo@example.com ', firstName: 'jo', lastName: 'LEE', dob: '1990-01-02' };
  assert.equal(matchesIdentity(member, request), true);
  assert.equal(matchesIdentity(member, { ...request, affiliationNumber: 'ps1' }), true);
  assert.equal(matchesIdentity(member, { ...request, affiliationNumber: 'PS2' }), false);
  assert.equal(matchesIdentity(member, { ...request, affiliationNumber: 'FCC-ps1' }), true);
  assert.equal(matchesIdentity({ ...member, id: 'M0007' }, { ...request, affiliationNumber: 'm0007' }), true);
  assert.equal(matchesIdentity({ ...member, id: 'M0007' }, { ...request, affiliationNumber: 'M0008' }), false);
  assert.equal(matchesIdentity({ ...member, affiliationNumber: '' }, { ...request, affiliationNumber: 'PS2' }), true);
  assert.equal(matchesIdentity(member, { ...request, dob: '1990-01-03' }), false);
  assert.equal(matchesIdentity(member, { ...request, email: 'other@example.com' }), false);
  assert.equal(matchesIdentity(member, { ...request, firstName: 'Al' }), false);
  assert.equal(matchesIdentity({ ...member, email: '', guardian: { email: 'parent@example.com' } }, { ...request, email: 'parent@example.com' }), true);
  assert.deepEqual(identityEmails({ email: 'A@b.co', guardian: { email: 'a@b.co' } }), ['a@b.co']);
  const household = { email: 'parent@example.com' };
  assert.equal(matchesIdentity({ ...member, email: '' }, { ...request, email: 'parent@example.com' }, household), true);
  assert.deepEqual(identityEmails({ email: '' }, household), ['parent@example.com']);
});

test('a family is everyone sharing the family group; others stand alone', () => {
  const records = [{ id: 'a', familyGroup: 'F1' }, { id: 'b', familyGroup: 'F1' }, { id: 'c', familyGroup: 'F2' }, { id: 'd', familyGroup: '' }];
  assert.deepEqual(familyOf(records, records[0]).map((record) => record.id), ['a', 'b']);
  assert.deepEqual(familyOf(records, records[3]).map((record) => record.id), ['d']);
  const household = [{ id: 'p', householdId: 'H1' }, { id: 'c', householdId: 'H1' }, { id: 'x', householdId: 'H2' }];
  assert.deepEqual(familyOf(household, household[0]).map((record) => record.id), ['p', 'c']);
});

test('erasing a person strips their details from an order but keeps items and amounts', () => {
  const order = { email: 'Parent@Example.com', totalPence: 6500, items: [{ name: 'Family' }], receiptTokenHash: 'abc',
    people: [{ id: 'p1', membershipId: 'M1', lineIds: ['l1'], firstName: 'Pat', lastName: 'Lee', email: 'parent@example.com', medical: 'asthma' },
      { id: 'p2', membershipId: 'M2', lineIds: ['l1'], firstName: 'Kit', lastName: 'Lee', junior: true, guardian: { email: 'parent@example.com' } }] };
  const one = redactOrder(order, ['M2'], ['parent@example.com']);
  assert.deepEqual(one.people[1], { id: 'p2', lineIds: ['l1'], membershipId: 'M2', erased: true });
  assert.equal(one.people[0].firstName, 'Pat');
  assert.equal(one.receiptTokenHash, undefined, 'the receipt link stays while the payer email does');
  assert.equal(one.email, undefined, 'the payer email stays while another person still uses it');
  const everyone = redactOrder(order, ['M1', 'M2'], ['parent@example.com']);
  assert.equal(everyone.email, '***');
  assert.equal(everyone.receiptTokenHash, '');
  assert.equal(Object.hasOwn(everyone, 'receipt'), false);
  assert.equal(everyone.people.every((person) => person.erased && !person.firstName), true);
  assert.equal(redactOrder(order, ['M9'], ['nobody@example.com']), null);
  assert.equal(redactOrder({ ...order, email: '***', people: [] }, [], ['***']), null);
});

test('an order with no people loses its payer email when that email is erased', () => {
  assert.equal(redactOrder({ email: 'a@b.co', items: [], people: [] }, [], ['a@b.co']).email, '***');
  assert.equal(redactOrder({ email: 'a@b.co', items: [] }, [], ['c@d.co']), null);
});

test('erasing an adult household contact strips duplicated contact details from retained order people', () => {
  const order = { email: 'parent@example.com', people: [
    { id: 'parent', membershipId: 'M1', householdId: 'H1', firstName: 'Pat', email: 'parent@example.com' },
    { id: 'child', membershipId: 'M2', householdId: 'H1', firstName: 'Kit', guardian: { email: 'parent@example.com' }, phone: '123', emergencyContact: { name: 'Pat' } }
  ] };
  const redacted = redactOrder(order, ['M1'], ['parent@example.com'], ['H1']);
  assert.deepEqual(redacted.people[1], { id: 'child', membershipId: 'M2', householdId: 'H1', firstName: 'Kit' });
});

test('replacement shared details are validated and applied to every remaining member', () => {
  assert.equal(sharedDetailsErrors({}).length > 5, true);
  const details = { contactName: 'Sam Lee', contactRelationship: 'Parent', phone: '0777', email: 'Sam@Example.com', address: '1 Road', postcode: 'EH1',
    emergencyName: 'Pat', emergencyPhone: '0778', emergencyRelationship: 'Friend' };
  assert.deepEqual(sharedDetailsErrors(details), []);
  assert.deepEqual(sharedDetailsErrors({ ...details, email: 'nope' }), ['Enter a valid email address.']);
  const update = sharedDetailsUpdate(details);
  assert.equal(update.contactName, 'Sam Lee');
  assert.equal(update.contactRelationship, 'Parent');
  assert.equal(update.email, 'sam@example.com');
  assert.deepEqual(update.emergencyContact, { name: 'Pat', phone: '0778', relationship: 'Friend' });
});

test('subscription erasure keeps billing amounts and other beneficiaries, but not erased names, email or request text', () => {
  const record = { email: 'jo@example.com', names: ['Jo Lee', 'Kit Lee'], membershipIds: ['M1', 'M2'],
    items: [{ lineId: 'l1', names: ['Jo Lee'], membershipIds: ['M1'], monthlyAmount: 12, status: 'cancelled' },
      { lineId: 'l2', names: ['Kit Lee', 'Jo Lee'], membershipIds: ['M2', 'M1'], monthlyAmount: 20, status: 'active' }],
    cancelRequests: [{ at: 123, by: 'jo@example.com', lineKeys: ['o1/l1'], reason: 'Moving to my new address' }] };
  const result = redactSubscription(record, [{ id: 'M1', firstName: 'Jo', lastName: 'Lee' }], new Set(['jo@example.com']));
  assert.equal(result.email, '');
  assert.deepEqual(result.names, ['Kit Lee']);
  assert.deepEqual(result.membershipIds, ['M2']);
  assert.deepEqual(result.items[0], { lineId: 'l1', names: [], membershipIds: [], monthlyAmount: 12, status: 'cancelled' });
  assert.deepEqual(result.items[1].names, ['Kit Lee']);
  assert.equal(result.items[1].status, 'active');
  assert.deepEqual(result.cancelRequests, [{ at: 123, lineKeys: ['o1/l1'] }]);
  assert.equal(redactSubscription({ ...record, email: 'other@example.com' }, [], new Set(['jo@example.com'])).email, 'other@example.com');
});

test('erased attendees lose their event tickets from rosters and capacity, keeping what was paid', () => {
  const order = { email: 'payer@example.com', status: 'paid', items: [
    { id: 'trip', lineId: 'l1', category: 'EVENTS', pricePence: 3000 },
    { id: 'trip', lineId: 'l2', category: 'EVENTS', pricePence: 3000 },
    { id: 'senior', lineId: 'l3', category: 'MEMBERSHIP', pricePence: 5000 }],
  people: [{ membershipId: 'M1', lineIds: ['l1', 'l3'], firstName: 'Ann' }, { membershipId: 'M2', lineIds: ['l2'], firstName: 'Bob' }] };
  const update = redactOrder(order, ['M1'], []);
  assert.deepEqual(update.items.map((item) => item.attendeeErased === true), [true, false, false]);
  assert.equal(update.items[0].pricePence, 3000);
  assert.equal(redactOrder({ ...order, ...update }, ['M1'], [])?.items, undefined, 'tickets are only marked once');
  assert.equal(redactOrder({ ...order, people: [{ membershipId: 'M1', lineIds: ['l3'] }, order.people[1]] }, ['M1'], []).items, undefined);
});

test('refund checks list unfinished, unrevoked event tickets of the erased people only', () => {
  const orders = new Map([
    ['FCC-1', { status: 'paid', items: [
      { id: 'future', lineId: 'a', name: 'Future trip', category: 'EVENTS', pricePence: 2500, refunds: [{ amountPence: 500, status: 'succeeded' }, { amountPence: 900, status: 'failed' }] },
      { id: 'past', lineId: 'b', name: 'Past trip', category: 'EVENTS', pricePence: 2000 },
      { id: 'future', lineId: 'c', name: 'Future trip', category: 'EVENTS', pricePence: 2500, revokedAt: 'x' },
      { id: 'future', lineId: 'd', name: 'Future trip', category: 'EVENTS', pricePence: 2500 }],
    people: [{ membershipId: 'M1', lineIds: ['a', 'b', 'c'] }, { membershipId: 'M2', lineIds: ['d'] }] }],
    ['FCC-2', { status: 'pending', items: [{ id: 'future', lineId: 'e', category: 'EVENTS' }], people: [{ membershipId: 'M1', lineIds: ['e'] }] }]
  ]);
  const dates = { future: '2026-12-01', past: '2026-01-01' };
  const tickets = ticketsToReview(orders, ['M1'], (item) => dates[item.id], '2026-06-01');
  assert.deepEqual(tickets, [{ orderRef: 'FCC-1', lineId: 'a', membershipId: 'M1', name: 'Future trip', lastDate: '2026-12-01', pricePence: 2500, refundedPence: 500 }]);
  assert.equal(ticketsToReview(orders, ['M1'], () => '2026-06-01', '2026-06-01').length, 2, 'an event finishing today is still under way');
});
