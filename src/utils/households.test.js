import test from 'node:test';
import assert from 'node:assert/strict';
import { householdForPerson, HOUSEHOLD_MEMBER_FIELDS, memberIsJunior, householdGroupKey } from './households.js';

test('a junior household stores the parent or guardian as contact and no separate emergency contact', () => {
  const household = householdForPerson({
    junior: true, firstName: 'Kit', lastName: 'Lee', email: '', phone: '',
    guardian: { name: 'Pat Lee', relationship: 'Parent', email: 'PAT@example.com', phone: '0777', address: '1 Road', postcode: 'EH1' },
    emergencyContact: { name: 'Kit', phone: '1' }
  }, 'H1');
  assert.deepEqual(household, {
    id: 'H1', contactName: 'Pat Lee', contactRelationship: 'Parent', email: 'pat@example.com',
    phone: '0777', address: '1 Road', postcode: 'EH1', updatedAt: undefined
  });
});

test('an adult household stores its external emergency contact', () => {
  const household = householdForPerson({
    firstName: 'Pat', lastName: 'Lee', email: 'pat@example.com', phone: '0777', address: '1 Road', postcode: 'EH1',
    emergencyContact: { name: 'Sam', relationship: 'Friend', phone: '0778' }
  }, 'H2');
  assert.deepEqual(household.emergencyContact, { name: 'Sam', relationship: 'Friend', phone: '0778' });
  assert.equal(household.contactName, 'Pat Lee');
});

test('personal contact fields are kept out of member records', () => {
  assert.deepEqual(HOUSEHOLD_MEMBER_FIELDS, [
    'email', 'phone', 'address', 'postcode', 'guardian', 'emergencyContact', 'emergencyNote', 'photoConsent',
    'familyGroup', 'junior', 'returning', 'disclaimerAccepted'
  ]);
  assert.equal(memberIsJunior({ membershipTier: 'junior' }), true);
});

test('siblings with the same guardian share a group while adult households remain individual', () => {
  const siblingOne = { id: 'one', junior: true, guardian: { name: 'Pat Lee', email: ' PAT@example.com ' } };
  const siblingTwo = { id: 'two', junior: true, guardian: { name: ' pat   lee ', email: 'pat@example.com' } };
  assert.equal(householdGroupKey(siblingOne), householdGroupKey(siblingTwo));
  assert.notEqual(householdGroupKey({ id: 'adult-one', firstName: 'Pat', lastName: 'Lee', email: 'pat@example.com' }),
    householdGroupKey({ id: 'adult-two', firstName: 'Pat', lastName: 'Lee', email: 'pat@example.com' }));
  assert.equal(householdGroupKey({ ...siblingOne, familyGroup: 'F1' }), 'family:F1');
});
