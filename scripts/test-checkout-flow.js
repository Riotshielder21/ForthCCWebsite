// End-to-end checkout test: API -> Stripe webhook -> Firestore records -> admin reports.
// Needs the Firebase emulators and an API server (Stripe mocked) already running; see DEVELOPMENT.md.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { PRODUCTS } from '../src/constants/products.js';
import { assignLines } from '../src/utils/checkout.js';
import { eventAttendeeRows, justgoUploadRows } from '../src/utils/adminReports.js';

const projectId = assertLocalFirebase(process.env);
const apiPort = Number(process.env.TEST_API_PORT || 3010);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_local_only';
initializeAdminApp({ projectId });
const db = getFirestore();
const browserApp = initializeApp({ apiKey: 'demo-api-key', projectId });
const auth = getAuth(browserApp);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });

const run = Date.now().toString(36);
let sourceAddress = 1;
// Each request comes from a different loopback address so the API's per-IP rate limits do not interfere.
const call = (method, path, { body, headers = {}, raw } = {}) => new Promise((resolve, reject) => {
  sourceAddress = (sourceAddress % 250) + 1;
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const request = http.request({ host: '127.0.0.1', port: apiPort, path, method, localAddress: `127.0.0.${sourceAddress + 1}`,
    headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (response) => {
    let text = '';
    response.on('data', (chunk) => { text += chunk; });
    response.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: response.statusCode, json, text }); });
  });
  request.on('error', reject);
  if (payload) request.write(payload);
  request.end();
});

const yearsAgo = (years, month = 5, day = 15) => `${new Date().getFullYear() - years}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const email = (name) => `${name}.${run}@example.test`;

let idCounter = 0;
const makeId = () => `p${++idCounter}-${run}`;
const lineFor = (productId, index) => ({ ...PRODUCTS.find((product) => product.id === productId), lineId: `${productId}-${index}-${run}` });
const adultDetails = (over = {}) => ({
  firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), email: '', phone: '07700 900111', address: '1 River Road', postcode: 'EH1 1AA',
  swimming: 'confident', medical: 'Asthma', photoConsent: true, disclaimerAccepted: true,
  emergencyContact: { name: 'Pat Friend', phone: '07700 900222', relationship: 'Friend' }, ...over
});
const juniorDetails = (over = {}) => ({
  firstName: 'Jamie', lastName: 'Junior', dob: yearsAgo(12), swimming: 'basic', medical: 'None', photoConsent: true, disclaimerAccepted: true,
  guardian: { name: 'Parent Person', phone: '07700 900333', email: '', relationship: 'Parent', address: '9 Parent Street', postcode: 'EH9 9ZZ' }, ...over
});
const build = (productIds, fillers) => {
  const lines = productIds.map(lineFor);
  const people = assignLines([], lines, makeId).map((person, index) => ({ ...person, ...(fillers[index] || {}) }));
  return { lines, people };
};
const checkout = (emailAddress, { lines, people }, extra = {}, headers = {}) => call('POST', '/api/checkout-session', { body: {
  email: emailAddress, items: lines.map(({ id, lineId }) => ({ id, lineId })), people, billingMode: 'annual', ...extra }, headers });
const sendWebhook = async (event) => {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `t=${timestamp},v1=${createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex')}`;
  return call('POST', '/api/stripe/webhook', { raw: payload, headers: { 'stripe-signature': signature } });
};
const pay = async (orderRef) => {
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  return sendWebhook({ type: 'checkout.session.completed', data: { object: {
    id: order.stripeSessionId, payment_status: 'paid', amount_total: Math.round(Number(order.total) * 100),
    metadata: { order_ref: orderRef }, payment_intent: `pi_${orderRef}`, subscription: order.stripeSubscriptionId || '' } } });
};
const buy = async (emailAddress, basket, extra) => {
  const result = await checkout(emailAddress, basket, extra);
  assert.equal(result.status, 200, `checkout failed: ${result.text}`);
  const webhook = await pay(result.json.orderRef);
  assert.equal(webhook.status, 200, `webhook failed: ${webhook.text}`);
  return result.json.orderRef;
};
const membershipsFor = async (emailAddress) => {
  const [legacy, households] = await Promise.all([
    db.collection('memberships').where('email', '==', emailAddress).get(),
    db.collection('households').where('email', '==', emailAddress).get()
  ]);
  const householdById = new Map(households.docs.map((document) => [document.id, { id: document.id, ...document.data() }]));
  const householdMembers = (await Promise.all(households.docs.map((household) =>
    db.collection('memberships').where('householdId', '==', household.id).get()
  ))).flatMap((snapshot) => snapshot.docs);
  return [...new Map([...legacy.docs, ...householdMembers].map((document) => [document.id, document])).values()]
    .map((document) => ({ id: document.id, ...document.data(), household: householdById.get(document.data().householdId) || {} }));
};

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}`); }
  catch (error) { results.push({ name, ok: false, error }); console.log(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`); }
};

const token = await (await signInWithEmailAndPassword(auth, 'admin@forthcanoeclub.co.uk', 'local-test-password')).user.getIdToken(true);
const admin = { Authorization: `Bearer ${token}` };
const shared = {};

console.log(`Checkout flow test, run ${run}`);

await test('admin endpoints reject anonymous requests', async () => {
  for (const path of ['/api/admin/reports?kind=orders', '/api/admin/customer?q=a@b.co', '/api/admin/discount-codes']) assert.equal((await call('GET', path)).status, 401);
});

await test('Stripe returns to an approved checkout origin and rejects unapproved origins', async () => {
  const basket = build(['vouchers'], []);
  const approvedEmail = email('origin-approved');
  const approved = await checkout(approvedEmail, basket, {}, { Origin: 'https://staging.example.test' });
  assert.equal(approved.status, 200);
  assert.equal((await db.collection('orders').doc(approved.json.orderRef).get()).data().siteUrl, 'https://staging.example.test');
  const unapprovedEmail = email('origin-unapproved');
  const unapproved = await checkout(unapprovedEmail, basket, {}, { Origin: 'https://attacker.example.test' });
  assert.equal(unapproved.status, 200);
  assert.equal((await db.collection('orders').doc(unapproved.json.orderRef).get()).data().siteUrl, 'https://fccwebsite-23cfc.web.app');
});

await test('paid checkout returns a private itemized receipt shared with the email copy', async () => {
  const receiptEmail = email('receipt');
  const details = adultDetails({ firstName: 'Receipt', lastName: 'Member', email: receiptEmail });
  const started = await checkout(receiptEmail, build(['membership-adult', 'keyhire'], [details]));
  assert.equal(started.status, 200);
  const checkoutUrl = new URL(started.json.checkoutUrl);
  const successUrl = new URL(checkoutUrl.searchParams.get('return_url'));
  const receiptToken = successUrl.searchParams.get('receipt_token');
  assert.match(receiptToken, /^[a-f0-9]{64}$/);
  const orderRef = started.json.orderRef;
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  const receiptPath = `/api/checkout-receipt?session_id=${order.stripeSessionId}&receipt_token=${receiptToken}`;
  assert.equal((await call('GET', receiptPath)).status, 409, 'receipt details are hidden until paid');
  assert.equal((await pay(orderRef)).status, 200);
  const response = await call('GET', receiptPath);
  assert.equal(response.status, 200);
  assert.equal(response.json.receipt.payerEmail, receiptEmail);
  assert.deepEqual(response.json.receipt.people.map((person) => [person.name, person.email]), [['Receipt Member', receiptEmail]]);
  assert.equal(response.json.receipt.people[0].memberships[0].name, 'CLUB MEMBERSHIP — ADULT');
  assert.equal(response.json.receipt.people[0].addOns[0].name, 'Boathouse Access');
  assert.match(response.json.copy, /Membership:/);
  assert.match(response.json.copy, /Add-ons:/);
  const mail = (await db.collection('testMail').where('orderRef', '==', orderRef).get()).docs[0].data();
  assert.ok(mail.body.startsWith(response.json.copy), 'email and website use the same receipt copy');
  assert.equal((await call('GET', `${receiptPath.slice(0, receiptPath.indexOf('&receipt_token='))}&receipt_token=${'0'.repeat(64)}`)).status, 404);
});

await test('voucher-only purchase needs no membership and creates a voucher on the customer record', async () => {
  const buyer = email('gifter');
  const basket = build(['vouchers'], []);
  assert.equal(basket.people.length, 0);
  shared.voucherOrder = await buy(buyer, basket);
  const customer = await call('GET', `/api/admin/customer?q=${encodeURIComponent(buyer)}`, { headers: admin });
  assert.equal(customer.status, 200);
  assert.equal(customer.json.vouchers.length, 1);
  const voucher = customer.json.vouchers[0];
  assert.equal(voucher.status, 'active');
  assert.equal(voucher.value, 60);
  shared.voucherCode = voucher.code;
  shared.gifter = buyer;
  const byCode = await call('GET', `/api/admin/customer?q=${voucher.code}`, { headers: admin });
  assert.equal(byCode.json.email, buyer);
  const mail = await db.collection('testMail').where('orderRef', '==', shared.voucherOrder).get();
  assert.equal(mail.size, 1);
  assert.ok(mail.docs[0].data().vouchers.some((entry) => entry.code === voucher.code), 'voucher code is in the receipt email');
  const stored = (await db.collection('customers').get()).docs.map((document) => document.data()).find((record) => record.email === buyer);
  assert.ok(stored.vouchers.some((entry) => entry.code === voucher.code), 'voucher saved on customer record');
});

await test('receipt link shows items but no personal details', async () => {
  const mail = (await db.collection('testMail').where('orderRef', '==', shared.voucherOrder).get()).docs[0].data();
  const key = mail.retrievalUrl.split('/order/')[1];
  const receipt = await call('GET', `/api/orders/${key}`);
  assert.equal(receipt.status, 200);
  assert.ok(receipt.json.items.length === 1);
  assert.ok(!('people' in receipt.json) && !JSON.stringify(receipt.json).includes('@'), 'no people or email in the receipt API');
});

await test('someone with no membership cannot buy an add-on alone', async () => {
  const stranger = email('stranger');
  const basket = build(['boat-hire'], [adultDetails({ email: stranger })]);
  const result = await checkout(stranger, basket);
  assert.equal(result.status, 409);
  assert.equal(result.json.code, 'membership_required');
});

await test('adult membership plus boat hire is recorded on the membership, customer and order', async () => {
  const alex = email('alex');
  shared.alex = alex;
  const basket = build(['membership-adult', 'boat-hire'], [adultDetails({ email: alex })]);
  assert.equal(basket.people.length, 1);
  shared.adultOrder = await buy(alex, basket);
  const [membership] = await membershipsFor(alex);
  assert.ok(membership, 'membership record exists');
  assert.equal(membership.firstName, 'Alex');
  assert.equal(membership.lastName, 'Adult');
  assert.equal(membership.status, 'active');
  assert.equal(membership.membershipTier, 'adult');
  assert.equal(membership.household.address, '1 River Road');
  assert.equal(membership.household.emergencyContact.name, 'Pat Friend');
  assert.equal(Object.hasOwn(membership, 'email'), false);
  assert.equal(membership.medical, 'Asthma');
  assert.equal(membership.justgoSyncStatus, 'pending');
  assert.deepEqual([membership.justgoUpload.status, membership.justgoUpload.mode, membership.justgoUpload.attempts], ['queued', 'new', 0], 'queued for the automatic JustGo upload');
  assert.ok(membership.validUntil.toDate() > new Date());
  assert.deepEqual(membership.privileges.map((entry) => entry.productId), ['boat-hire']);
  assert.equal(membership.history.length, 1);
  assert.equal(membership.consents.disclaimer.policyKey, 'participation-disclaimer');
  assert.ok(membership.consents.disclaimer.version >= 1, 'the wording version shown at checkout is recorded');
  assert.equal(membership.consents.photoVideo.accepted, true);
  shared.alexMembership = membership.id;
  const order = (await db.collection('orders').doc(shared.adultOrder).get()).data();
  assert.equal(order.status, 'paid');
  assert.equal(order.emailSent, true);
  assert.equal(order.people[0].membershipId, membership.id);
  assert.equal(order.people[0].address, '1 River Road');
  const customer = await call('GET', `/api/admin/customer?q=${encodeURIComponent(alex)}`, { headers: admin });
  assert.equal(customer.json.memberships.length, 1);
  assert.deepEqual(customer.json.memberships[0].privileges, ['ANNUAL BOAT & KIT HIRE']);
});

await test('an email only reveals that a record exists, names need the matching date of birth', async () => {
  const lookup = (body) => call('POST', '/api/membership-names', { body });
  assert.deepEqual((await lookup({ email: shared.alex })).json, { exists: true, names: [] });
  assert.deepEqual((await lookup({ email: shared.alex, dob: yearsAgo(36) })).json, { exists: true, names: [] });
  assert.deepEqual((await lookup({ email: shared.alex, dob: yearsAgo(35) })).json, { exists: true, names: [{ firstName: 'Alex', lastName: 'Adult' }] });
  assert.deepEqual((await lookup({ email: email('nobody'), dob: yearsAgo(35) })).json, { exists: false, names: [] });
});

await test('a returning member can add an add-on with only name and date of birth', async () => {
  const returning = { returning: true, firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), disclaimerAccepted: true };
  const wrong = build(['keyhire'], [{ ...returning, dob: yearsAgo(36) }]);
  const mismatch = await checkout(shared.alex, wrong);
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.json.code, 'identity_conflict', 'same name on the email with another date of birth is flagged');
  const unknown = await checkout(shared.alex, build(['keyhire'], [{ ...returning, firstName: 'Zed', lastName: 'Unknown' }]));
  assert.equal(unknown.status, 409);
  assert.equal(unknown.json.code, 'returning_not_found');
  const orderRef = await buy(shared.alex, build(['keyhire'], [returning]));
  const records = await membershipsFor(shared.alex);
  assert.equal(records.length, 1, 'no duplicate membership created');
  assert.deepEqual(records[0].privileges.map((entry) => entry.productId).sort(), ['boat-hire', 'keyhire']);
  assert.equal(records[0].history.length, 2);
  assert.equal(records[0].address, '1 River Road', 'existing details are not overwritten by the short form');
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.people[0].existingMember, true);
});

await test('full details for an existing member are matched, not duplicated', async () => {
  await buy(shared.alex, build(['blue-sub'], [adultDetails({ email: shared.alex })]));
  assert.equal((await membershipsFor(shared.alex)).length, 1);
});

await test('junior membership uses the parent contact details', async () => {
  const parent = email('parent');
  shared.parent = parent;
  const basket = build(['membership-junior'], [juniorDetails({ guardian: { ...juniorDetails().guardian, email: parent } })]);
  const orderRef = await buy(parent, basket);
  const [membership] = await membershipsFor(parent);
  assert.equal(membership.firstName, 'Jamie');
  assert.equal(membership.membershipTier, 'junior');
  assert.equal(membership.household.phone, '07700 900333');
  assert.equal(membership.household.address, '9 Parent Street');
  assert.equal(membership.household.contactName, 'Parent Person');
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.people[0].junior, true);
});

await test('a sibling on the same parent email becomes a separate record', async () => {
  const basket = build(['membership-junior'], [juniorDetails({ firstName: 'Robin', dob: yearsAgo(10, 3, 3), guardian: { ...juniorDetails().guardian, email: shared.parent } })]);
  await buy(shared.parent, basket);
  const records = await membershipsFor(shared.parent);
  assert.deepEqual(records.map((record) => record.firstName).sort(), ['Jamie', 'Robin']);
});

await test('same name and email with a different date of birth is flagged, not duplicated', async () => {
  const basket = build(['membership-junior'], [juniorDetails({ dob: yearsAgo(11, 8, 8), guardian: { ...juniorDetails().guardian, email: shared.parent } })]);
  const result = await checkout(shared.parent, basket);
  assert.equal(result.status, 409);
  assert.equal(result.json.code, 'identity_conflict');
  assert.equal((await membershipsFor(shared.parent)).length, 2);
});

await test('a membership number must agree with the date of birth', async () => {
  await db.collection('memberships').doc('sca-E2E-1').set({ affiliationNumber: `E2E-${run}`, firstName: 'Sam', lastName: 'Synced', email: email('synced'), dob: yearsAgo(40, 2, 2), status: 'active', validUntil: new Date(Date.now() + 90 * 86400000), source: 'justgo', justgoSyncStatus: 'synced', renewalMethod: 'justgo', lastJustgoSync: new Date() });
  const synced = { ...adultDetails({ firstName: 'Sam', lastName: 'Synced', dob: yearsAgo(40, 2, 2), email: email('synced') }), affiliationNumber: `E2E-${run}` };
  const bad = await checkout(email('synced'), build(['boat-hire'], [{ ...synced, dob: yearsAgo(41, 2, 2) }]));
  assert.equal(bad.status, 409);
  assert.equal(bad.json.code, 'identity_conflict');
  const wrongEmail = await checkout(email('synced'), build(['boat-hire'], [{ ...synced, email: 'someone.else@example.test' }]));
  assert.equal(wrongEmail.status, 409);
  assert.equal(wrongEmail.json.code, 'identity_conflict');
  assert.match(wrongEmail.json.error, /email address or date of birth/);
  assert.match(wrongEmail.json.error, /JustGo will email you/);
  await buy(email('synced'), build(['boat-hire'], [synced]));
  assert.equal((await db.collection('memberships').doc('sca-E2E-1').get()).data().privileges[0].productId, 'boat-hire');
});

await test('an active member cannot buy a second membership, and JustGo members renew through JustGo', async () => {
  const again = await checkout(shared.alex, build(['membership-adult'], [adultDetails({ email: shared.alex })]));
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'membership_active');
  const synced = { ...adultDetails({ firstName: 'Sam', lastName: 'Synced', dob: yearsAgo(40, 2, 2), email: email('synced') }), affiliationNumber: `E2E-${run}` };
  const viaJustgo = await checkout(email('synced'), build(['membership-adult'], [synced]));
  assert.equal(viaJustgo.status, 409);
  assert.equal(viaJustgo.json.code, 'renews_via_justgo');
  assert.match(viaJustgo.json.error, /JustGo/);
  assert.equal((await checkout(email('synced'), build(['keyhire'], [synced]))).status, 200, 'add-ons are still allowed');
});

await test('Stripe subscription status is checked before treating a member as active', async () => {
  const coachingEmail = email('coaching-cancelled');
  const coachingDetails = adultDetails({ firstName: 'Coaching', lastName: 'Cancelled', email: coachingEmail });
  await buy(coachingEmail, build(['membership-adult', 'blue-sub'], [coachingDetails]), { billingMode: 'monthly' });
  const [coachingMember] = await membershipsFor(coachingEmail);
  assert.equal(coachingMember.stripeMembershipSubscriptionId, '', 'a coaching subscription is not the member subscription');
  assert.equal((await checkout(coachingEmail, build(['keyhire'], [coachingDetails]))).status, 200,
    'a canceled coaching plan does not invalidate the separately paid membership');

  const activeEmail = email('stripe-active');
  const activeDetails = adultDetails({ firstName: 'Stripe', lastName: 'Active', email: activeEmail });
  await db.collection('memberships').doc(`stripe-active-${run}`).set({
    firstName: activeDetails.firstName, lastName: activeDetails.lastName, dob: activeDetails.dob, email: activeEmail,
    status: 'active', validUntil: new Date('2099-03-01T00:00:00Z'), source: 'website', renewalMethod: 'website',
    stripeMembershipSubscriptionId: 'sub_e2e_active', stripeMembershipMode: 'test'
  });
  const duplicate = await checkout(activeEmail, build(['membership-adult'], [activeDetails]));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.code, 'membership_active');

  const cancelledEmail = email('stripe-cancelled');
  const cancelledDetails = adultDetails({ firstName: 'Stripe', lastName: 'Cancelled', email: cancelledEmail });
  const cancelledOrder = `legacy-stripe-order-${run}`;
  await db.collection('orders').doc(cancelledOrder).set({ stripeSubscriptionId: 'sub_e2e_cancelled', stripeMode: 'test',
    items: [{ category: 'MEMBERSHIP', type: 'subscription' }] });
  await db.collection('memberships').doc(`stripe-cancelled-${run}`).set({
    firstName: cancelledDetails.firstName, lastName: cancelledDetails.lastName, dob: cancelledDetails.dob, email: cancelledEmail,
    status: 'active', validUntil: new Date('2099-03-01T00:00:00Z'), source: 'website', renewalMethod: 'website',
    history: [{ orderRef: cancelledOrder }]
  });
  const addOn = await checkout(cancelledEmail, build(['keyhire'], [cancelledDetails]));
  assert.equal(addOn.status, 409);
  assert.equal(addOn.json.code, 'membership_required');
  assert.equal((await db.collection('memberships').doc(`stripe-cancelled-${run}`).get()).data().stripeMembershipSubscriptionId, 'sub_e2e_cancelled');
  assert.equal((await checkout(cancelledEmail, build(['membership-adult'], [cancelledDetails]))).status, 200,
    'a canceled subscriber may buy a replacement membership');

  const noSubscriptionEmail = email('stripe-unlinked-history');
  const noSubscriptionDetails = adultDetails({ firstName: 'Legacy', lastName: 'Member', email: noSubscriptionEmail });
  const ordinaryOrder = `legacy-annual-order-${run}`;
  await db.collection('orders').doc(ordinaryOrder).set({ items: [{ category: 'MEMBERSHIP', type: 'annual-oneoff' }] });
  await db.collection('memberships').doc(`legacy-no-sub-${run}`).set({
    firstName: noSubscriptionDetails.firstName, lastName: noSubscriptionDetails.lastName, dob: noSubscriptionDetails.dob,
    email: noSubscriptionEmail, status: 'active', validUntil: new Date('2099-03-01T00:00:00Z'),
    history: [{ orderRef: ordinaryOrder }]
  });
  assert.equal((await checkout(noSubscriptionEmail, build(['keyhire'], [noSubscriptionDetails]))).status, 200);
  assert.equal((await db.collection('memberships').doc(`legacy-no-sub-${run}`).get()).data().stripeMembershipSubscriptionId, '');
});

await test('JustGo members are inactive until the sync confirms their renewal in the club year', async () => {
  const now = new Date();
  const yearStart = new Date(now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1, 2, 1);
  const lapsed = email('unconfirmed');
  const details = adultDetails({ firstName: 'Lou', lastName: 'Unconfirmed', dob: yearsAgo(45, 7, 7), email: lapsed });
  await db.collection('memberships').doc(`sca-E2E-U-${run}`).set({ affiliationNumber: `E2E-U-${run}`, firstName: 'Lou', lastName: 'Unconfirmed', email: lapsed, dob: details.dob, status: 'active',
    validUntil: new Date(now.getTime() + 90 * 86400000), source: 'justgo', justgoSyncStatus: 'synced', renewalMethod: 'justgo', lastJustgoSync: new Date(yearStart.getTime() - 86400000) });
  const addOn = await checkout(lapsed, build(['boat-hire'], [details]));
  assert.equal(addOn.status, 409);
  assert.equal(addOn.json.code, 'membership_required');
  assert.match(addOn.json.error, /renewal has not been confirmed/);
  const register = (await call('GET', '/api/admin/reports?kind=members', { headers: admin })).json.records.find((record) => record.id === `sca-E2E-U-${run}`);
  assert.equal(register.status, 'Awaiting renewal');
  await db.collection('memberships').doc(`sca-E2E-U-${run}`).set({ lastJustgoSync: new Date() }, { merge: true });
  assert.equal((await checkout(lapsed, build(['boat-hire'], [details]))).status, 200, 'active once the sync confirms them');
  const after = (await call('GET', '/api/admin/reports?kind=members', { headers: admin })).json.records.find((record) => record.id === `sca-E2E-U-${run}`);
  assert.equal(after.status, 'Current');
});

await test('a person with a membership number we do not hold is invited through JustGo', async () => {
  const visitor = email('visitor');
  const basket = build(['membership-adult'], [{ ...adultDetails({ firstName: 'Vic', lastName: 'Visitor', email: visitor }), affiliationNumber: `PS-${run}` }]);
  await buy(visitor, basket);
  const [record] = await membershipsFor(visitor);
  assert.equal(record.affiliationNumber, `PS-${run}`);
  assert.deepEqual([record.justgoUpload.status, record.justgoUpload.mode], ['queued', 'invite']);
  shared.visitorMembership = record.id;
});

await test('staff can retry the upload or mark it as done by hand, and failures reach the staff list', async () => {
  const act = (id, action) => call('POST', `/api/admin/memberships/${id}/justgo`, { headers: admin, body: { action } });
  assert.equal((await call('POST', `/api/admin/memberships/${shared.visitorMembership}/justgo`, { body: { action: 'retry' } })).status, 401);
  await db.collection('memberships').doc(shared.visitorMembership).set({ justgoUpload: { status: 'failed', needsStaff: true, failures: 3, attempts: 3, lastError: 'JustGo invitation expired' } }, { merge: true });
  let report = (await call('GET', '/api/admin/reports?kind=members', { headers: admin })).json.records;
  const failed = report.find((record) => record.id === shared.visitorMembership);
  assert.equal(failed.justgo, 'Needs staff upload');
  assert.equal(failed.uploadFailures, 3);
  const staffRows = justgoUploadRows(report);
  const row = staffRows.find((entry) => entry[0] === shared.visitorMembership);
  assert.deepEqual([row[1], row[10], row[11], row[12]], ['Vic', `PS-${run}`, 3, 'JustGo invitation expired']);
  assert.equal((await act(shared.visitorMembership, 'retry')).status, 200);
  report = (await call('GET', '/api/admin/reports?kind=members', { headers: admin })).json.records;
  assert.equal(report.find((record) => record.id === shared.visitorMembership).justgo, 'Awaiting upload');
  assert.equal((await act(shared.visitorMembership, 'manual')).status, 200);
  report = (await call('GET', '/api/admin/reports?kind=members', { headers: admin })).json.records;
  assert.equal(report.find((record) => record.id === shared.visitorMembership).justgo, 'Added by staff, awaiting sync');
  assert.equal((await act('sca-E2E-1', 'retry')).status, 409, 'already linked members are left alone');
  assert.equal((await act('nope', 'explode')).status, 400);
});

await test('family membership shares contact details and notes parents as the children\'s emergency contact', async () => {
  const family = email('family');
  const adultTwo = { firstName: 'Casey', lastName: 'Adult', dob: yearsAgo(37), swimming: 'confident', junior: false, disclaimerAccepted: true, photoConsent: true, medical: '' };
  const child = { firstName: 'Kit', lastName: 'Adult', dob: yearsAgo(9), swimming: 'basic', junior: true, disclaimerAccepted: true, photoConsent: false, medical: 'Hay fever' };
  const basket = build(['membership-family'], [adultDetails({ email: family, firstName: 'Drew', swimming: 'confident' }), adultTwo, child]);
  assert.equal(basket.people.length, 3);
  const orderRef = await buy(family, basket);
  const records = await membershipsFor(family);
  assert.equal(records.length, 3);
  assert.equal(new Set(records.map((record) => record.householdId)).size, 1);
  assert.ok(records.every((record) => record.household.address === '1 River Road' && record.household.phone === '07700 900111'));
  const kid = records.find((record) => record.firstName === 'Kit');
  assert.equal(Object.hasOwn(kid, 'emergencyNote'), false);
  assert.equal(kid.household.emergencyContact.name, 'Pat Friend');
  assert.equal(kid.medical, 'Hay fever');
  assert.equal(kid.photoConsent, false);
  assert.equal(records.find((record) => record.firstName === 'Casey').household.emergencyContact.name, 'Pat Friend');
  shared.familyOrder = orderRef;
  shared.family = family;
});

await test('checkout validation rejects bad details with a clear message', async () => {
  const bad = async (basket, pattern) => {
    const result = await checkout(email('bad'), basket);
    assert.equal(result.status, 400, result.text);
    assert.match(result.json.error, pattern);
  };
  await bad(build(['membership-adult'], [adultDetails({ email: email('bad'), disclaimerAccepted: false })]), /disclaimer/);
  await bad(build(['membership-adult'], [adultDetails({ email: email('bad'), dob: yearsAgo(15) })]), /adult membership/i);
  await bad(build(['membership-junior'], [juniorDetails({ dob: yearsAgo(30) })]), /junior/i);
  await bad(build(['membership-junior'], [juniorDetails({ guardian: { ...juniorDetails().guardian, email: 'not-an-email' } })]), /guardian/);
  await bad(build(['membership-adult'], [adultDetails({ email: 'nope', swimming: '' })]), /swimming|email/);
  const threeAdults = build(['membership-family'], [adultDetails({ email: email('bad') }), { ...adultDetails({ firstName: 'B' }), junior: false }, { ...adultDetails({ firstName: 'C' }), junior: false }]);
  await bad(threeAdults, /at most 2 adults/);
  const childLead = build(['membership-family'], [adultDetails({ email: email('bad'), dob: yearsAgo(10) })]);
  await bad(childLead, /must be an adult/);
  const none = await checkout(email('bad'), { lines: build(['membership-adult'], []).lines, people: [] });
  assert.equal(none.status, 400);
});

await test('discount codes: create, edit, scope, disable, apply', async () => {
  const code = `BOAT${run.toUpperCase()}`;
  const create = await call('POST', '/api/admin/discount-codes', { headers: admin, body: { code, label: 'Boat 20', discountType: 'multiplier', discountValue: 0.2, productIds: ['boat-hire'] } });
  assert.equal(create.status, 200, create.text);
  assert.equal((await call('POST', '/api/admin/discount-codes', { headers: admin, body: { code, label: 'Dup', discountType: 'multiplier', discountValue: 0.2 } })).status, 409);
  assert.equal((await call('POST', '/api/admin/discount-codes', { headers: admin, body: { code: `X${run}`, label: 'Bad', discountType: 'multiplier', discountValue: 5 } })).status, 400);
  const listed = (await call('GET', '/api/admin/discount-codes', { headers: admin })).json.codes.find((entry) => entry.code === code);
  assert.deepEqual(listed.productIds, ['boat-hire']);
  const valid = await call('POST', '/api/discount-codes/validate', { body: { code } });
  assert.equal(valid.json.valid, true);
  const member = { returning: true, firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), disclaimerAccepted: true };
  const scoped = await checkout(shared.alex, build(['boat-hire'], [member]), { discountCode: code });
  assert.equal(scoped.status, 200);
  assert.equal(Number((await db.collection('orders').doc(scoped.json.orderRef).get()).data().total), 68);
  const notApplicable = await checkout(email('newjoiner'), build(['membership-adult'], [adultDetails({ email: email('newjoiner') })]), { discountCode: code });
  assert.equal(notApplicable.status, 400);
  assert.equal((await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { label: 'Boat 50', discountType: 'multiplier', discountValue: 0.5, productIds: ['boat-hire'] } })).status, 200);
  const edited = await checkout(shared.alex, build(['boat-hire'], [member]), { discountCode: code });
  assert.equal(Number((await db.collection('orders').doc(edited.json.orderRef).get()).data().total), 42.5);
  await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { active: false } });
  assert.equal((await call('POST', '/api/discount-codes/validate', { body: { code } })).json.valid, false);
  await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { active: true } });
  assert.equal((await call('POST', '/api/discount-codes/validate', { body: { code } })).json.valid, true);
});

await test('a voucher is accepted once, taken off the price, then shows as used', async () => {
  const member = { returning: true, firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), disclaimerAccepted: true };
  const orderRef = await buy(shared.alex, build(['boat-hire'], [member]), { discountCode: shared.voucherCode });
  assert.equal(Number((await db.collection('orders').doc(orderRef).get()).data().total), 25);
  const customer = await call('GET', `/api/admin/customer?q=${encodeURIComponent(shared.gifter)}`, { headers: admin });
  assert.equal(customer.json.vouchers[0].status, 'used');
  assert.equal(customer.json.vouchers[0].usedByOrder, orderRef);
  assert.equal((await call('POST', '/api/discount-codes/validate', { body: { code: shared.voucherCode } })).json.valid, false);
  const second = await checkout(shared.alex, build(['boat-hire'], [member]), { discountCode: shared.voucherCode });
  assert.equal(second.status, 400);
  const mem = await call('GET', `/api/admin/customer?q=${shared.voucherCode}`, { headers: admin });
  assert.equal(mem.json.vouchers[0].status, 'used');
});

await test('event tickets list attendees with contact and emergency details, even for existing members', async () => {
  const schedule = { mode: 'consecutive', startDate: '2027-04-05', startTime: '15:00', endTime: '17:00', days: 5, timeZone: 'Europe/London' };
  const eventId = `E2E-EVENT-${run}`;
  await db.collection('products').doc(eventId).set({ name: 'E2E five-day course', category: 'EVENTS', type: 'event-ticket', basePrice: 50, eventSchedule: schedule });
  const line = { id: eventId, lineId: `ev-${run}`, name: 'E2E five-day course', category: 'EVENTS', type: 'event-ticket', basePrice: 50 };
  const people = assignLines([], [line], makeId).map((person) => ({ ...person, returning: true, firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), disclaimerAccepted: true }));
  const orderRef = await buy(shared.alex, { lines: [line], people });
  const report = await call('GET', '/api/admin/reports?kind=events', { headers: admin });
  const record = report.json.records.find((entry) => entry.id === orderRef);
  assert.equal(record.items.length, 1);
  assert.deepEqual(record.people[0].events[0].eventSchedule, schedule);
  const [row] = eventAttendeeRows([record], () => 'scheduled');
  assert.deepEqual([row[0], row[2], row[4], row[6], row[7]], ['E2E five-day course', 'Alex Adult', '07700 900111', 'Pat Friend, Friend, 07700 900222', 'Asthma']);
  assert.equal(row[5], shared.alex);
});

await test('reports: orders list shows each person and what they bought', async () => {
  const report = await call('GET', '/api/admin/reports?kind=orders', { headers: admin });
  assert.equal(report.status, 200);
  const family = report.json.records.find((record) => record.id === shared.familyOrder);
  assert.equal(family.status, 'paid');
  assert.equal(family.people.length, 3);
  const kit = family.people.find((person) => person.name === 'Kit Adult');
  assert.equal(kit.kind, 'Under 18');
  assert.equal(kit.emergencyContact, 'Parents are the emergency contact');
  assert.equal(kit.address, '1 River Road, EH1 1AA');
  assert.deepEqual(kit.items, ['CLUB MEMBERSHIP — FAMILY']);
  const alex = report.json.records.find((record) => record.id === shared.adultOrder);
  assert.equal(alex.people[0].medical, 'Asthma');
  assert.deepEqual(alex.items.map((item) => item.name), ['CLUB MEMBERSHIP — ADULT', 'ANNUAL BOAT & KIT HIRE']);
  assert.ok(alex.items.every((item) => typeof item.price === 'number'));
});

await test('reports: one member register holds website and JustGo members, complete and readable', async () => {
  const report = await call('GET', '/api/admin/reports?kind=members', { headers: admin });
  assert.equal(report.status, 200);
  const mine = report.json.records.filter((record) => record.email.endsWith(`.${run}@example.test`));
  assert.equal(mine.length, 1 + 2 + 3 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1, 'alex 1, parent 2 children, family 3, synced member 1, visitor 1, unconfirmed member 1, Stripe members 2, coaching member 1, receipt member 1, legacy member 1');
  const alex = mine.find((record) => record.id === shared.alexMembership);
  assert.equal(alex.name, 'Alex Adult');
  assert.equal(alex.tier, 'adult');
  assert.equal(alex.status, 'Current');
  assert.deepEqual(alex.privileges.sort(), ['ANNUAL BOAT & KIT HIRE', 'Boathouse Access', 'BLUE SUBSCRIPTION'].sort());
  assert.equal(alex.history.length, 5, 'membership, key hire, subscription, voucher-paid hire and the event ticket');
  assert.ok(alex.history.every((entry) => entry.orderRef && entry.paidAt && entry.items.length));
  assert.equal(alex.justgoSync, 'pending');
  assert.equal(alex.address, '1 River Road, EH1 1AA');
  for (const record of mine) for (const [key, value] of Object.entries(record)) {
    if (!['privileges', 'history', 'photoConsent'].includes(key)) assert.ok(['string', 'object', 'number'].includes(typeof value) && !Array.isArray(value) || value === null, `${key} is displayable`);
  }
  assert.ok(mine.some((record) => record.familyGroup));
  assert.equal(alex.source, 'website');
  assert.equal(alex.renewalMethod, 'website');
  assert.equal(alex.justgo, 'Awaiting upload');
  assert.equal(alex.emergencyContact, 'Pat Friend, Friend, 07700 900222');
  const kid = mine.find((record) => record.name === 'Kit Adult');
  assert.equal(kid.emergencyContact, 'Parents are the emergency contact');
  assert.equal(kid.parent, 'Drew Adult, Parent, 07700 900111', 'parent contact recorded for the child');
  assert.equal(kid.medical, 'Hay fever');
  const jam = mine.find((record) => record.name === 'Sam Synced');
  assert.equal(jam.source, 'justgo');
  assert.equal(jam.justgo, 'In JustGo');
  assert.equal(jam.renewalMethod, 'justgo');
  const everyone = report.json.records;
  assert.ok(everyone.some((record) => record.name === 'Test Current' && record.source === 'justgo' && record.status === 'Current'), 'JustGo-synced members are in the same register');
  assert.ok(everyone.some((record) => record.name === 'Test Expired' && record.status === 'Expired'));
});

await test('payment failures and expired sessions retain order contents and expose status for retry', async () => {
  const emailAddress = email('retry');
  const basket = build(['membership-adult'], [adultDetails({ email: emailAddress })]);
  const started = await checkout(emailAddress, basket);
  assert.equal(started.status, 200);
  const orderRef = started.json.orderRef;
  const orderRefDoc = db.collection('orders').doc(orderRef);
  const before = (await orderRefDoc.get()).data();
  const failure = await sendWebhook({ type: 'payment_intent.payment_failed', data: { object: {
    id: `pi_failed_${run}`, metadata: { order_ref: orderRef }, last_payment_error: { code: 'card_declined', decline_code: 'generic_decline' }
  } } });
  assert.equal(failure.status, 200);
  const afterFailure = (await orderRefDoc.get()).data();
  assert.equal(afterFailure.status, 'pending', 'a failed attempt stays retryable');
  assert.equal(afterFailure.lastPaymentFailureCode, 'card_declined');
  assert.deepEqual(afterFailure.items, before.items);
  assert.deepEqual(afterFailure.people, before.people);

  const expired = await sendWebhook({ type: 'checkout.session.expired', data: { object: {
    id: before.stripeSessionId, metadata: { order_ref: orderRef }
  } } });
  assert.equal(expired.status, 200);
  const afterExpiry = (await orderRefDoc.get()).data();
  assert.equal(afterExpiry.status, 'expired');
  assert.deepEqual(afterExpiry.items, before.items);
  assert.deepEqual(afterExpiry.people, before.people);
  assert.equal((await call('GET', `/api/checkout-status?session_id=${before.stripeSessionId}`)).json.status, 'expired');

  const asyncEmail = email('async-failure');
  const asyncStart = await checkout(asyncEmail, build(['membership-adult'], [adultDetails({ email: asyncEmail })]));
  const asyncOrder = (await db.collection('orders').doc(asyncStart.json.orderRef).get()).data();
  const asyncFailure = await sendWebhook({ type: 'checkout.session.async_payment_failed', data: { object: {
    id: asyncOrder.stripeSessionId, metadata: { order_ref: asyncStart.json.orderRef }
  } } });
  assert.equal(asyncFailure.status, 200);
  assert.equal((await db.collection('orders').doc(asyncStart.json.orderRef).get()).data().status, 'payment_failed');
});

await test('merchandise sizes and event capacity limit sales, expiry releases holds and deleting a refunded order frees stock', async () => {
  const tee = `E2E-TEE-${run}`;
  await db.collection('products').doc(tee).set({ name: 'Club tee', category: 'MERCHANDISE', type: 'merchandise', basePrice: 15, description: 'Tee',
    variants: [{ size: 'S', stock: 1 }, { size: 'M', stock: 2 }], deleted: false });
  const shirt = (size, n) => ({ id: tee, lineId: `${tee}-${size}-${n}`, size });
  const order = (who, items) => call('POST', '/api/checkout-session', { body: { email: who, items, people: [], billingMode: 'annual' } });
  const stock = async (id) => (await call('GET', '/api/availability')).json.availability[id];

  assert.deepEqual((await stock(tee)).remaining, { S: 1, M: 2 });
  assert.equal((await order(email('tee-none'), [{ id: tee, lineId: `${tee}-x` }])).status, 400, 'a size is required');
  assert.equal((await order(email('tee-bad'), [shirt('XXL', 1)])).status, 400, 'only listed sizes are sold');

  const first = await order(email('tee-1'), [shirt('S', 1), shirt('M', 1)]);
  assert.equal(first.status, 200, first.text);
  assert.deepEqual((await stock(tee)).remaining, { S: 0, M: 1 });
  const overSell = await order(email('tee-2'), [shirt('S', 2)]);
  assert.equal(overSell.status, 409);
  assert.equal(overSell.json.code, 'sold_out');

  const lastM = await order(email('tee-3'), [shirt('M', 2)]);
  assert.equal(lastM.status, 200);
  assert.equal((await stock(tee)).soldOut, true, 'every size is reserved');
  const lastOrder = (await db.collection('orders').doc(lastM.json.orderRef).get()).data();
  const expired = await sendWebhook({ type: 'checkout.session.expired', data: { object: { id: lastOrder.stripeSessionId, metadata: { order_ref: lastM.json.orderRef } } } });
  assert.equal(expired.status, 200);
  assert.deepEqual((await stock(tee)).remaining, { S: 0, M: 1 }, 'an expired session returns its reservation');

  assert.equal((await pay(first.json.orderRef)).status, 200);
  assert.deepEqual((await stock(tee)).remaining, { S: 0, M: 1 }, 'paying keeps the stock taken');
  const paidOrder = (await db.collection('orders').doc(first.json.orderRef).get()).data();
  assert.deepEqual(paidOrder.items.map((item) => item.size).sort(), ['M', 'S']);
  const report = (await call('GET', '/api/admin/reports?kind=orders', { headers: admin })).json.records.find((record) => record.id === first.json.orderRef);
  assert.deepEqual(report.items.map((item) => item.name).sort(), ['Club tee (M)', 'Club tee (S)']);

  const remove = (orderRef) => call('DELETE', `/api/admin/records/orders/${orderRef}`, { headers: admin, body: { confirmId: orderRef, acknowledgeStripe: true } });
  assert.equal((await remove(first.json.orderRef)).status, 200);
  assert.deepEqual((await stock(tee)).remaining, { S: 1, M: 2 }, 'deleting the refunded order returns its stock');

  const eventId = `E2E-CAP-${run}`;
  const schedule = { mode: 'single', startDate: '2099-05-01', startTime: '10:00', endTime: '12:00', timeZone: 'Europe/London' };
  await db.collection('products').doc(eventId).set({ name: 'Capacity course', category: 'EVENTS', type: 'event-ticket', basePrice: 20, eventSchedule: schedule, capacity: 1 });
  const ticket = (n) => {
    const line = { id: eventId, lineId: `${eventId}-${n}`, name: 'Capacity course', category: 'EVENTS', type: 'event-ticket', basePrice: 20 };
    return { lines: [line], people: assignLines([], [line], makeId).map((person) => ({ ...person, returning: true, firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), disclaimerAccepted: true })) };
  };
  const firstTicket = await buy(shared.alex, ticket(1));
  assert.equal((await stock(eventId)).soldOut, true, 'a full event leaves the shop');
  const full = await checkout(shared.alex, ticket(2));
  assert.equal(full.status, 409);
  assert.equal(full.json.code, 'sold_out');
  assert.equal((await remove(firstTicket)).status, 200);
  assert.equal((await stock(eventId)).soldOut, false, 'a freed place returns the event to the shop');
  assert.equal((await checkout(shared.alex, ticket(3))).status, 200);
});

await test('deleted orders keep a masked audit entry and GDPR erasure removes a person everywhere but keeps the accounts', async () => {
  const erase = (body) => call('POST', '/api/admin/gdpr/erase', { headers: admin, body });
  const preview = (body) => call('POST', '/api/admin/gdpr/preview', { headers: admin, body });
  const remove = (orderRef) => call('DELETE', `/api/admin/records/orders/${orderRef}`, { headers: admin, body: { confirmId: orderRef, acknowledgeStripe: true } });
  const customerCount = async (who) => (await db.collection('customers').where('email', '==', who).get()).size;

  const gdpr = email('gdpr');
  const details = adultDetails({ firstName: 'Gail', lastName: 'Erase', dob: yearsAgo(41, 3, 3), email: gdpr });
  const membershipOrder = await buy(gdpr, build(['membership-adult'], [details]));
  const addOnOrder = await buy(gdpr, build(['keyhire'], [{ returning: true, firstName: 'Gail', lastName: 'Erase', dob: details.dob, disclaimerAccepted: true }]));
  assert.equal((await remove(addOnOrder)).status, 200);
  const audit = (await db.collection('adminDeletionAudit').where('recordId', '==', addOnOrder).get()).docs[0].data();
  assert.equal(audit.summary.maskedEmail, 'g***@e***.test');
  assert.equal(audit.summary.people[0].name, 'G*** E***');
  assert.equal(audit.summary.total, 50);
  assert.equal(JSON.stringify(audit.summary).includes(gdpr), false, 'the summary holds no readable email');
  assert.equal(audit.snapshot.email, gdpr, 'the hidden snapshot allows recovery until erasure');

  const identity = { email: gdpr, firstName: 'Gail', lastName: 'Erase', dob: details.dob };
  const found = await preview(identity);
  assert.equal(found.status, 200, found.text);
  assert.equal(found.json.people.length, 1);
  assert.equal(found.json.deletedRecords.length, 1, 'already-deleted records are found by email, name and date of birth');
  const wrong = await preview({ ...identity, dob: yearsAgo(40, 3, 3) });
  assert.deepEqual([wrong.json.people.length, wrong.json.deletedRecords.length], [0, 0]);
  assert.equal((await erase(identity)).status, 400, 'confirmation is required');

  const total = (await db.collection('orders').doc(membershipOrder).get()).data().total;
  const erased = await erase({ ...identity, scope: 'person', confirm: 'ERASE' });
  assert.equal(erased.status, 200, erased.text);
  assert.equal(erased.json.erased, 1);
  assert.equal((await membershipsFor(gdpr)).length, 0);
  const kept = (await db.collection('orders').doc(membershipOrder).get()).data();
  assert.deepEqual([kept.email, kept.total, kept.items.length, kept.people[0].erased, kept.people[0].firstName], ['***', total, 1, true, undefined]);
  assert.equal(await customerCount(gdpr), 0);
  const purged = (await db.collection('adminDeletionAudit').where('recordId', '==', addOnOrder).get()).docs[0].data();
  assert.deepEqual([purged.snapshot, purged.personalDataErased], [null, true]);
  const trail = (await db.collection('adminDeletionAudit').where('kind', '==', 'gdpr-erasure').get()).docs.map((document) => document.data()).find((entry) => entry.summary.ordersRedacted.includes(membershipOrder));
  assert.ok(trail, 'the erasure itself is recorded');
  assert.equal(JSON.stringify(trail.summary).includes(gdpr), false);
  assert.equal((await erase({ ...identity, scope: 'person', confirm: 'ERASE' })).status, 404, 'nothing is left to erase');

  const family = email('gdpr-family');
  const familyLines = [{ ...lineFor('membership-family', 0), lineId: `gdpr-family-${run}` }];
  const familyDetails = [adultDetails({ email: family, firstName: 'Drew', lastName: 'Famly' }),
    { firstName: 'Casey', lastName: 'Famly', dob: yearsAgo(37), swimming: 'confident', junior: false, disclaimerAccepted: true, photoConsent: true, medical: '' },
    { firstName: 'Kit', lastName: 'Famly', dob: yearsAgo(9), swimming: 'basic', junior: true, disclaimerAccepted: true, photoConsent: false, medical: '' }];
  const familyBasket = { lines: familyLines, people: assignLines([], familyLines, makeId).map((person, index) => ({ ...person, ...familyDetails[index] })) };
  const familyOrder = await buy(family, familyBasket);
  const people = await membershipsFor(family);
  const parent = people.find((record) => record.firstName === 'Drew');
  const kid = people.find((record) => record.firstName === 'Kit');
  const shown = await preview({ membershipId: parent.id });
  assert.deepEqual([shown.json.family.length, shown.json.remaining.length], [3, 2]);
  assert.equal((await erase({ membershipId: parent.id, confirm: 'ERASE' })).json.requiresFamilyChoice, true);
  const missing = await erase({ membershipId: parent.id, scope: 'person', confirm: 'ERASE' });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.requiresSharedDetails, true);
  assert.equal((await membershipsFor(family)).length, 3, 'nothing was erased');

  const sharedDetails = { contactName: 'Sam New', contactRelationship: 'Parent', phone: '07700 900999', email: email('gdpr-new'), address: '9 New Road', postcode: 'EH9 9ZZ',
    emergencyName: 'Pat New', emergencyPhone: '07700 900888', emergencyRelationship: 'Friend' };
  const only = await erase({ membershipId: parent.id, scope: 'person', confirm: 'ERASE', sharedDetails });
  assert.equal(only.status, 200, only.text);
  const stayed = await membershipsFor(sharedDetails.email);
  assert.equal(stayed.length, 2, 'the rest of the family moves to the new shared details');
  assert.ok(stayed.every((record) => record.household.address === '9 New Road' && record.household.emergencyContact.name === 'Pat New'
    && record.household.contactName === 'Sam New'));
  assert.equal((await db.collection('orders').doc(familyOrder).get()).data().email, '***', 'the removed household contact email is redacted');

  const everyone = await erase({ membershipId: kid.id, scope: 'family', confirm: 'ERASE' });
  assert.equal(everyone.status, 200, everyone.text);
  assert.equal(everyone.json.erased, 2);
  assert.equal((await membershipsFor(sharedDetails.email)).length, 0);
  assert.equal((await db.collection('orders').doc(familyOrder).get()).data().email, '***');
  assert.equal(await customerCount(family), 0);

  const subscriber = email('gdpr-sub');
  const subDetails = adultDetails({ firstName: 'Sub', lastName: 'Erase', dob: yearsAgo(44, 4, 4), email: subscriber });
  await buy(subscriber, build(['membership-adult', 'blue-sub'], [subDetails]), { billingMode: 'monthly' });
  const [subscriberRecord] = await membershipsFor(subscriber);
  const cancelled = await erase({ membershipId: subscriberRecord.id, scope: 'person', confirm: 'ERASE' });
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(cancelled.json.subscriptionsCancelled, 1);
  assert.ok(cancelled.json.manual.some((step) => /Stripe/.test(step)));
});

await test('consent and policy wording is recorded as numbered versions that follow changes', async () => {
  const listing = await call('GET', '/api/admin/policies', { headers: admin });
  assert.equal(listing.status, 200);
  assert.equal(listing.json.live, true, 'run the test API with WEBSITE_ISLIVE=true');
  const byKey = new Map(listing.json.policies.map((policy) => [policy.policyKey, policy]));
  assert.ok(byKey.get('participation-disclaimer').currentVersion >= 1);
  assert.ok(byKey.get('photo-video-consent').currentVersion >= 1);
  for (const key of ['privacy-notice', 'data-retention', 'first-aid-and-safety']) assert.equal(byKey.get(key).currentVersion, 0, `${key} is registered but not yet written`);
  const first = listing.json.versions.find((version) => version.policyKey === 'participation-disclaimer' && version.version === 1);
  assert.match(first.text, /participation and safety disclaimer/);
  assert.equal(first.supersedesVersion, null);
  assert.deepEqual((await call('POST', '/api/admin/policies/sync', { headers: admin })).json.recorded, [], 'unchanged wording adds no version');

  await db.collection('policies').doc('participation-disclaimer').set({ currentHash: 'older wording' }, { merge: true });
  const changed = await call('POST', '/api/admin/policies/sync', { headers: admin });
  assert.deepEqual(changed.json.recorded.map((entry) => `${entry.key}@${entry.version}`), [`participation-disclaimer@${byKey.get('participation-disclaimer').currentVersion + 1}`]);
  const next = (await db.collection('policyVersions').doc(`participation-disclaimer@${byKey.get('participation-disclaimer').currentVersion + 1}`).get()).data();
  assert.equal(next.supersedesVersion, byKey.get('participation-disclaimer').currentVersion);
  assert.equal((await call('GET', '/api/admin/policies')).status, 401, 'policy records are admin only');
});

await test('every paid order produced a receipt email record', async () => {
  const orders = (await db.collection('orders').where('status', '==', 'paid').get()).docs.filter((document) => document.id !== 'TEST-MEMBERSHIP');
  const created = orders.filter((document) => document.data().stripeSessionId?.startsWith('cs_e2e_') && document.data().email.endsWith(`.${run}@example.test`));
  assert.ok(created.length >= 8);
  for (const order of created) {
    assert.equal(order.data().emailSent, true, `${order.id} email sent`);
    assert.equal((await db.collection('testMail').where('orderRef', '==', order.id).get()).size, 1, `${order.id} has one email`);
  }
});

await test('replaying a webhook does not duplicate records or emails', async () => {
  const before = (await membershipsFor(shared.family)).map((record) => record.history.length);
  const replay = await pay(shared.familyOrder);
  assert.equal(replay.status, 200);
  assert.deepEqual((await membershipsFor(shared.family)).map((record) => record.history.length), before);
  assert.equal((await db.collection('testMail').where('orderRef', '==', shared.familyOrder).get()).size, 1);
});

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const entry of failed) console.log(`\n${entry.name}\n${entry.error.stack}`); process.exit(1); }
process.exit(0);
