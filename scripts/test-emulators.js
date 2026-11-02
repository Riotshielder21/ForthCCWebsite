import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
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
let sessionNumber = 0;
const customers = new Map();
let subscription = { id: 'sub_legacy', customer: { id: 'cus_legacy', name: 'Legacy member', email: 'legacy@example.com' }, status: 'active',
  items: { data: [{ price: { id: 'price_local', nickname: 'Monthly test', currency: 'gbp', unit_amount: 2000, recurring: { interval: 'month' } } }] },
  latest_invoice: { payment_intent: { latest_charge: { refunded: false, disputed: false, amount_refunded: 0 } } } };
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.stripe.com/')) return originalFetch(url, options);
  const parsed = new URL(url);
  const method = options?.method || 'GET';
  if (parsed.pathname === '/v1/customers') {
    const email = method === 'GET' ? parsed.searchParams.get('email') : new URLSearchParams(options.body).get('email');
    if (!email || !['GET', 'POST'].includes(method)) throw new Error('Expected a customer lookup or creation with an email');
    if (method === 'GET') return Response.json({ data: customers.has(email) ? [customers.get(email)] : [], has_more: false });
    const customer = { id: 'cus_smoke_' + (customers.size + 1), email };
    customers.set(email, customer);
    return Response.json(customer);
  }
  if (parsed.pathname === '/v1/checkout/sessions') {
    const body = new URLSearchParams(options.body);
    if (body.get('mode') !== 'payment' || body.has('line_items[0][price_data][recurring][interval]')) throw new Error('These purchases must be one-off payments');
    if (body.has('customer_email') || ![...customers.values()].some((customer) => customer.id === body.get('customer'))) throw new Error('Checkout must use the customer looked up or created for the payer');
    return Response.json({ id: 'cs_event_fixture_' + ++sessionNumber, url: 'https://checkout.stripe.com/test-fixture?success_url=' + encodeURIComponent(body.get('success_url')) });
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
const request = async (path, options = {}, { expectJson = true } = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  const text = await response.text();
  let result = text;
  if (expectJson) {
    try { result = JSON.parse(text); }
    catch {
      throw new Error(`Expected JSON from ${options.method || 'GET'} ${path}, received HTTP ${response.status}: ${text}\nAPI output:\n${output}`);
    }
  }
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
  for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]]) {
    const compressed = compress(Buffer.from('{}'));
    for (const body of [compressed, Buffer.concat([compressed, Buffer.from('trailing bytes')])]) {
      for (const path of ['/api/checkout-session', '/api/stripe/webhook']) {
        const rejected = await request(path, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding }, body });
        assert.equal(rejected.status, 415, `${path} must reject ${encoding} before decompression`);
        assert.match(rejected.result.error, /uncompressed JSON/);
      }
    }
  }
  assert.equal((await request('/health')).status, 200, 'compressed requests must not crash the API');
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
  assert.equal(eventCheckout.status, 200, `Event checkout failed: ${JSON.stringify(eventCheckout.result)}\nAPI output:\n${output}`);
  const eventOrder = (await db.collection('orders').doc(eventCheckout.result.orderRef).get()).data();
  assert.deepEqual(eventOrder.items[0].eventSchedule, eventSchedule);
  assert.equal(eventOrder.items[0].pricePence, 5000);
  await db.collection('orders').doc(eventCheckout.result.orderRef).update({ status: 'paid', totalPence: 8000,
    items: [...eventOrder.items, { id: 'membership-adult', name: 'Membership', category: 'MEMBERSHIP', type: 'annual-oneoff', pricePence: 3000 }] });
  const events = await request(`/api/admin/reports?kind=events&recordId=${encodeURIComponent(eventCheckout.result.orderRef)}`, { headers });
  assert.equal(events.status, 200);
  const ticket = events.result.records.find((record) => record.id === eventCheckout.result.orderRef);
  assert.deepEqual(ticket.items[0].eventSchedule, eventSchedule);
  assert.equal(ticket.total, 50);
  assert.equal(ticket.orderTotal, 80);
  assert.equal(ticket.items.length, 1);
  await db.collection('products').doc('TEST-EVENT').set({ active: false }, { merge: true });
  const removed = await request('/api/checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'event@example.com', items: [{ id: 'TEST-EVENT' }] }) });
  assert.equal(removed.status, 400);
  const report = await request('/api/admin/reports?kind=orders&recordId=TEST-SUBSCRIPTION', { headers });
  assert.equal(report.status, 200);
  assert.ok(report.result.records.some((record) => record.id === 'TEST-SUBSCRIPTION' && record.subscriptionWarning));
  await db.collection('orders').doc('TEST-LEGACY-PAYER').set({ status: 'paid', email: 'legacy@example.com', membershipIds: ['test-current'], items: [] });
  const legacy = { id: 'sub_legacy', stripeCustomerId: 'cus_legacy', orderRef: '', status: 'Active', items: [] };
  const [firstImport] = await importStripeSubscribers(db, [legacy], 'test', '2026-10-11T00:00:00Z', new Map([['sub_legacy', 'legacy@example.com']]));
  const [secondImport] = await importStripeSubscribers(db, [legacy], 'test', '2026-10-12T00:00:00Z', new Map([['sub_legacy', 'updated@example.com']]));
  assert.equal(firstImport.clubCustomerId, secondImport.clubCustomerId);
  assert.deepEqual(secondImport.membershipIds, ['test-current'], 'members found earlier are kept');
  const imported = (await db.collection('stripeSubscriptions').doc(firstImport.clubSubscriptionId).get()).data();
  assert.equal(imported.firstImportedAt, '2026-10-11T00:00:00Z');
  assert.equal(imported.lastCheckedAt, '2026-10-12T00:00:00Z');
  const importedCustomer = (await db.collection('stripeCustomers').doc(firstImport.clubCustomerId).get()).data();
  for (const mirrored of [imported, importedCustomer]) {
    assert.deepEqual(mirrored.membershipIds, ['test-current'], 'the mirror records the members the payer\'s orders cover');
    assert.equal('name' in mirrored || 'email' in mirrored, false, 'the payer\'s name and email are not copied');
  }
  assert.equal((await db.collection('stripeCustomers').get()).size, 1);
  assert.equal((await db.collection('stripeSubscriptions').get()).size, 1);
  assert.equal((await request('/api/admin/subscribers/sub_legacy/cancel', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'test', confirmId: 'wrong' })
  })).status, 400);
  const subscribers = await request('/api/admin/reports?kind=subscribers', { headers });
  assert.equal(subscribers.status, 200);
  assert.equal(subscribers.result.records[0].clubCustomerId, firstImport.clubCustomerId);
  assert.equal(subscribers.result.records[0].status, 'Active');
  assert.deepEqual(subscribers.result.records[0].names, ['Test Current'], 'staff see member names resolved from the member records');
  assert.equal('email' in subscribers.result.records[0] || 'name' in subscribers.result.records[0], false);
  const cancel = (overrides = {}) => request('/api/admin/subscribers/sub_legacy/cancel', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'test', clubCustomerId: firstImport.clubCustomerId,
      confirmId: 'sub_legacy', acknowledgeImmediateCancellation: true, reason: 'Payer asked to stop', ...overrides })
  });
  assert.equal((await cancel({ acknowledgeImmediateCancellation: false })).status, 400);
  assert.equal((await cancel({ mode: 'live' })).status, 400);
  assert.equal((await cancel({ clubCustomerId: 'FCC-test-cus_wrong' })).status, 409);
  const unexplained = await cancel({ reason: '' });
  assert.equal(unexplained.status, 400, 'stopping billing needs a reason');
  assert.match(unexplained.result.error, /reason/i);
  const cancelled = await cancel();
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.result.record.stripeStatus, 'canceled');
  assert.equal(cancelled.result.record.status, 'Inactive');
  assert.equal(cancelled.result.changed, true);
  assert.deepEqual(cancelled.result.record.names, ['Test Current']);
  const repeated = await cancel();
  assert.equal(repeated.status, 200);
  assert.equal(repeated.result.changed, false);
  const cancelledRecord = (await db.collection('stripeSubscriptions').doc(firstImport.clubSubscriptionId).get()).data();
  assert.equal(cancelledRecord.stripeStatus, 'canceled');
  assert.ok(cancelledRecord.immediateCancellationConfirmedBy);
  const cancellationAudit = await db.collection('auditLog').where('stripeSubscriptionId', '==', 'sub_legacy').get();
  assert.equal(cancellationAudit.size, 1, 'repeating cancellation keeps one audit record for this subscription');
  assert.deepEqual([cancellationAudit.docs[0].data().kind, cancellationAudit.docs[0].data().reason], ['subscription', 'Payer asked to stop']);
  await db.collection('memberships').doc('SMOKE-CONFIRMED-EXPIRED').set({
    firstName: 'Confirmed', lastName: 'Expired', status: 'active', validUntil: Timestamp.fromDate(new Date('2020-03-01T00:00:00Z')),
    source: 'justgo', justgoSyncStatus: 'synced', lastJustgoSync: Timestamp.now()
  });
  for (const [id, status] of [['test-current', 'Active'], ['test-expired', 'Pending'], ['SMOKE-CONFIRMED-EXPIRED', 'Expired']]) {
    const members = await request(`/api/admin/reports?kind=members&recordId=${id}`, { headers });
    assert.equal(members.status, 200);
    assert.equal(members.result.records.find((record) => record.id === id).status, status);
  }
  const remove = (acknowledgeStripe, reason = 'Test order') => request('/api/admin/records/orders/TEST-SUBSCRIPTION', {
    method: 'DELETE', headers, body: JSON.stringify({ confirmId: 'TEST-SUBSCRIPTION', acknowledgeStripe, reason })
  });
  assert.equal((await remove(true, '')).status, 400, 'deleting a record needs a reason');
  assert.equal((await remove(false)).status, 409);
  assert.equal((await remove(true)).status, 200);
  assert.equal((await db.collection('orders').doc('TEST-SUBSCRIPTION').get()).exists, false);
  assert.equal((await db.collection('auditLog').where('recordId', '==', 'TEST-SUBSCRIPTION').get()).docs[0].data().reason, 'Test order');
  assert.equal((await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'receipt@example.com', total: '0', items: [] }) }, { expectJson: false })).status, 404, 'unpaid orders cannot be created through the retired endpoint');
  const purchase = await request('/api/checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'event@example.com', items: [{ id: 'keyhire', lineId: 'receipt-key' }], billingMode: 'annual',
      people: [{ id: 'receipt-person', lineIds: ['receipt-key'], returning: true, firstName: 'Eve', lastName: 'Event', dob: '1990-01-01', disclaimerAccepted: true }] }) });
  assert.equal(purchase.status, 200, `Receipt checkout failed: ${JSON.stringify(purchase.result)}\nAPI output:\n${output}`);
  const purchaseOrder = (await db.collection('orders').doc(purchase.result.orderRef).get()).data();
  const successUrl = new URL(purchase.result.checkoutUrl).searchParams.get('success_url');
  const receiptToken = new URL(successUrl).searchParams.get('receipt_token');
  assert.ok(receiptToken && purchaseOrder.receiptTokenHash && !('accessTokenHash' in purchaseOrder) && !('receiptViewTokenHash' in purchaseOrder), 'one receipt token is stored as a hash');
  const paidPayload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {
    id: purchaseOrder.stripe.sessionId, mode: 'payment', payment_status: 'paid', amount_total: purchaseOrder.totalPence, success_url: successUrl,
    payment_intent: 'pi_receipt_fixture', metadata: { order_ref: purchase.result.orderRef }
  } } });
  const paidAt = Math.floor(Date.now() / 1000);
  const paidSignature = createHmac('sha256', 'whsec_local_only').update(`${paidAt}.${paidPayload}`).digest('hex');
  const paid = await request('/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${paidAt},v1=${paidSignature}` }, body: paidPayload });
  assert.equal(paid.status, 200, JSON.stringify(paid.result));
  const paidOrder = (await db.collection('orders').doc(purchase.result.orderRef).get()).data();
  assert.equal(paidOrder.fulfilment.emailSent, true);
  assert.equal(paidOrder.receiptTokenHash, purchaseOrder.receiptTokenHash, 'the emailed receipt uses the payment-page token');
  assert.equal(paidOrder.people[0].firstName, undefined, 'the paid order keeps references, not personal details');
  const mail = (await db.collection('testMail').where('orderRef', '==', purchase.result.orderRef).get()).docs[0].data();
  assert.equal(new URL(mail.retrievalUrl).pathname.split('/order/')[1].split('.')[1], receiptToken);
  const receipt = await request(`/api/orders/${new URL(mail.retrievalUrl).pathname.split('/order/')[1]}`);
  assert.equal(receipt.status, 200);
  assert.equal(Number(receipt.result.total) * 100, purchaseOrder.totalPence);
  assert.equal(receipt.result.items[0].name, 'Boathouse Access');
  assert.deepEqual(receipt.result.items[0].personNames, ['Eve Event']);
  assert.equal('people' in receipt.result, false, 'public receipt does not expose contact records');
  await db.collection('orders').doc('TEST-WEBHOOK').set({ schemaVersion: 2, email: 'webhook@example.com', status: 'pending', totalPence: 2500,
    stripe: { sessionId: 'cs_local_test' }, fulfilment: {}, createdAt: Timestamp.now(), items: [{ name: 'Monthly test', pricePence: 2500, type: 'subscription' }] });
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
  for (let index = 0; index < 105; index += 1) batch.set(db.collection('orders').doc(`PAGING-${String(index).padStart(3, '0')}`), { schemaVersion: 2, email: 'paging@example.com', status: 'paid', totalPence: 0, items: [] });
  await batch.commit();
  const records = [];
  const cursors = new Set();
  let cursor = '';
  let pages = 0;
  do {
    const page = await request(`/api/admin/reports?kind=orders${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers });
    assert.equal(page.status, 200);
    assert.ok(page.result.records.length <= 100);
    if (pages === 0) assert.equal(page.result.records.length, 100);
    records.push(...page.result.records);
    cursor = page.result.nextCursor;
    if (cursor) {
      assert.equal(page.result.records.length, 100, 'non-final order pages are full');
      assert.ok(!cursors.has(cursor), 'pagination must advance');
      cursors.add(cursor);
    }
    pages += 1;
  } while (cursor);
  assert.ok(pages >= 2);
  assert.equal(new Set(records.map((record) => record.id)).size, records.length, 'pages never repeat an order');
  const pagingIds = records.filter((record) => /^PAGING-\d{3}$/.test(record.id)).map((record) => record.id).sort();
  assert.deepEqual(pagingIds, Array.from({ length: 105 }, (_, index) => `PAGING-${String(index).padStart(3, '0')}`), 'all seeded pagination fixtures are returned regardless of other orders');
  console.log('Emulator smoke checks passed: catalogue preservation, event checkout/schedule snapshots/reports/deletion, subscriber imports, mocked Stripe immediate cancellation/audit, admin access, member expiry, pagination, deletion warnings, receipts, webhook and Storage rules.');
} finally {
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  if (server.exitCode === null) await exited;
  await db.collection('memberships').doc('SMOKE-CONFIRMED-EXPIRED').delete();
  await db.terminate();
}