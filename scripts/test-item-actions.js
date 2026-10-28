import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { registerItemActionRoutes } from '../src/server/itemActions.js';
import { registerKeyAccessRoutes } from '../src/server/keyAccess.js';
import { registerBoathouseRoutes } from '../src/server/boathouse.js';

const projectId = 'demo-fcc-item-action-tests';
assertLocalFirebase({ ...process.env, GCLOUD_PROJECT: projectId });
const firebase = initializeApp({ projectId }, 'item-action-tests');
const db = getFirestore(firebase);
const app = express();
app.use(express.json());
const requireAdmin = async (req, res) => {
  if (req.headers.authorization !== 'Bearer local-item-test') {
    res.status(401).json({ error: 'Admin required.' }); return null;
  }
  return { uid: 'admin', email: 'admin@forthcanoeclub.co.uk' };
};
const remoteRefunds = [];
const charges = new Map();
let ambiguous = false;
let rejectRefund = false;
let rejectLookup = false;
let refundCalls = 0;
const stopped = [];
const invoice = { id: 'in_test', number: 'TEST', amount_paid: 2000, lines: { data: [
  { amount: 1200, subscription_item: 'si_target' }, { amount: 800, subscription_item: 'si_other' }
]} };
const stripeRequest = async (path, params, method = 'POST') => {
  const url = new URL(`https://stripe.invalid/${path}`);
  const form = new URLSearchParams(params || []);
  if (url.pathname === '/invoices') return { data: [invoice], has_more: false };
  if (url.pathname === '/invoice_payments') return { data: [{ payment: { payment_intent: 'pi_invoice' } }], has_more: false };
  if (url.pathname.startsWith('/payment_intents/')) return { latest_charge: charges.get(url.pathname.split('/')[2]) };
  if (url.pathname === '/refunds' && method === 'GET') {
    if (rejectLookup) throw Object.assign(new Error('Simulated refund lookup refusal'), { stripeStatus: 403 });
    return { data: remoteRefunds.filter((refund) => refund.payment_intent === url.searchParams.get('payment_intent')), has_more: false };
  }
  if (url.pathname.startsWith('/refunds/')) return remoteRefunds.find((refund) => refund.id === url.pathname.split('/')[2]);
  if (url.pathname === '/refunds' && method === 'POST') {
    if (rejectRefund) throw Object.assign(new Error('Simulated definite refund rejection'), { stripeStatus: 400 });
    refundCalls += 1;
    const refund = { id: `re_${refundCalls}`, status: 'pending', amount: Number(form.get('amount')),
      payment_intent: form.get('payment_intent'), metadata: { operation_id: form.get('metadata[operation_id]') } };
    remoteRefunds.push(refund);
    charges.get(refund.payment_intent).amount_refunded += refund.amount;
    if (ambiguous) { ambiguous = false; throw new Error('Simulated connection loss after Stripe accepted refund'); }
    return refund;
  }
  throw new Error(`Unexpected Stripe request: ${method} ${path}`);
};
const emails = [];
let failEmail = false;
const keyAccess = registerKeyAccessRoutes(app, { requireAdmin, db: () => db,
  sendEmail: async (message) => { if (failEmail) return false; emails.push(message); return true; } });
registerBoathouseRoutes(app, { requireAdmin, db: () => db, onCodeChanged: keyAccess.notifyKeyAccess });
registerItemActionRoutes(app, { requireAdmin, db: () => db, stripeRequest,
  stopMonthlyItem: async (...args) => stopped.push(args) });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, method = 'GET', body, auth = true) => {
  const response = await fetch(`${base}${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer local-item-test' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
const created = new Set();
const put = async (path, data) => { created.add(path); await db.doc(path).set(data); return db.doc(path); };
const run = Date.now().toString(36);
const action = (reason = 'Test reason') => {
  const operationId = randomUUID();
  created.add(`adminItemAudit/${operationId}`);
  return { action: 'revoke', reason, operationId };
};
const refund = (amount, paymentIntent, revoke = false) => ({ ...action(), action: 'refund', amount, paymentIntent, revoke });
const order = async (suffix, items, people = [], extra = {}) => {
  const id = `TEST-${run}-${suffix}`;
  return put(`orders/${id}`, { status: 'paid', total: String(items.reduce((sum, item) => sum + item.price, 0)),
    items, people, paidAt: Timestamp.now(), ...extra });
};
const path = (reference, line = 'line') => `/api/admin/orders/${reference.id}/items/${line}`;
const charge = (intent, amount) => charges.set(intent, { amount, amount_refunded: 0, paid: true, currency: 'gbp' });
const checkMainServer = async () => {
  const auth = getAuth(firebase);
  const candidate = await auth.createUser({ email: `item-${run}@forthcanoeclub.co.uk`, emailVerified: true });
  const portProbe = createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const child = spawn(process.execPath, ['--import', './scripts/mock-stripe.mjs', 'server.js'], {
    env: { ...process.env, GCLOUD_PROJECT: projectId, PORT: String(port), HOST: '127.0.0.1',
      STRIPE_SECRET_KEY: 'sk_test_local_fixture', WEBSITE_ISLIVE: 'false' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Test API did not start: ${output}`)), 15000);
      child.stdout.on('data', () => {
        if (output.includes(`running at http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Test API exited ${code}: ${output}`)); });
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    const token = await auth.createCustomToken(candidate.uid, { admin: true });
    const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-fixture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ token, returnSecureToken: true, targetProjectId: projectId })
    });
    const session = await signIn.json();
    assert.equal(signIn.status, 200, session.error?.message);
    await auth.verifyIdToken(session.idToken, true);
    const headers = { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' };
    const holder = await put(`memberships/MONTHLY-${run}`, { source: 'website', privileges: [] });
    const purchase = await order('main-monthly', [{ id: 'boat-hire', lineId: 'line', category: 'SERVICES', monthly: true, price: 0 }],
      [{ membershipId: holder.id, lineIds: ['line'] }], { subscriptionPlan: { recordedAt: Timestamp.now() } });
    const subscription = await put(`subscriptions/sub_main_${run}`, { orderRef: 'another-order', orderRefs: [purchase.id],
      status: 'active', items: [{ lineId: 'line', orderRef: purchase.id, membershipIds: [holder.id], status: 'active' }] });
    await holder.update({ privileges: [{ productId: 'boat-hire', orderRef: purchase.id, lineId: 'line' }],
      subscriptionItems: [{ subscriptionId: subscription.id, orderRef: purchase.id, lineId: 'line', status: 'active' }] });
    const response = await fetch(`http://127.0.0.1:${port}${path(purchase)}/actions`, { method: 'POST', headers, body: JSON.stringify(action('Stop monthly hire')) });
    assert.equal(response.status, 200, await response.text());
    assert.equal((await subscription.get()).data().status, 'cancelled', 'the real route wiring stops the matching merged monthly subscription');
    assert.equal((await holder.get()).data().subscriptionItems[0].status, 'cancelled');
    assert.ok((await purchase.get()).data().items[0].monthlyCancelledAt);
    assert.ok((await purchase.get()).data().items[0].revokedAt);
    const audit = await db.collection('adminSubscriptionAudit').where('orderRefs', 'array-contains', purchase.id).get();
    for (const document of audit.docs) created.add(document.ref.path);
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].data().reason, 'Stop monthly hire');
    await purchase.update({ itemActionPending: { request: { operationId: randomUUID() } } });
    const deletion = await fetch(`http://127.0.0.1:${port}/api/admin/records/orders/${purchase.id}`, {
      method: 'DELETE', headers, body: JSON.stringify({ confirmId: purchase.id, acknowledgeStripe: true })
    });
    assert.equal(deletion.status, 409, 'unfinished item actions block order deletion');
    assert.equal((await purchase.get()).exists, true);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await auth.deleteUser(candidate.uid);
  }
};
try {
  const member = await put(`memberships/M-${run}`, { firstName: 'Key', lastName: 'Holder', email: 'key@example.test',
    privileges: [{ productId: 'keyhire', orderRef: `TEST-${run}-key`, lineId: 'line' }], history: [] });
  const keyOrder = await order('key', [{ id: 'keyhire', lineId: 'line', category: 'SERVICES', price: 10 }],
    [{ membershipId: member.id, lineIds: ['line'] }], { stripePaymentIntentId: 'pi_key' });
  charge('pi_key', 1000);
  assert.equal((await call(`${path(keyOrder)}/actions`, 'POST', action(), false)).status, 401);
  const settings = { gateCode: 'test-gate', alarmCode: 'test-alarm', lockboxCode: 'test-lockbox' };
  created.add('settings/boathouseCode');
  assert.equal((await call('/api/admin/boathouse-code', 'POST', settings)).status, 200);
  assert.equal(emails.length, 1, 'non-volunteer key holders receive codes');
  assert.match(emails[0].body, /Gate code: test-gate/);
  assert.match(emails[0].body, /Alarm code: test-alarm/);
  assert.match(emails[0].body, /Lockbox code: test-lockbox/);

  const partial = refund(300, 'pi_key');
  assert.equal((await call(`${path(keyOrder)}/actions`, 'POST', partial)).status, 200);
  const replay = await call(`${path(keyOrder)}/actions`, 'POST', partial);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.refundId, 're_1');
  assert.equal(refundCalls, 1, 'replaying the same action cannot issue another refund');
  remoteRefunds[0].status = 'succeeded';
  assert.equal((await call(`${path(keyOrder)}/payments`)).status, 200);
  assert.equal((await keyOrder.get()).data().items[0].refunds[0].status, 'succeeded', 'payment refresh persists the latest Stripe refund status');
  assert.equal((await member.get()).data().privileges[0].endedAt, undefined, 'refund-only preserves access');
  assert.equal((await call(`${path(keyOrder)}/actions`, 'POST', refund(701, 'pi_key'))).status, 400, 'line over-refund rejected');
  assert.equal((await call(`${path(keyOrder)}/actions`, 'POST', refund(700, 'pi_key', true))).status, 200);
  const revoked = (await member.get()).data();
  assert.ok(revoked.keyAccess.revokedAt);
  assert.ok(revoked.privileges[0].endedAt);
  assert.equal((await keyOrder.get()).data().total, '10', 'financial history is retained');
  assert.equal((await keyOrder.get()).data().items[0].refunds.length, 2);
  await call('/api/admin/boathouse-code', 'POST', { ...settings, alarmCode: 'changed' });
  assert.equal(emails.length, 1, 'revoked key holders do not receive changed codes');
  await member.update({ volunteer: { inducted: true } });
  assert.equal(await keyAccess.settleKeyAccess(member), 'not-active', 'induction cannot bypass admin revocation');

  const ambiguousOrder = await order('ambiguous', [{ id: 'shirt', lineId: 'line', category: 'MERCHANDISE', price: 15 }], [], { stripePaymentIntentId: 'pi_ambiguous' });
  charge('pi_ambiguous', 1500);
  ambiguous = true;
  const uncertain = refund(500, 'pi_ambiguous');
  assert.equal((await call(`${path(ambiguousOrder)}/actions`, 'POST', uncertain)).status, 502);
  const callsBeforeRetry = refundCalls;
  rejectLookup = true;
  assert.equal((await call(`${path(ambiguousOrder)}/actions`, 'POST', uncertain)).body.unfinished, true, 'lookup refusal cannot release an uncertain refund');
  assert.ok((await ambiguousOrder.get()).data().itemActionPending);
  rejectLookup = false;
  assert.equal((await call(`${path(ambiguousOrder)}/actions`, 'POST', refund(500, 'pi_ambiguous'))).status, 409);
  assert.equal((await call(`${path(ambiguousOrder)}/actions`, 'POST', uncertain)).status, 200);
  assert.equal(refundCalls, callsBeforeRetry, 'retry reconciles an accepted Stripe refund after lost response');
  assert.equal((await ambiguousOrder.get()).data().items[0].refunds.length, 1);
  assert.equal((await ambiguousOrder.get()).data().itemActionPending, null);

  const rejectedOrder = await order('rejected', [{ id: 'shirt', lineId: 'line', price: 10 }], [], { stripePaymentIntentId: 'pi_rejected' });
  charge('pi_rejected', 1000);
  rejectRefund = true;
  const rejectedAction = refund(500, 'pi_rejected');
  const rejection = await call(`${path(rejectedOrder)}/actions`, 'POST', rejectedAction);
  assert.equal(rejection.body.unfinished, false);
  assert.equal((await rejectedOrder.get()).data().itemActionPending, null);
  assert.equal((await db.doc(`adminItemAudit/${rejectedAction.operationId}`).get()).data().status, 'rejected');
  rejectRefund = false;
  assert.equal((await call(`${path(rejectedOrder)}/actions`, 'POST', refund(500, 'pi_rejected'))).status, 200);

  const eventOrder = await order('event', [
    { id: `event-${run}`, lineId: 'line', category: 'EVENTS', price: 20 },
    { id: `event-${run}`, lineId: 'other', category: 'EVENTS', price: 20 }
  ]);
  const stock = await put(`stock/event-${run}`, { holds: { [eventOrder.id]: { until: null, lines: { all: 2 } } } });
  assert.equal((await call(`${path(eventOrder)}/actions`, 'POST', action('Cannot attend'))).status, 200);
  assert.equal((await stock.get()).data().holds[eventOrder.id].lines.all, 1, 'only revoked ticket capacity is released');
  assert.equal((await eventOrder.get()).data().items[1].revokedAt, undefined);

  const voucherOrder = await order('voucher', [{ id: 'voucher', lineId: 'line', type: 'voucher', price: 60 }], [],
    { vouchers: [{ code: `V-${run}` }], stripePaymentIntentId: 'pi_voucher' });
  const voucher = await put(`discountCodes/V-${run}`, { used: true });
  charge('pi_voucher', 6000);
  assert.equal((await call(`${path(voucherOrder)}/actions`, 'POST', refund(6000, 'pi_voucher', true))).status, 409, 'used voucher cannot be revoked');
  await voucher.update({ used: false });
  assert.equal((await call(`${path(voucherOrder)}/actions`, 'POST', action())).status, 200);
  assert.equal((await voucher.get()).data().active, false);

  const monthly = await order('monthly', [{ id: 'coaching', lineId: 'line', category: 'SERVICES', price: 0, monthly: true }]);
  await monthly.update({ subscriptionPlan: { status: 'failed' } });
  assert.equal((await call(`${path(monthly)}/actions`, 'POST', action())).status, 409, 'unfinished subscription setup must not restart billing after revocation');
  await monthly.update({ subscriptionPlan: { status: 'active', recordedAt: Timestamp.now() } });
  await put(`subscriptions/sub_${run}`, { orderRef: 'another-order', orderRefs: [monthly.id], items: [
    { lineId: 'line', orderRef: monthly.id, stripeItemId: 'si_target' }
  ] });
  charge('pi_invoice', 2000);
  const available = await call(`${path(monthly)}/payments`);
  assert.equal(available.status, 200);
  assert.equal(available.body.payments[0].available, 1200, 'merged subscriptions allocate only this item invoice share');
  assert.equal((await call(`${path(monthly)}/actions`, 'POST', refund(1201, 'pi_invoice'))).status, 400);
  assert.equal((await call(`${path(monthly)}/actions`, 'POST', refund(1200, 'pi_invoice'))).status, 200);

  const membership = await put(`memberships/FAMILY-${run}`, { source: 'website', status: 'active', validUntil: Timestamp.fromDate(new Date('2099-03-01')),
    history: [], privileges: [] });
  const membershipOrder = await order('membership', [{ id: 'membership', category: 'MEMBERSHIP', lineId: 'line', clubYear: 2026, price: 30 }],
    [{ membershipId: membership.id, lineIds: ['line'] }]);
  assert.equal((await call(`${path(membershipOrder)}/actions`, 'POST', action())).status, 200);
  assert.equal((await membership.get()).data().status, 'revoked');
  assert.equal((await membershipOrder.get()).exists, true);
  assert.ok(stopped.length >= 4, 'revocations call the shared monthly cancellation service');

  const imported = await put(`memberships/IMPORTED-${run}`, { source: 'justgo', status: 'active', validUntil: Timestamp.fromDate(new Date('2099-03-01')) });
  const importedOrder = await order('imported', [{ id: 'membership', category: 'MEMBERSHIP', lineId: 'line', clubYear: 2026, price: 30 }],
    [{ membershipId: imported.id, lineIds: ['line'] }]);
  assert.equal((await call(`${path(importedOrder)}/actions`, 'POST', action())).status, 409, 'unreconstructable imported cover must be reconciled explicitly');
  await imported.update({ membershipBeforeWebsite: { validUntil: Timestamp.fromDate(new Date('2099-03-01')) } });
  assert.equal((await call(`${path(importedOrder)}/actions`, 'POST', action())).status, 200);
  assert.equal((await imported.get()).data().validUntil.toDate().getFullYear(), 2099, 'revocation preserves independent imported cover');

  failEmail = true;
  await member.update({ keyAccess: { grantedAt: Timestamp.now() } });
  const missed = await call('/api/admin/boathouse-code', 'POST', settings);
  assert.equal(missed.body.notified.failed, 1);
  failEmail = false;
  const retried = await call('/api/admin/boathouse-code', 'POST', settings);
  assert.equal(retried.body.changed, false);
  assert.equal(retried.body.notified.sent, 1, 'unchanged save retries unsuccessful code emails');
  await member.update({ 'keyAccess.sentVersion': 0 });
  const beforeConcurrent = emails.length;
  await Promise.all([keyAccess.settleKeyAccess(member), keyAccess.settleKeyAccess(member)]);
  assert.equal(emails.length, beforeConcurrent + 1, 'concurrent delivery attempts send a code version once');
  const memberPath = `/api/admin/memberships/${member.id}/key-access`;
  assert.equal((await call(memberPath, 'POST', { action: 'revoke', reason: '' })).status, 400);
  assert.equal((await call(memberPath, 'POST', { action: 'revoke', reason: 'Key returned' })).status, 200);
  assert.equal(await keyAccess.settleKeyAccess(member), 'not-active');
  assert.equal((await call(memberPath, 'POST', { action: 'grant', reason: 'New key issued' })).body.delivery, 'sent');
  assert.equal((await member.get()).data().keyAccess.revokedAt, null);
  const accessAudit = await db.collection('adminItemAudit').where('membershipId', '==', member.id).get();
  for (const document of accessAudit.docs) created.add(document.ref.path);
  assert.equal(accessAudit.size, 2, 'key grants and revocations retain reasons in the audit trail');
  await checkMainServer();
  console.log('Item action checks passed: key access, revocation override, refunds, pending refunds, retry reconciliation, vouchers, stock, membership and invoice allocation.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  for (const path of created) await db.doc(path).delete();
  await db.terminate();
  await deleteApp(firebase);
}
