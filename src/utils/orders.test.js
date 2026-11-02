import test from 'node:test';
import assert from 'node:assert/strict';
import { toPence, toPounds, newOrderGroups, orderPersonReference, resolvedOrderPerson, orderVersion2, UNRESOLVED_PERSON_NAME } from './orders.js';
import { planUpgrade, ORDER_MIGRATIONS, CURRENT_ORDER_VERSION } from './schema.js';

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

const at = (value) => ({ value });

test('a paid version 1 order converts to pence, one receipt token, grouped fields and person references', () => {
  const legacy = {
    email: 'old@example.test', status: 'paid', total: '45.5', discountCodeId: 'SPRING', accessTokenHash: 'emailed', receiptViewTokenHash: 'viewed',
    stripeSessionId: 'cs_1', stripeMode: 'test', stripePaymentIntentId: 'pi_1', paymentProcessing: false, processingSince: at(1), reconciledAt: at(2),
    recordsWritten: true, emailSent: true, emailSentAt: at(3), emailSendingUntil: null, receipt: { name: 'Ann' }, membershipIds: ['M0'],
    items: [{ lineId: 'l1', price: 30, refunds: [{ id: 're_1', amount: 500, status: 'succeeded' }] },
      { lineId: 'l2', price: '25.25', monthlyAmount: 20, tripDiscount: 5 }],
    people: [checkoutPerson, { id: 'p2', lineIds: ['l2'], firstName: 'Guest', lastName: 'Only', email: 'guest@example.test' }]
  };
  const plan = planUpgrade(legacy, ORDER_MIGRATIONS);
  assert.equal(plan.to, CURRENT_ORDER_VERSION);
  assert.equal(plan.set.schemaVersion, 2);
  assert.equal(plan.set.totalPence, 4550);
  assert.equal(plan.set.discountPence, 975, 'the discount is what the lines came to above the total paid');
  assert.equal(plan.set.subtotalPence, 5525);
  assert.equal(plan.set.discountCode, 'SPRING');
  assert.equal(plan.set.receiptTokenHash, 'emailed', 'the emailed link keeps working');
  assert.deepEqual(plan.set.items, [
    { lineId: 'l1', pricePence: 3000, refunds: [{ id: 're_1', amountPence: 500, status: 'succeeded' }] },
    { lineId: 'l2', pricePence: 2525, monthlyPence: 2000, tripDiscountPence: 500 }
  ]);
  assert.deepEqual(plan.set.stripe, { sessionId: 'cs_1', mode: 'test', paymentIntentId: 'pi_1', setupIntentId: '', processing: false,
    processingSince: at(1), reconciledAt: at(2) });
  assert.deepEqual(plan.set.fulfilment, { recordsWritten: true, emailSent: true, emailSentAt: at(3), emailSendingUntil: null });
  assert.equal(plan.set.paymentFailure, null);
  assert.deepEqual(plan.set.people, [orderPersonReference(checkoutPerson), { id: 'p2', lineIds: ['l2'], firstName: 'Guest', lastName: 'Only' }],
    'people without a member record keep only their name');
  assert.deepEqual(plan.set.membershipIds, ['M0', 'M1']);
  assert.deepEqual(plan.remove.sort(), ['accessTokenHash', 'discountCodeId', 'emailSendingUntil', 'emailSent', 'emailSentAt', 'paymentProcessing', 'processingSince',
    'receipt', 'receiptViewTokenHash', 'reconciledAt', 'recordsWritten', 'stripeMode', 'stripePaymentIntentId', 'stripeSessionId', 'total'].sort());
  const upgraded = { ...legacy, ...plan.set };
  plan.remove.forEach((key) => delete upgraded[key]);
  assert.equal(planUpgrade(upgraded, ORDER_MIGRATIONS), null, 'a converted order needs nothing more');
});

test('pending and failed version 1 orders keep their checkout people and group their failure', () => {
  const pending = planUpgrade({ status: 'pending', total: '10', stripeSessionId: 'cs_2', receiptViewTokenHash: 'view', people: [checkoutPerson],
    items: [{ lineId: 'l1', price: 10 }] }, ORDER_MIGRATIONS);
  assert.equal(pending.set.people, undefined, 'unfulfilled orders still need everyone’s details');
  assert.equal(pending.set.receiptTokenHash, 'view');
  assert.deepEqual([pending.set.totalPence, pending.set.discountPence, pending.set.discountCode], [1000, 0, '']);
  const failed = planUpgrade({ status: 'pending', total: '10', lastPaymentFailureAt: at(4), lastPaymentFailureCode: 'card_declined',
    lastPaymentFailureDeclineCode: 'insufficient_funds', items: [] }, ORDER_MIGRATIONS);
  assert.deepEqual(failed.set.paymentFailure, { at: at(4), code: 'card_declined', declineCode: 'insufficient_funds', message: '' });
  const aborted = planUpgrade({ status: 'failed', total: '0', failedAt: at(5), failure: 'Stripe down' }, ORDER_MIGRATIONS);
  assert.deepEqual(aborted.set.paymentFailure, { at: at(5), code: '', declineCode: '', message: 'Stripe down' });
  assert.deepEqual(aborted.remove.sort(), ['failedAt', 'failure', 'total']);
});

test('the version 2 step leaves values that are already in the new shape', () => {
  const change = orderVersion2({ totalPence: 500, subtotalPence: 700, discountPence: 200, discountCode: 'X', items: [{ lineId: 'a', pricePence: 500 }] });
  assert.deepEqual([change.set.totalPence, change.set.subtotalPence, change.set.discountPence, change.set.discountCode], [500, 700, 200, 'X']);
  assert.deepEqual(change.set.items, [{ lineId: 'a', pricePence: 500 }]);
  assert.deepEqual(change.remove, []);
});
