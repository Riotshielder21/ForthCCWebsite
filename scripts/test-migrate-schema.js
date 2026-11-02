// Runs scripts/migrate-schema.js against old-shape records in the Firestore emulator: dry run, apply, then a repeat run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { clubYearDates } from '../src/utils/clubYear.js';
import { CURRENT_MEMBERSHIP_VERSION, CURRENT_ORDER_VERSION } from '../src/utils/schema.js';
import { PRODUCTS } from '../src/constants/products.js';

const PROJECT = 'demo-fcc-migration-tests';
assertLocalFirebase({ ...process.env, GCLOUD_PROJECT: PROJECT });
const db = getFirestore(initializeApp({ projectId: PROJECT }, 'migration-tests'));
const LEGACY_AUDITS = ['adminSubscriptionAudit', 'adminItemAudit', 'adminDeletionAudit', 'adminAccessAudit'];
const COLLECTIONS = ['memberships', 'households', 'orders', 'membershipTerms', 'counters', 'customers', 'discountCodes', 'products',
  'stripeSubscriptions', 'stripeCustomers', 'auditLog', ...LEGACY_AUDITS];

const clear = async () => {
  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
};

const migrate = async (...args) => {
  const env = { ...process.env, GCLOUD_PROJECT: PROJECT };
  delete env.STRIPE_SECRET_KEY;
  const child = spawn(process.execPath, ['scripts/migrate-schema.js', ...args], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, output);
  return output;
};

const at = (iso) => Timestamp.fromDate(new Date(iso));
const household = { contactName: 'Old Shape', contactRelationship: 'Self', email: 'old@example.test', phone: '1', address: '1 Old Road', postcode: 'EH1 1AA' };

await clear();
try {
  await db.collection('households').doc('H-OLD').set(household);
  await db.collection('orders').doc('OLD-1').set({
    status: 'paid', email: 'old@example.test', paidAt: at('2025-04-01T10:00:00Z'), total: '230',
    people: [{ id: 'p1', membershipId: 'OLD-M1', lineIds: ['m1', 'b1'] }],
    items: [{ lineId: 'm1', id: 'membership-adult', name: 'Adult membership', category: 'MEMBERSHIP', membershipTier: 'adult', price: 80 },
      { lineId: 'b1', id: 'boat-hire', name: 'Boat hire', category: 'SERVICES', type: 'yearly-service', price: 150 }]
  });
  await db.collection('orders').doc('OLD-2').set({
    status: 'paid', email: 'old@example.test', paidAt: at('2026-03-05T10:00:00Z'), total: '0', stripeSubscriptionId: 'sub_old', stripeMode: 'test',
    people: [{ id: 'p1', membershipId: 'OLD-M1', lineIds: ['m2', 'k1'] }],
    items: [{ lineId: 'm2', id: 'membership-adult', name: 'Adult membership', category: 'MEMBERSHIP', type: 'subscription', membershipTier: 'adult', clubYear: 2026, monthly: true, price: 0 },
      { lineId: 'k1', id: 'keyhire', name: 'Key hire', category: 'SERVICES', type: 'yearly-service', clubYear: 2026, price: 10 }]
  });
  await db.collection('memberships').doc('OLD-M1').set({
    schemaVersion: 3, householdId: 'H-OLD', firstName: 'Old', lastName: 'Shape', dob: '1980-01-01', source: 'website', membershipTier: 'adult',
    status: 'active', clubYears: [2025, 2026], validUntil: Timestamp.fromDate(clubYearDates(2026).end),
    privileges: [
      { productId: 'boat-hire', name: 'Boat hire', type: 'yearly-service', orderRef: 'OLD-1', lineId: 'b1', grantedAt: at('2025-04-01T10:00:00Z') },
      { productId: 'keyhire', name: 'Key hire', type: 'yearly-service', orderRef: 'OLD-2', lineId: 'k1', clubYear: 2026, grantedAt: at('2026-03-05T10:00:00Z') }
    ],
    history: [
      { orderRef: 'OLD-1', paidAt: at('2025-04-01T10:00:00Z'), items: [{ id: 'membership-adult' }, { id: 'boat-hire' }] },
      { orderRef: 'OLD-2', paidAt: at('2026-03-05T10:00:00Z'), items: [{ id: 'membership-adult' }, { id: 'keyhire' }] }
    ]
  });
  // Version 1 orders: recorded and emailed, still awaiting payment, and with a declined card.
  await db.collection('orders').doc('OLD-3').set({
    status: 'paid', email: 'old@example.test', paidAt: at('2026-04-02T10:00:00Z'), total: '27.5', discountCodeId: 'SPRING',
    accessTokenHash: 'emailed-hash', receiptViewTokenHash: 'success-hash', receipt: { people: [{ firstName: 'Old' }] },
    stripeSessionId: 'cs_old_3', stripeMode: 'test', stripePaymentIntentId: 'pi_old_3', reconciledAt: at('2026-04-02T10:01:00Z'),
    recordsWritten: true, emailSent: true, emailSentAt: at('2026-04-02T10:02:00Z'), membershipIds: ['OLD-M1'],
    people: [{ id: 'p1', membershipId: 'OLD-M1', householdId: 'H-OLD', lineIds: ['t1'], firstName: 'Old', lastName: 'Shape', dob: '1980-01-01',
      email: 'old@example.test', phone: '1', medical: 'None', emergencyName: 'Someone', existingMember: true },
    { id: 'p2', lineIds: ['t2'], firstName: 'Guest', lastName: 'Paddler', email: 'guest@example.test', dob: '1990-01-01' }],
    items: [{ lineId: 't1', id: 'trip', name: 'Trip', category: 'EVENTS', price: 20, tripDiscount: 5 },
      { lineId: 't2', id: 'trip', name: 'Trip', category: 'EVENTS', price: 12.5, refunds: [{ id: 're_old', amount: 1250, status: 'succeeded' }] }]
  });
  await db.collection('orders').doc('OLD-PENDING').set({
    status: 'pending', email: 'new@example.test', total: '40', receiptViewTokenHash: 'pending-hash', stripeSessionId: 'cs_old_pending',
    paymentProcessing: true, processingSince: at('2026-04-03T10:00:00Z'),
    people: [{ id: 'p1', lineIds: ['m1'], firstName: 'New', lastName: 'Joiner', dob: '1995-05-05', email: 'new@example.test' }],
    items: [{ lineId: 'm1', id: 'membership-adult', name: 'Adult membership', category: 'MEMBERSHIP', price: 40 }]
  });
  await db.collection('orders').doc('OLD-FAILED').set({
    status: 'pending', email: 'declined@example.test', total: '15', stripeSessionId: 'cs_old_failed', receiptViewTokenHash: 'failed-hash',
    lastPaymentFailureAt: at('2026-04-04T10:00:00Z'), lastPaymentFailureCode: 'card_declined', lastPaymentFailureDeclineCode: 'insufficient_funds',
    people: [{ id: 'p1', lineIds: ['k1'], firstName: 'Declined', lastName: 'Card' }],
    items: [{ lineId: 'k1', id: 'keyhire', name: 'Key hire', category: 'SERVICES', price: 15 }]
  });
  // A record already on the current version is left alone.
  await db.collection('memberships').doc('NEW-M2').set({ schemaVersion: CURRENT_MEMBERSHIP_VERSION, householdId: 'H-OLD', firstName: 'New', lastName: 'Shape',
    dob: '1982-02-02', source: 'website', status: 'active' });


  // Other collections in their old shapes.
  await db.collection('customers').doc('old@example.test').set({ email: 'old@example.test', membershipIds: ['OLD-M1'], vouchers: ['VOUCH'] });
  await db.collection('discountCodes').doc('OLD10').set({ code: 'OLD10', label: 'Ten', discountType: 'multiplier', discountValue: 0.1, active: true, used: false });
  await db.collection('discountCodes').doc('OLDOFF').set({ code: 'OLDOFF', label: 'Off', discountType: 'flat', discountValue: 5, active: false });
  await db.collection('discountCodes').doc('VOUCH').set({ code: 'VOUCH', label: 'Gift', discountType: 'credit', discountValue: 30, active: true, used: true,
    singleUse: true, orderRef: 'OLD-1', email: 'old@example.test', voucherProductId: 'vouchers', usedByOrder: 'OLD-3' });
  const current = { code: 'NEW20', label: 'New', type: 'multiplier', discountValue: 0.2, status: 'active' };
  await db.collection('discountCodes').doc('NEW20').set(current);
  await db.collection('products').doc('boat-hire').set({ deleted: true });
  await db.collection('products').doc('custom-b').set({ name: 'Monthly thing', category: 'SUBSCRIPTIONS', type: 'subscription', basePrice: 5, hidden: true });
  await db.collection('products').doc('custom-a').set({ name: 'Locker', category: 'SERVICES', type: 'yearly-service', basePrice: 20, deleted: false });
  await db.collection('stripeSubscriptions').doc('FCC-test-sub_old').set({ id: 'sub_old', clubSubscriptionId: 'FCC-test-sub_old',
    clubCustomerId: 'FCC-test-cus_old', stripeCustomerId: 'cus_old', name: 'Old Shape', email: 'old@example.test', status: 'Active' });
  await db.collection('stripeCustomers').doc('FCC-test-cus_old').set({ clubCustomerId: 'FCC-test-cus_old', stripeCustomerId: 'cus_old',
    name: 'Old Shape', email: 'old@example.test' });
  await db.collection('adminSubscriptionAudit').doc('a1').set({ action: 'cancel-items', reason: 'Moved away', adminUid: 'u1', adminEmail: 'staff@example.test',
    at: at('2026-04-05T10:00:00Z'), orderRef: 'OLD-2', stripeSubscriptionId: 'sub_old' });
  await db.collection('adminItemAudit').doc('op1').set({ action: 'revoke', status: 'completed', reason: 'Refunded in person', adminEmail: 'staff@example.test',
    adminUid: 'u1', createdAt: at('2026-04-06T10:00:00Z'), orderRef: 'OLD-3', lineId: 't1' });
  await db.collection('adminDeletionAudit').doc('d1').set({ kind: 'orders', recordId: 'GONE-1', adminUid: 'u1', at: at('2026-04-07T10:00:00Z'), lookupKeys: ['email:gone@example.test'] });
  await db.collection('adminDeletionAudit').doc('d2').set({ kind: 'gdpr-erasure', adminUid: 'u1', at: at('2026-04-08T10:00:00Z'), erased: 1 });
  await db.collection('adminAccessAudit').doc('g1').set({ action: 'grant', email: 'helper@example.test', adminEmail: 'staff@example.test', at: '2026-04-09T10:00:00.000Z' });

  const dry = await migrate();
  assert.match(dry, /member records read, 1 would be upgraded/);
  assert.match(dry, /5 orders read, 5 would be upgraded/);
  assert.match(dry, /Write membershipTerms documents/);
  assert.equal((await db.collection('membershipTerms').get()).size, 0, 'a dry run writes nothing');
  assert.ok((await db.collection('memberships').doc('OLD-M1').get()).data().privileges, 'a dry run keeps the old fields');
  const untouched = (await db.collection('orders').doc('OLD-3').get()).data();
  assert.ok(untouched.accessTokenHash && untouched.receipt && untouched.people[0].dob && !('schemaVersion' in untouched), 'a dry run leaves orders alone');
  assert.match(dry, /Customer records \(removed\): 1 read, 1 changes would be made/);
  assert.match(dry, /Discount codes: 4 read, 3 changes would be made/);
  assert.match(dry, /Products: 3 read, 3 changes would be made/);
  assert.match(dry, /Stripe mirror: 2 read, 2 changes would be made/);
  assert.match(dry, /Audit log: 5 read, 5 changes would be made/);
  assert.equal((await db.collection('customers').get()).size, 1, 'a dry run deletes no customers');
  assert.equal((await db.collection('discountCodes').doc('OLD10').get()).data().discountType, 'multiplier', 'a dry run leaves discount codes alone');
  assert.equal((await db.collection('products').doc('boat-hire').get()).data().deleted, true, 'a dry run leaves products alone');
  assert.equal((await db.collection('stripeCustomers').doc('FCC-test-cus_old').get()).data().email, 'old@example.test', 'a dry run leaves the mirror alone');
  assert.equal((await db.collection('auditLog').get()).size, 0, 'a dry run writes no audit entries');
  for (const name of LEGACY_AUDITS) assert.ok((await db.collection(name).get()).size, `a dry run keeps ${name}`);

  await migrate('--apply');
  const member = (await db.collection('memberships').doc('OLD-M1').get()).data();
  assert.equal(member.schemaVersion, CURRENT_MEMBERSHIP_VERSION);
  assert.equal('privileges' in member, false);
  assert.equal('history' in member, false);
  assert.equal(member.stripeMembershipSubscriptionId, 'sub_old', 'the recurring membership subscription is recorded from the old order');
  assert.equal(member.keyAccess.source, 'purchase', 'key hire bought before key access was tracked still grants the code');
  assert.equal(member.status, 'active');
  assert.equal(member.validUntil.toMillis(), clubYearDates(2026).end.getTime(), 'the current term stays on the member');

  const terms = new Map((await db.collection('membershipTerms').get()).docs.map((document) => [document.id, document.data()]));
  assert.deepEqual([...terms.keys()].sort(), ['OLD-M1_2025', 'OLD-M1_2026']);
  const first = terms.get('OLD-M1_2025');
  assert.deepEqual([first.membershipId, first.clubYear, first.tier, first.source, first.orderRef], ['OLD-M1', 2025, 'adult', 'website', 'OLD-1']);
  assert.equal(first.start.toMillis(), new Date('2025-04-01T10:00:00Z').getTime());
  assert.equal(first.end.toMillis(), clubYearDates(2025).end.getTime());
  assert.deepEqual(first.items.map((item) => item.productId), ['boat-hire']);
  const second = terms.get('OLD-M1_2026');
  assert.equal(second.orderRef, 'OLD-2');
  assert.deepEqual(second.items.map((item) => [item.productId, item.lineId]), [['keyhire', 'k1']]);
  for (const ref of ['OLD-1', 'OLD-2']) {
    assert.deepEqual((await db.collection('orders').doc(ref).get()).data().membershipIds, ['OLD-M1'], `${ref} names its member`);
  }
  assert.equal((await db.collection('memberships').doc('NEW-M2').get()).data().schemaVersion, CURRENT_MEMBERSHIP_VERSION);

  const orders = new Map((await db.collection('orders').get()).docs.map((document) => [document.id, document.data()]));
  for (const [ref, order] of orders) assert.equal(order.schemaVersion, CURRENT_ORDER_VERSION, `${ref} is upgraded`);
  assert.deepEqual([orders.get('OLD-1').totalPence, orders.get('OLD-1').items.map((item) => item.pricePence)], [23000, [8000, 15000]]);
  const paid = orders.get('OLD-3');
  const removed = ['total', 'discountCodeId', 'accessTokenHash', 'receiptViewTokenHash', 'receipt', 'stripeSessionId', 'stripeMode', 'stripePaymentIntentId',
    'reconciledAt', 'recordsWritten', 'emailSent', 'emailSentAt'];
  for (const key of removed) assert.equal(key in paid, false, `${key} is removed`);
  assert.deepEqual([paid.totalPence, paid.subtotalPence, paid.discountPence, paid.discountCode], [2750, 3250, 500, 'SPRING']);
  assert.equal(paid.receiptTokenHash, 'emailed-hash', 'links already emailed keep working');
  assert.deepEqual(paid.items.map((item) => [item.pricePence, item.tripDiscountPence ?? null, item.refunds?.[0]?.amountPence ?? null]),
    [[2000, 500, null], [1250, null, 1250]]);
  assert.equal('price' in paid.items[0] || 'amount' in paid.items[1].refunds[0], false);
  assert.deepEqual([paid.stripe.sessionId, paid.stripe.mode, paid.stripe.paymentIntentId, paid.stripe.processing], ['cs_old_3', 'test', 'pi_old_3', false]);
  assert.equal(paid.stripe.reconciledAt.toMillis(), new Date('2026-04-02T10:01:00Z').getTime());
  assert.deepEqual([paid.fulfilment.recordsWritten, paid.fulfilment.emailSent], [true, true]);
  assert.equal(paid.fulfilment.emailSentAt.toMillis(), new Date('2026-04-02T10:02:00Z').getTime());
  assert.equal(paid.paymentFailure, null);
  assert.deepEqual(paid.people, [{ id: 'p1', membershipId: 'OLD-M1', householdId: 'H-OLD', lineIds: ['t1'], existingMember: true },
    { id: 'p2', lineIds: ['t2'], firstName: 'Guest', lastName: 'Paddler' }], 'recorded people become references; guests keep only their name');
  const pendingOrder = orders.get('OLD-PENDING');
  assert.deepEqual([pendingOrder.totalPence, pendingOrder.receiptTokenHash, pendingOrder.stripe.sessionId, pendingOrder.stripe.processing],
    [4000, 'pending-hash', 'cs_old_pending', true]);
  assert.equal(pendingOrder.people[0].dob, '1995-05-05', 'an unpaid order keeps the details needed to fulfil it');
  assert.equal('paymentProcessing' in pendingOrder || 'processingSince' in pendingOrder, false);
  const failedOrder = orders.get('OLD-FAILED');
  assert.deepEqual([failedOrder.paymentFailure.code, failedOrder.paymentFailure.declineCode], ['card_declined', 'insufficient_funds']);
  assert.equal(failedOrder.paymentFailure.at.toMillis(), new Date('2026-04-04T10:00:00Z').getTime());
  assert.equal(Object.keys(failedOrder).some((key) => key.startsWith('lastPaymentFailure')), false);


  assert.equal((await db.collection('customers').get()).size, 0, 'the customers collection is removed');
  const codes = new Map((await db.collection('discountCodes').get()).docs.map((document) => [document.id, document.data()]));
  assert.deepEqual(codes.get('OLD10'), { code: 'OLD10', label: 'Ten', type: 'multiplier', discountValue: 0.1, status: 'active' });
  assert.deepEqual(codes.get('OLDOFF'), { code: 'OLDOFF', label: 'Off', type: 'flat', discountValue: 5, status: 'disabled' });
  assert.deepEqual(codes.get('VOUCH'), { code: 'VOUCH', label: 'Gift', type: 'credit', discountValue: 30, status: 'used', singleUse: true,
    orderRef: 'OLD-1', email: 'old@example.test', sourceProductId: 'vouchers', usedByOrder: 'OLD-3' });
  assert.deepEqual(codes.get('NEW20'), current, 'a code already in the current shape is unchanged');

  const products = new Map((await db.collection('products').get()).docs.map((document) => [document.id, document.data()]));
  const boatHireOrder = (PRODUCTS.findIndex((product) => product.id === 'boat-hire') + 1) * 10;
  assert.deepEqual(products.get('boat-hire'), { active: false, sortOrder: boatHireOrder }, 'a removed starter product keeps the starter terms');
  assert.deepEqual(products.get('custom-a'), { name: 'Locker', category: 'SERVICES', type: 'yearly-service', basePrice: 20, active: true,
    sortOrder: (PRODUCTS.length + 1) * 10, pricingMode: 'prorated', allowMonthly: false });
  assert.deepEqual(products.get('custom-b'), { name: 'Monthly thing', category: 'SUBSCRIPTIONS', type: 'subscription', basePrice: 5, active: false,
    sortOrder: (PRODUCTS.length + 2) * 10, pricingMode: 'subscription', allowMonthly: true }, 'saved-only products follow in id order');

  const mirroredSubscription = (await db.collection('stripeSubscriptions').doc('FCC-test-sub_old').get()).data();
  const mirroredCustomer = (await db.collection('stripeCustomers').doc('FCC-test-cus_old').get()).data();
  for (const mirrored of [mirroredSubscription, mirroredCustomer]) {
    assert.deepEqual(mirrored.membershipIds, ['OLD-M1'], 'the mirror names the members the payer\'s orders cover');
    assert.equal('name' in mirrored || 'email' in mirrored, false, 'names and emails are no longer copied');
  }

  for (const name of LEGACY_AUDITS) assert.equal((await db.collection(name).get()).size, 0, `${name} is emptied`);
  const audit = new Map((await db.collection('auditLog').get()).docs.map((document) => [document.id, document.data()]));
  assert.deepEqual([...audit.keys()].sort(), ['access_g1', 'deletion_d1', 'deletion_d2', 'item_op1', 'subscription_a1']);
  const subscriptionEntry = audit.get('subscription_a1');
  assert.deepEqual([subscriptionEntry.kind, subscriptionEntry.action, subscriptionEntry.reason, subscriptionEntry.by, subscriptionEntry.byUid, subscriptionEntry.orderRef],
    ['subscription', 'cancel-items', 'Moved away', 'staff@example.test', 'u1', 'OLD-2']);
  assert.equal(subscriptionEntry.at.toMillis(), new Date('2026-04-05T10:00:00Z').getTime());
  const itemEntry = audit.get('item_op1');
  assert.deepEqual([itemEntry.kind, itemEntry.action, itemEntry.reason, itemEntry.status, itemEntry.lineId], ['item', 'revoke', 'Refunded in person', 'completed', 't1']);
  assert.equal(itemEntry.at.toMillis(), new Date('2026-04-06T10:00:00Z').getTime(), 'createdAt becomes at');
  const deletion = audit.get('deletion_d1');
  assert.deepEqual([deletion.kind, deletion.action, deletion.recordKind, deletion.reason, deletion.by, deletion.lookupKeys],
    ['deletion', 'delete-record', 'orders', 'Recorded before reasons were required', 'u1', ['email:gone@example.test']]);
  assert.deepEqual([audit.get('deletion_d2').action, audit.get('deletion_d2').erased], ['gdpr-erasure', 1]);
  const access = audit.get('access_g1');
  assert.deepEqual([access.kind, access.action, access.reason, access.email, access.by], ['access', 'grant-admin', 'Granted admin access', 'helper@example.test', 'staff@example.test']);
  assert.equal(access.at.toMillis(), new Date('2026-04-09T10:00:00Z').getTime(), 'ISO dates become timestamps');

  const repeat = await migrate('--apply');
  assert.match(repeat, /member records read, 0 upgraded/, 'a repeat run finds nothing to do');
  assert.match(repeat, /5 orders read, 0 upgraded/, 'a repeat run upgrades no orders');
  assert.equal((await db.collection('membershipTerms').doc('OLD-M1_2025').get()).data().items.length, 1, 'no duplicate entitlements');
  for (const pass of ['Customer records \\(removed\\): 0', 'Discount codes: 4', 'Products: 3', 'Stripe mirror: 2', 'Audit log: 0']) {
    assert.match(repeat, new RegExp(`${pass} read, 0 changes made`), `a repeat run changes nothing (${pass})`);
  }
  assert.equal((await db.collection('auditLog').get()).size, 5, 'a repeat run duplicates no audit entries');
  console.log('PASS: schema migration converts old-shape members to membership terms, links orders, upgrades orders, removes customers, converts discount codes, products, the Stripe mirror and audits, and is safe to repeat.');
} finally {
  await clear();
}
