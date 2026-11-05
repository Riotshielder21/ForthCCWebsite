import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPersonName, normaliseAffiliationNumber, normaliseName, normalisePhoneNumber, normaliseUkPostcode
} from './personalDetails.js';
import { personInputErrors, sanitizePerson } from './checkout.js';

test('names accept Unicode letters, spaces, apostrophes and hyphens', () => {
  for (const name of ['Zoë', 'Søren', 'Amina O’Connor', 'Jean-Luc Picard', 'Mary Jane Watson']) {
    assert.equal(isValidPersonName(name), true, name);
  }
  for (const name of ['', 'Anne3', 'A_B', '  ']) assert.equal(isValidPersonName(name), false, name);
  assert.equal(normaliseName('  Mary   Jane  '), 'Mary Jane');
});

test('UK and international phone numbers accept normal formatting and normalize to E.164', () => {
  assert.equal(normalisePhoneNumber('07911 123456'), '+447911123456');
  assert.equal(normalisePhoneNumber('+1 (202) 555-0123'), '+12025550123');
  assert.equal(normalisePhoneNumber('not a phone'), null);
  assert.equal(normalisePhoneNumber('077'), null);
});

test('UK postcodes validate and normalize spacing and case', () => {
  assert.equal(normaliseUkPostcode('eh111ed'), 'EH11 1ED');
  assert.equal(normaliseUkPostcode('SW1A 1AA'), 'SW1A 1AA');
  assert.equal(normaliseUkPostcode('gir 0aa'), 'GIR 0AA');
  assert.equal(normaliseUkPostcode('EH1'), null);
  assert.equal(normaliseUkPostcode('not a postcode'), null);
});

test('checkout contact details are stored with normalized phone numbers and postcodes', () => {
  const person = sanitizePerson({
    id: 'person-1', firstName: '  Zoë  ', lastName: " O’Connor ",
    phone: '07911 123456', postcode: 'eh111ed',
    guardian: { phone: '07911 123457', postcode: 'eh2 2aa' },
    emergencyContact: { name: 'Jean-Luc', phone: '07911 123458' }
  });
  assert.equal(person.firstName, 'Zoë');
  assert.equal(person.lastName, 'O’Connor');
  assert.equal(person.phone, '+447911123456');
  assert.equal(person.postcode, 'EH11 1ED');
  assert.equal(person.guardian.phone, '+447911123457');
  assert.equal(person.guardian.postcode, 'EH2 2AA');
  assert.equal(person.emergencyContact.phone, '+447911123458');
});

test('raw API fields with invalid types or excessive lengths are rejected before sanitization', () => {
  assert.deepEqual(personInputErrors([{ firstName: 42, affiliationNumber: 123 }]), [
    'Person 1: first name must be text.',
    'Person 1: Paddle Scotland / JustGo membership number must be text.'
  ]);
  assert.deepEqual(personInputErrors([{ address: 'a'.repeat(301) }]), ['Person 1: address must be 300 characters or fewer.']);
});

test('Paddle Scotland numbers accept the known range without requiring seven digits', () => {
  assert.equal(normaliseAffiliationNumber('1'), '1');
  assert.equal(normaliseAffiliationNumber('123'), '123');
  assert.equal(normaliseAffiliationNumber('999999'), '999999');
  assert.equal(normaliseAffiliationNumber(''), '');
  assert.equal(normaliseAffiliationNumber('0'), null);
  assert.equal(normaliseAffiliationNumber('1000000'), null);
  assert.equal(normaliseAffiliationNumber('12A'), null);
});
