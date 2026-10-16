import test from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, identityEmails, matchesIdentity, redactOrder, sharedDetailsErrors, sharedDetailsUpdate } from './erasure.js';

const member = { firstName: 'Jo', lastName: 'Lee', dob: '1990-01-02', email: 'Jo@Example.com', affiliationNumber: 'PS1' };

test('an erasure request must match name, date of birth and email, and the membership number only when both sides have one', () => {
  const request = { email: ' jo@example.com ', firstName: 'jo', lastName: 'LEE', dob: '1990-01-02' };
  assert.equal(matchesIdentity(member, request), true);
  assert.equal(matchesIdentity(member, { ...request, affiliationNumber: 'ps1' }), true);
  assert.equal(matchesIdentity(member, { ...request, affiliationNumber: 'PS2' }), false);
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
  const order = { email: 'Parent@Example.com', total: '65', items: [{ name: 'Family' }], receipt: { name: 'x' }, accessTokenHash: 'abc',
    people: [{ id: 'p1', membershipId: 'M1', lineIds: ['l1'], firstName: 'Pat', lastName: 'Lee', email: 'parent@example.com', medical: 'asthma' },
      { id: 'p2', membershipId: 'M2', lineIds: ['l1'], firstName: 'Kit', lastName: 'Lee', junior: true, guardian: { email: 'parent@example.com' } }] };
  const one = redactOrder(order, ['M2'], ['parent@example.com']);
  assert.deepEqual(one.people[1], { id: 'p2', lineIds: ['l1'], membershipId: 'M2', erased: true });
  assert.equal(one.people[0].firstName, 'Pat');
  assert.equal(one.email, undefined, 'the payer email stays while another person still uses it');
  const everyone = redactOrder(order, ['M1', 'M2'], ['parent@example.com']);
  assert.equal(everyone.email, '***');
  assert.deepEqual(everyone.receipt, {});
  assert.equal(everyone.accessTokenHash, '');
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
