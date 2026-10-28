import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { importStripeSubscribers } from '../src/utils/stripeReports.js';
import { resolveCatalogue } from '../src/utils/catalogue.js';
import { PRODUCTS } from '../src/constants/products.js';

const projectId = assertLocalFirebase(process.env);
initializeAdminApp({ projectId });
const db = getFirestore();
const oldPaging = db.batch();
for (let index = 0; index < 105; index += 1) oldPaging.delete(db.collection('orders').doc(`PAGING-${String(index).padStart(3, '0')}`));
await oldPaging.commit();
const browserApp = initializeApp({ apiKey: 'demo-api-key', projectId, storageBucket: `${projectId}.appspot.com` });
const auth = getAuth(browserApp);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
const storage = getStorage(browserApp);
const [storageHost, storagePort] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');
connectStorageEmulator(storage, storageHost, Number(storagePort));
const port = 3003;
const mockStripe = `
const originalFetch = globalThis.fetch;
let subscription = { id: 'sub_legacy', customer: { id: 'cus_legacy', name: 'Legacy member', email: 'legacy@example.com' }, status: 'active',
  items: { data: [{ price: { id: 'price_local', nickname: 'Monthly test', currency: 'gbp', unit_amount: 2000, recurring: { interval: 'month' } } }] },
  latest_invoice: { payment_intent: { latest_charge: { refunded: false, disputed: false, amount_refunded: 0 } } } };
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.stripe.com/')) return originalFetch(url, options);
  const parsed = new URL(url);
  if (parsed.pathname === '/v1/checkout/sessions') {
    const body = new URLSearchParams(options.body);
    if (body.get('mode') !== 'payment' || body.has('line_items[0][price_data][recurring][interval]')) throw new Error('Event ticket must be one-off');
    return Response.json({ id: 'cs_event_fixture', url: 'https://checkout.stripe.com/test-fixture' });
  }
  if (parsed.pathname === '/v1/subscriptions') return Response.json({ data: [subscription], has_more: false });
  if (parsed.pathname === '/v1/subscriptions/sub_legacy') {
    if (options?.method === 'DELETE') {
      const body = new URLSearchParams(options.body);
      if (body.get('invoice_now') !== 'false' || body.get('prorate') !== 'false') throw new Error('Unexpected invoicing or proration');
      subscription = { ...subscription, status: 'canceled', cancel_at_period_end: false };
    }
    return Response.json(subscription);
  }
  throw new Error('Unexpected Stripe request: ' + parsed.pathname);
};`;
const server = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mockStripe)}`, 'server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STRIPE_WEBHOOK_SECRET: 'whsec_local_only', STRIPE_SECRET_KEY: 'sk_test_local_fixture',
    STRIPE_REPORT_SECRET_KEY: 'rk_test_local_fixture', STRIPE_SUBSCRIPTION_ADMIN_KEY: 'rk_test_local_fixture' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });
const request = async (path, options = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  const result = await response.json();
  return { status: response.status, result };
};
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`API startup failed: ${output}`)), 15000);
    server.stdout.on('data', () => {
      if (output.includes(`running at http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
    });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`API exited ${code}: ${output}`)); });
  });
  assert.equal((await request('/api/admin/reports?kind=orders')).status, 401);
  const user = (await signInWithEmailAndPassword(auth, 'admin@forthcanoeclub.co.uk', 'local-test-password')).user;
  const token = await user.getIdToken(true);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const eventSchedule = { mode: 'consecutive', startDate: '2027-04-05', startTime: '15:00', endTime: '17:00', days: 5, timeZone: 'Europe/London' };
  await db.collection('products').doc('TEST-EVENT').set({ name: 'Five-day course', category: 'EVENTS', type: 'event-ticket', basePrice: 50, eventSchedule });
  const savedCatalogue = await db.collection('products').get();
  const resolved = resolveCatalogue(PRODUCTS, savedCatalogue.docs.map((document) => ({ ...document.data(), id: document.id })));
  assert.ok(resolved.some((product) => product.id === 'TEST-EVENT'));
  assert.ok(resolved.some((product) => product.id === 'membership-adult'));
  await db.collection('memberships').doc('TEST-EVENT-MEMBER').set({ firstName: 'Eve', lastName: 'Event', email: 'event@example.com', dob: '1990-01-01', status: 'active', validUntil: Timestamp.fromDate(new Date(Date.now() + 90 * 86400000)) });
  const eventCheckout = await request('/api/checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'event@example.com', items: [{ id: 'TEST-EVENT', lineId: 'L1' }], billingMode: 'monthly',
      people: [{ id: 'P1', lineIds: ['L1'], returning: true, firstName: 'Eve', lastName: 'Event', dob: '1990-01-01', disclaimerAccepted: true }] }) });
  assert.equal(eventCheckout.status, 200);
  const eventOrder = (await db.collection('orders').doc(eventCheckout.result.orderRef).get()).data();
  assert.deepEqual(eventOrder.items[0].eventSchedule, eventSchedule);
  assert.equal(eventOrder.items[0].price, 50);
  await db.collection('orders').doc(eventCheckout.result.orderRef).update({ status: 'paid', total: '80',
    items: [...eventOrder.items, { id: 'membership-adult', name: 'Membership', category: 'MEMBERSHIP', type: 'annual-oneoff', price: 30 }] });
  const events = await request('/api/admin/reports?kind=events', { headers });
  assert.equal(events.status, 200);
  const ticket = events.result.records.find((record) => record.id === eventCheckout.result.orderRef);
  assert.deepEqual(ticket.items[0].eventSchedule, eventSchedule);
  assert.equal(ticket.total, 50);
  assert.equal(ticket.orderTotal, 80);
  assert.equal(ticket.items.length, 1);
  await db.collection('products').doc('TEST-EVENT').set({ deleted: true }, { merge: true });
  const removed = await request('/api/checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'event@example.com', items: [{ id: 'TEST-EVENT' }] }) });
  assert.equal(removed.status, 400);
  const report = await request('/api/admin/reports?kind=orders', { headers });
  assert.equal(report.status, 200);
  assert.ok(report.result.records.some((record) => record.id === 'TEST-SUBSCRIPTION' && record.subscriptionWarning));
  const legacy = { id: 'sub_legacy', stripeCustomerId: 'cus_legacy', name: 'Legacy member', email: 'legacy@example.com', status: 'Active', items: [] };
  const [firstImport] = await importStripeSubscribers(db, [legacy], 'test', '2026-10-11T00:00:00Z');
  const [secondImport] = await importStripeSubscribers(db, [{ ...legacy, email: 'updated@example.com' }], 'test', '2026-10-12T00:00:00Z');
  assert.equal(firstImport.clubCustomerId, secondImport.clubCustomerId);
  const imported = (await db.collection('stripeSubscriptions').doc(firstImport.clubSubscriptionId).get()).data();
  assert.equal(imported.firstImportedAt, '2026-10-11T00:00:00Z');
  assert.equal(imported.lastCheckedAt, '2026-10-12T00:00:00Z');
  assert.equal((await db.collection('stripeCustomers').get()).size, 1);
  assert.equal((await db.collection('stripeSubscriptions').get()).size, 1);
  assert.equal((await request('/api/admin/subscribers/sub_legacy/cancel', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'test', confirmId: 'wrong' })
  })).status, 400);
  const subscribers = await request('/api/admin/reports?kind=subscribers', { headers });
  assert.equal(subscribers.status, 200);
  assert.equal(subscribers.result.records[0].clubCustomerId, firstImport.clubCustomerId);
  assert.equal(subscribers.result.records[0].status, 'Active');
  const cancel = (overrides = {}) => request('/api/admin/subscribers/sub_legacy/cancel', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'test', clubCustomerId: firstImport.clubCustomerId,
      confirmId: 'sub_legacy', acknowledgeImmediateCancellation: true, ...overrides })
  });
  assert.equal((await cancel({ acknowledgeImmediateCancellation: false })).status, 400);
  assert.equal((await cancel({ mode: 'live' })).status, 400);
  assert.equal((await cancel({ clubCustomerId: 'FCC-test-cus_wrong' })).status, 409);
  const cancelled = await cancel();
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.result.record.stripeStatus, 'canceled');
  assert.equal(cancelled.result.record.status, 'Inactive');
  assert.equal(cancelled.result.changed, true);
  const repeated = await cancel();
  assert.equal(repeated.status, 200);
  assert.equal(repeated.result.changed, false);
  const cancelledRecord = (await db.collection('stripeSubscriptions').doc(firstImport.clubSubscriptionId).get()).data();
  assert.equal(cancelledRecord.stripeStatus, 'canceled');
  assert.ok(cancelledRecord.immediateCancellationConfirmedBy);
  assert.equal((await db.collection('adminSubscriptionAudit').get()).size, 1);
  const members = await request('/api/admin/reports?kind=members', { headers });
  assert.equal(members.result.records.find((record) => record.id === 'test-current').status, 'Active');
  assert.equal(members.result.records.find((record) => record.id === 'test-expired').status, 'Expired');
  const remove = (acknowledgeStripe) => request('/api/admin/records/orders/TEST-SUBSCRIPTION', {
    method: 'DELETE', headers, body: JSON.stringify({ confirmId: 'TEST-SUBSCRIPTION', acknowledgeStripe })
  });
  assert.equal((await remove(false)).status, 409);
  assert.equal((await remove(true)).status, 200);
  assert.equal((await db.collection('orders').doc('TEST-SUBSCRIPTION').get()).exists, false);
  assert.equal((await db.collection('adminDeletionAudit').get()).empty, false);
  const purchase = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'receipt@example.com', total: '30', items: [{ name: 'Local purchase', price: 30 }] }) });
  assert.equal(purchase.status, 200);
  assert.equal(purchase.result.emailSent, true);
  const receipt = await request(`/api/orders/${purchase.result.orderRef}.${purchase.result.accessToken}`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.result.total, '30');
  assert.equal((await db.collection('testMail').where('orderRef', '==', purchase.result.orderRef).get()).empty, false);
  await db.collection('orders').doc('TEST-WEBHOOK').set({ email: 'webhook@example.com', status: 'pending', total: '25',
    stripeSessionId: 'cs_local_test', createdAt: Timestamp.now(), items: [{ name: 'Monthly test', price: 25, type: 'subscription' }] });
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {
    id: 'cs_local_test', payment_status: 'paid', amount_total: 2500, subscription: 'sub_local_webhook', metadata: { order_ref: 'TEST-WEBHOOK' }
  } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'whsec_local_only').update(`${timestamp}.${payload}`).digest('hex');
  const webhook = await request('/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body: payload });
  assert.equal(webhook.status, 200);
  assert.equal((await db.collection('orders').doc('TEST-WEBHOOK').get()).data().status, 'paid');
  const image = ref(storage, 'pages/home/test-upload/logo.png');
  await uploadBytes(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6He8AAAAASUVORK5CYII=', 'base64'), { contentType: 'image/png' });
  assert.equal((await fetch(await getDownloadURL(image))).status, 200);
  await assert.rejects(uploadBytes(ref(storage, 'pages/home/test-upload/unsafe.txt'), Buffer.from('test'), { contentType: 'text/plain' }));
  const batch = db.batch();
  for (let index = 0; index < 105; index += 1) batch.set(db.collection('orders').doc(`PAGING-${String(index).padStart(3, '0')}`), { email: 'paging@example.com', status: 'paid', total: '0', items: [] });
  await batch.commit();
  const first = await request('/api/admin/reports?kind=orders', { headers });
  assert.equal(first.result.records.length, 100);
  assert.ok(first.result.nextCursor);
  const second = await request(`/api/admin/reports?kind=orders&cursor=${encodeURIComponent(first.result.nextCursor)}`, { headers });
  assert.ok(second.result.records.length > 0);
  assert.equal(second.result.nextCursor, null);
  assert.equal(new Set([...first.result.records, ...second.result.records].map((record) => record.id)).size, first.result.records.length + second.result.records.length);
  console.log('Emulator smoke checks passed: catalogue preservation, event checkout/schedule snapshots/reports/deletion, subscriber imports, mocked Stripe immediate cancellation/audit, admin access, member expiry, pagination, deletion warnings, receipts, webhook and Storage rules.');
} finally {
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  if (server.exitCode === null) await exited;
  await db.terminate();
}