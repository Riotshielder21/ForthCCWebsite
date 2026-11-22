import test from 'node:test';
import assert from 'node:assert/strict';
import { toPence, toPounds, newOrderGroups, orderPersonReference, resolvedOrderPerson, UNRESOLVED_PERSON_NAME } from './orders.js';

test('order money converts between pounds and whole pence without float drift', () => {
  assert.equal(toPence(19.99), 1999);
  assert.equal(toPence('0.1'), 10);
  assert.equal(toPence(0.1 + 0.2), 30);
  assert.equal(toPence(undefined), 0);
  assert.equal(toPounds(1999), 19.99);
  assert.equal(toPounds(undefined), 0);
});

test('new orders start with empty Stripe, fulfilment and payment-failure groups', () => {
  const groups = newOrderGroups('cs_free_1');
  assert.equal(groups.stripe.sessionId, 'cs_free_1');
  assert.equal(groups.stripe.processing, false);
  assert.deepEqual(groups.fulfilment, { recordsWritten: false, emailSent: false, emailSentAt: null, emailSendingUntil: null });
  assert.equal(groups.paymentFailure, null);
});

const checkoutPerson = {
  id: 'p1', membershipId: 'M1', householdId: 'H1', lineIds: ['l1'], firstName: 'Ann', lastName: 'Lee', dob: '1990-01-02',
  email: 'ann@example.test', phone: '07700 900000', medical: 'Asthma', emergencyContact: { name: 'Bo', phone: '1' },
  guardian: { name: 'X' }, existingMember: true, grantMembershipYears: [2026], ownKitLineIds: ['l1'], subscriptionGroup: 'g'
};

test('a recorded order keeps only non-personal references to its people', () => {
  const reference = orderPersonReference(checkoutPerson);
  assert.deepEqual(reference, { id: 'p1', membershipId: 'M1', householdId: 'H1', lineIds: ['l1'], existingMember: true,
    grantMembershipYears: [2026], ownKitLineIds: ['l1'] });
  for (const key of ['firstName', 'lastName', 'dob', 'email', 'phone', 'medical', 'emergencyContact', 'guardian']) assert.equal(key in reference, false, key);
});

test('order people resolve from member and household records, with a placeholder when the record is gone', () => {
  const reference = orderPersonReference(checkoutPerson);
  const adult = resolvedOrderPerson(reference, { firstName: 'Ann', lastName: 'Lee', dob: '1990-01-02' }, { email: 'Home@Example.test' });
  assert.deepEqual([adult.firstName, adult.lastName, adult.dob, adult.email, adult.junior], ['Ann', 'Lee', '1990-01-02', 'home@example.test', false]);
  const junior = resolvedOrderPerson({ membershipId: 'M2', lineIds: [], junior: true }, { firstName: 'Kit', lastName: 'Lee', dob: '2015-05-05' },
    { email: 'parent@example.test', contactName: 'Pat Lee', contactRelationship: 'Parent' });
  assert.deepEqual(junior.guardian, { name: 'Pat Lee', relationship: 'Parent', email: 'parent@example.test' });
  assert.equal(junior.email, undefined);
  assert.deepEqual([resolvedOrderPerson(reference, null).firstName, resolvedOrderPerson(reference, null).lastName], [UNRESOLVED_PERSON_NAME, '']);
  assert.equal(resolvedOrderPerson({ ...reference, erased: true }, { firstName: 'Ann' }).firstName, UNRESOLVED_PERSON_NAME, 'erased people are never re-identified');
  assert.equal(resolvedOrderPerson(checkoutPerson, { firstName: 'Other' }), checkoutPerson, 'unrecorded checkout people are shown as entered');
});
