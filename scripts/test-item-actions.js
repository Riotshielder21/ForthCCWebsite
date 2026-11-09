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
let failStop = false;
const invoices = [{ id: 'in_test', number: 'TEST', amount_paid: 2000, lines: { data: [
  { amount: 1200, subscription_item: 'si_target' }, { amount: 800, subscription_item: 'si_other' }
]} }];
const stripeRequest = async (path, params, method = 'POST') => {
  const url = new URL(`https://stripe.invalid/${path}`);
  const form = new URLSearchParams(params || []);
  if (url.pathname === '/invoices') return { data: invoices, has_more: false };
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
  stopMonthlyItem: async (...args) => {
    if (failStop) { failStop = false; throw new Error('Simulated Stripe outage while stopping monthly payments'); }
    stopped.push(args);
  } });
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
  created.add(`auditLog/item_${operationId}`);
  return { action: 'revoke', reason, operationId };
};
const refund = (amount, paymentIntent, revoke = false) => ({ ...action(), action: 'refund', amount, paymentIntent, revoke });
const order = async (suffix, items, people = [], extra = {}) => {
  const id = `TEST-${run}-${suffix}`;
  return put(`orders/${id}`, { schemaVersion: 2, status: 'paid', totalPence: items.reduce((sum, item) => sum + item.pricePence, 0),
    items, people, membershipIds: [...new Set(people.map((person) => person.membershipId).filter(Boolean))], paidAt: Timestamp.now(), ...extra });
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
    const holder = await put(`memberships/MONTHLY-${run}`, { source: 'website' });
    const purchase = await order('main-monthly', [{ id: 'boat-hire', lineId: 'line', category: 'SERVICES', monthly: true, pricePence: 0 }],
      [{ membershipId: holder.id, lineIds: ['line'] }], { subscriptionPlan: { recordedAt: Timestamp.now() } });
    const subscription = await put(`subscriptions/sub_main_${run}`, { orderRef: 'another-order', orderRefs: [purchase.id],
      status: 'active', items: [{ lineId: 'line', orderRef: purchase.id, membershipIds: [holder.id], status: 'active' }] });
    await put(`membershipTerms/${holder.id}_2026`, { membershipId: holder.id, clubYear: 2026, items: [{ productId: 'boat-hire', orderRef: purchase.id, lineId: 'line' }] });
    await holder.update({
      subscriptionItems: [{ subscriptionId: subscription.id, orderRef: purchase.id, lineId: 'line', status: 'active' }] });
    const response = await fetch(`http://127.0.0.1:${port}${path(purchase)}/actions`, { method: 'POST', headers, body: JSON.stringify(action('Stop monthly hire')) });
    assert.equal(response.status, 200, await response.text());
    assert.equal((await subscription.get()).data().status, 'cancelled', 'the real route wiring stops the matching merged monthly subscription');
    assert.equal((await holder.get()).data().subscriptionItems[0].status, 'cancelled');
    assert.ok((await purchase.get()).data().items[0].monthlyCancelledAt);
    assert.ok((await purchase.get()).data().items[0].revokedAt);
    const revokedEnd = (await db.doc(`membershipTerms/${holder.id}_2026`).get()).data().items[0].endedAt;
    assert.ok(revokedEnd && revokedEnd.toMillis() <= Date.now(), 'revoking ends access now, not at the paid-up date');
    const audit = await db.collection('auditLog').where('orderRefs', 'array-contains', purchase.id).get();
    for (const document of audit.docs) created.add(document.ref.path);
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].data().kind, 'subscription');
    assert.equal(audit.docs[0].data().reason, 'Stop monthly hire');
    const post = async (reference, line, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path(reference, line)}/actions`, { method: 'POST', headers, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const payer = await put(`memberships/REFUND-${run}`, { source: 'website' });
    const paymentIntent = `pi_charge_3000_${run}`;
    const paid = await order('main-refund', [{ id: 'boat-hire', lineId: 'line', category: 'SERVICES', monthly: true, pricePence: 1500 },
      { id: 'coaching', lineId: 'other', category: 'SERVICES', monthly: true, pricePence: 1500 }],
    [{ membershipId: payer.id, lineIds: ['line', 'other'] }], { subscriptionPlan: { recordedAt: Timestamp.now() }, stripe: { paymentIntentId: paymentIntent } });
    const billed = await put(`subscriptions/sub_refund_${run}`, { orderRef: paid.id, status: 'active', membershipIds: [payer.id], items: [
      { lineId: 'line', orderRef: paid.id, stripeItemId: `si_flaky_${run}`, membershipIds: [payer.id], status: 'active' },
      { lineId: 'other', orderRef: paid.id, stripeItemId: `si_other_${run}`, membershipIds: [payer.id], status: 'active' }] });
    const refundOnly = await post(paid, 'line', refund(500, paymentIntent));
    assert.equal(refundOnly.status, 200, JSON.stringify(refundOnly.body));
    assert.equal(refundOnly.body.monthlyPaymentsStopped, false);
    assert.deepEqual((await billed.get()).data().items.map((item) => item.status), ['active', 'active'], 'refunding one payment keeps billing');
    assert.equal((await billed.get()).data().status, 'active');
    assert.equal((await paid.get()).data().items[0].revokedAt, undefined);
    const cancelLine = refund(1000, paymentIntent, true);
    const interrupted = await post(paid, 'line', cancelLine);
    assert.equal(interrupted.body.unfinished, true, 'a Stripe outage while stopping billing leaves the action to resume');
    assert.equal((await billed.get()).data().items[0].status, 'active');
    const resumed = await post(paid, 'line', cancelLine);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.refundId, (await db.doc(`auditLog/item_${cancelLine.operationId}`).get()).data().refund.id);
    assert.equal(resumed.body.monthlyPaymentsStopped, true);
    assert.deepEqual((await billed.get()).data().items.map((item) => item.status), ['cancelled', 'active'], 'refund and cancel stops only this item');
    assert.equal((await billed.get()).data().status, 'active');
    const cancelledLine = (await paid.get()).data().items[0];
    assert.ok(cancelledLine.revokedAt && cancelledLine.monthlyCancelledAt);
    assert.deepEqual(cancelledLine.refunds.map((entry) => entry.amountPence), [500, 1000], 'resuming does not refund twice');
    const payments = await fetch(`http://127.0.0.1:${port}${path(paid)}/payments`, { headers });
    assert.equal((await payments.json()).payments[0].available, 0, 'Stripe holds exactly the two refunds');
    const cancelLast = await post(paid, 'other', refund(1500, paymentIntent, true));
    assert.equal(cancelLast.status, 200, JSON.stringify(cancelLast.body));
    assert.equal((await billed.get()).data().status, 'cancelled', 'refund and cancel of the last item cancels the subscription');
    const billingAudit = await db.collection('auditLog').where('stripeSubscriptionId', '==', billed.id).get();
    for (const document of billingAudit.docs) created.add(document.ref.path);
    assert.deepEqual(billingAudit.docs.map((document) => document.data().action).sort(), ['cancel-subscription', 'refund-and-cancel']);
    await purchase.update({ itemActionPending: { request: { operationId: randomUUID() } } });
    const deletion = await fetch(`http://127.0.0.1:${port}/api/admin/records/orders/${purchase.id}`, {
      method: 'DELETE', headers, body: JSON.stringify({ confirmId: purchase.id, acknowledgeStripe: true, reason: 'Test order' })
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
    keyAccess: { grantedAt: Timestamp.now(), source: 'purchase' } });
  const keyTerm = await put(`membershipTerms/${member.id}_2026`, { membershipId: member.id, clubYear: 2026,
    items: [{ productId: 'keyhire', orderRef: `TEST-${run}-key`, lineId: 'line' }] });
  const keyOrder = await order('key', [{ id: 'keyhire', lineId: 'line', category: 'SERVICES', pricePence: 1000 }],
    [{ membershipId: member.id, lineIds: ['line'] }], { stripe: { paymentIntentId: 'pi_key' } });
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
  assert.equal((await keyTerm.get()).data().items[0].endedAt, undefined, 'refund-only preserves access');
  assert.equal((await call(`${path(keyOrder)}/actions`, 'POST', refund(701, 'pi_key'))).status, 400, 'line over-refund rejected');
  assert.equal((await call(`${path(keyOrder)}/actions`, 'POST', refund(700, 'pi_key', true))).status, 200);
  const revoked = (await member.get()).data();
  assert.ok(revoked.keyAccess.revokedAt);
  assert.ok((await keyTerm.get()).data().items[0].endedAt);
  assert.equal((await keyTerm.get()).data().items[0].revokeReason, 'Test reason');
  assert.equal((await keyOrder.get()).data().totalPence, 1000, 'financial history is retained');
  assert.deepEqual((await keyOrder.get()).data().items[0].refunds.map((entry) => entry.amountPence), [300, 700], 'item refunds are recorded in pence');
  await call('/api/admin/boathouse-code', 'POST', { ...settings, alarmCode: 'changed' });
  assert.equal(emails.length, 1, 'revoked key holders do not receive changed codes');
  await member.update({ volunteer: { inducted: true } });
  assert.equal(await keyAccess.settleKeyAccess(member), 'not-active', 'induction cannot bypass admin revocation');

  const ambiguousOrder = await order('ambiguous', [{ id: 'shirt', lineId: 'line', category: 'MERCHANDISE', pricePence: 1500 }], [], { stripe: { paymentIntentId: 'pi_ambiguous' } });
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

  const rejectedOrder = await order('rejected', [{ id: 'shirt', lineId: 'line', pricePence: 1000 }], [], { stripe: { paymentIntentId: 'pi_rejected' } });
  charge('pi_rejected', 1000);
  rejectRefund = true;
  const rejectedAction = refund(500, 'pi_rejected');
  const rejection = await call(`${path(rejectedOrder)}/actions`, 'POST', rejectedAction);
  assert.equal(rejection.body.unfinished, false);
  assert.equal((await rejectedOrder.get()).data().itemActionPending, null);
  const rejectedAudit = (await db.doc(`auditLog/item_${rejectedAction.operationId}`).get()).data();
  assert.deepEqual([rejectedAudit.kind, rejectedAudit.action, rejectedAudit.reason, rejectedAudit.status], ['item', 'refund', 'Test reason', 'rejected']);
  rejectRefund = false;
  assert.equal((await call(`${path(rejectedOrder)}/actions`, 'POST', refund(500, 'pi_rejected'))).status, 200);

  const eventOrder = await order('event', [
    { id: `event-${run}`, lineId: 'line', category: 'EVENTS', pricePence: 2000 },
    { id: `event-${run}`, lineId: 'other', category: 'EVENTS', pricePence: 2000 }
  ]);
  const stock = await put(`stock/event-${run}`, { holds: { [eventOrder.id]: { until: null, lines: { all: 2 } } } });
  assert.equal((await call(`${path(eventOrder)}/actions`, 'POST', action('Cannot attend'))).status, 200);
  assert.equal((await stock.get()).data().holds[eventOrder.id].lines.all, 1, 'only revoked ticket capacity is released');
  assert.equal((await eventOrder.get()).data().items[1].revokedAt, undefined);

  const voucherOrder = await order('voucher', [{ id: 'voucher', lineId: 'line', type: 'voucher', pricePence: 6000 }], [],
    { vouchers: [{ code: `V-${run}` }], stripe: { paymentIntentId: 'pi_voucher' } });
  const voucher = await put(`discountCodes/V-${run}`, { status: 'used', type: 'credit', discountValue: 60 });
  charge('pi_voucher', 6000);
  assert.equal((await call(`${path(voucherOrder)}/actions`, 'POST', refund(6000, 'pi_voucher', true))).status, 409, 'used voucher cannot be revoked');
  await voucher.update({ status: 'active' });
  assert.equal((await call(`${path(voucherOrder)}/actions`, 'POST', action())).status, 200);
  assert.equal((await voucher.get()).data().status, 'disabled');

  const monthly = await order('monthly', [{ id: 'coaching', lineId: 'line', category: 'SERVICES', pricePence: 0, monthly: true }]);
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
  const stopsBefore = stopped.length;
  assert.equal((await call(`${path(monthly)}/actions`, 'POST', refund(1200, 'pi_invoice'))).status, 200);
  assert.equal(stopped.length, stopsBefore, 'refunding one monthly payment leaves the subscription running');
  assert.equal((await monthly.get()).data().items[0].revokedAt, undefined, 'refunding one monthly payment keeps access');

  // Refund and cancel: Stripe accepts the refund, then stopping billing fails; resuming must not refund again.
  invoices.push({ id: 'in_month2', number: 'TEST-2', amount_paid: 1200, payment_intent: 'pi_month2', lines: { data: [{ amount: 1200, subscription_item: 'si_target' }] } });
  charge('pi_month2', 1200);
  const cancelAction = refund(1200, 'pi_month2', true);
  failStop = true;
  const interrupted = await call(`${path(monthly)}/actions`, 'POST', cancelAction);
  assert.equal(interrupted.status, 502);
  assert.equal(interrupted.body.unfinished, true);
  assert.match(interrupted.body.error, /Resume unfinished action.*never issues a second refund/);
  const refundsBeforeResume = refundCalls;
  assert.ok((await monthly.get()).data().itemActionPending, 'the interrupted refund and cancel stays recorded');
  assert.equal((await monthly.get()).data().items[0].revokedAt, undefined);
  assert.equal((await call(`${path(monthly)}/actions`, 'POST', refund(100, 'pi_month2'))).status, 409, 'another refund waits for the recorded action');
  const resumed = await call(`${path(monthly)}/actions`, 'POST', cancelAction);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(refundCalls, refundsBeforeResume, 'resuming reuses the recorded refund');
  assert.equal(resumed.body.refundId, `re_${refundsBeforeResume}`);
  assert.equal(resumed.body.monthlyPaymentsStopped, true);
  assert.equal(stopped.length, stopsBefore + 1, 'billing is stopped once');
  assert.equal(stopped.at(-1)[4], 'refund-and-cancel');
  const cancelledLine = (await monthly.get()).data().items[0];
  assert.ok(cancelledLine.revokedAt, 'refund and cancel removes access');
  assert.deepEqual(cancelledLine.refunds.map((entry) => [entry.paymentIntent, entry.amountPence]), [['pi_invoice', 1200], ['pi_month2', 1200]]);
  assert.equal((await monthly.get()).data().itemActionPending, null);
  const replayed = await call(`${path(monthly)}/actions`, 'POST', cancelAction);
  assert.equal(replayed.body.alreadyCompleted, true);
  assert.equal(refundCalls, refundsBeforeResume);
  assert.equal(stopped.length, stopsBefore + 1, 'a completed refund and cancel is not repeated');

  const membership = await put(`memberships/FAMILY-${run}`, { source: 'website', status: 'active', validUntil: Timestamp.fromDate(new Date('2099-03-01')) });
  const membershipTerm = await put(`membershipTerms/FAMILY-${run}_2026`, { membershipId: membership.id, clubYear: 2026, source: 'website', tier: 'family',
    orderRef: `TEST-${run}-membership`, start: Timestamp.fromDate(new Date('2026-03-01')), end: Timestamp.fromDate(new Date('2027-03-01')), items: [] });
  const membershipOrder = await order('membership', [{ id: 'membership', category: 'MEMBERSHIP', lineId: 'line', clubYear: 2026, pricePence: 3000 }],
    [{ membershipId: membership.id, lineIds: ['line'] }]);
  assert.equal((await call(`${path(membershipOrder)}/actions`, 'POST', action())).status, 200);
  assert.equal((await membership.get()).data().status, 'revoked');
  assert.ok((await membershipTerm.get()).data().revokedAt, 'the revoked club year is marked on its term');
  assert.equal((await membershipOrder.get()).exists, true);
  assert.ok(stopped.length >= 4, 'revocations call the shared monthly cancellation service');

  const imported = await put(`memberships/IMPORTED-${run}`, { source: 'justgo', status: 'active', validUntil: Timestamp.fromDate(new Date('2099-03-01')) });
  const importedOrder = await order('imported', [{ id: 'membership', category: 'MEMBERSHIP', lineId: 'line', clubYear: 2026, pricePence: 3000 }],
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
  const accessAudit = await db.collection('auditLog').where('membershipId', '==', member.id).get();
  for (const document of accessAudit.docs) created.add(document.ref.path);
  assert.deepEqual(accessAudit.docs.map((document) => document.data()).filter((entry) => entry.kind === 'item').map((entry) => entry.reason).sort(),
    ['Key returned', 'New key issued'], 'key grants and revocations retain reasons in the audit trail');
  await checkMainServer();
  console.log('Item action checks passed: key access, revocation override, refunds, refund and cancel, pending refunds, retry reconciliation, vouchers, stock, membership and invoice allocation.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  for (const path of created) await db.doc(path).delete();
  await db.terminate();
  await deleteApp(firebase);
}
