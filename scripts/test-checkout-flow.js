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
const checkout = (emailAddress, { lines, people }, extra = {}) => call('POST', '/api/checkout-session', { body: {
  email: emailAddress, items: lines.map(({ id, lineId }) => ({ id, lineId })), people, billingMode: 'annual', ...extra } });
const pay = async (orderRef) => {
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {
    id: order.stripeSessionId, payment_status: 'paid', amount_total: Math.round(Number(order.total) * 100), metadata: { order_ref: orderRef }, payment_intent: `pi_${orderRef}` } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `t=${timestamp},v1=${createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex')}`;
  return call('POST', '/api/stripe/webhook', { raw: payload, headers: { 'stripe-signature': signature } });
};
const buy = async (emailAddress, basket, extra) => {
  const result = await checkout(emailAddress, basket, extra);
  assert.equal(result.status, 200, `checkout failed: ${result.text}`);
  const webhook = await pay(result.json.orderRef);
  assert.equal(webhook.status, 200, `webhook failed: ${webhook.text}`);
  return result.json.orderRef;
};
const membershipsFor = async (emailAddress) => (await db.collection('memberships').where('email', '==', emailAddress).get()).docs.map((document) => ({ id: document.id, ...document.data() }));

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
  assert.equal(membership.address, '1 River Road');
  assert.equal(membership.emergencyContact.name, 'Pat Friend');
  assert.equal(membership.medical, 'Asthma');
  assert.equal(membership.justgoSyncStatus, 'pending');
  assert.deepEqual([membership.justgoUpload.status, membership.justgoUpload.mode, membership.justgoUpload.attempts], ['queued', 'new', 0], 'queued for the automatic JustGo upload');
  assert.ok(membership.validUntil.toDate() > new Date());
  assert.deepEqual(membership.privileges.map((entry) => entry.productId), ['boat-hire']);
  assert.equal(membership.history.length, 1);
  assert.equal(membership.disclaimerVersion, 1);
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

await test('name lookup reveals only names, and nothing for unknown emails', async () => {
  const known = await call('POST', '/api/membership-names', { body: { email: shared.alex } });
  assert.deepEqual(known.json, { names: [{ firstName: 'Alex', lastName: 'Adult' }] });
  assert.deepEqual((await call('POST', '/api/membership-names', { body: { email: email('nobody') } })).json, { names: [] });
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
  assert.equal(membership.phone, '07700 900333');
  assert.equal(membership.address, '9 Parent Street');
  assert.equal(membership.guardian.name, 'Parent Person');
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
  await db.collection('memberships').doc('sca-E2E-1').set({ scaNumber: `E2E-${run}`, firstName: 'Sam', lastName: 'Synced', email: email('synced'), dob: yearsAgo(40, 2, 2), status: 'active', validUntil: new Date(Date.now() + 90 * 86400000), source: 'justgo', justgoSyncStatus: 'synced', renewalMethod: 'justgo', lastJustgoSync: new Date() });
  const synced = { ...adultDetails({ firstName: 'Sam', lastName: 'Synced', dob: yearsAgo(40, 2, 2), email: email('synced') }), scaNumber: `E2E-${run}` };
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
  const synced = { ...adultDetails({ firstName: 'Sam', lastName: 'Synced', dob: yearsAgo(40, 2, 2), email: email('synced') }), scaNumber: `E2E-${run}` };
  const viaJustgo = await checkout(email('synced'), build(['membership-adult'], [synced]));
  assert.equal(viaJustgo.status, 409);
  assert.equal(viaJustgo.json.code, 'renews_via_justgo');
  assert.match(viaJustgo.json.error, /JustGo/);
  assert.equal((await checkout(email('synced'), build(['keyhire'], [synced]))).status, 200, 'add-ons are still allowed');
});

await test('JustGo members are inactive until the sync confirms their renewal in the club year', async () => {
  const now = new Date();
  const yearStart = new Date(now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1, 2, 1);
  const lapsed = email('unconfirmed');
  const details = adultDetails({ firstName: 'Lou', lastName: 'Unconfirmed', dob: yearsAgo(45, 7, 7), email: lapsed });
  await db.collection('memberships').doc(`sca-E2E-U-${run}`).set({ scaNumber: `E2E-U-${run}`, firstName: 'Lou', lastName: 'Unconfirmed', email: lapsed, dob: details.dob, status: 'active',
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
  const basket = build(['membership-adult'], [{ ...adultDetails({ firstName: 'Vic', lastName: 'Visitor', email: visitor }), scaNumber: `PS-${run}` }]);
  await buy(visitor, basket);
  const [record] = await membershipsFor(visitor);
  assert.equal(record.scaNumber, `PS-${run}`);
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
  assert.equal(new Set(records.map((record) => record.familyGroup)).size, 1);
  assert.ok(records.every((record) => record.address === '1 River Road' && record.phone === '07700 900111'));
  const kid = records.find((record) => record.firstName === 'Kit');
  assert.equal(kid.emergencyNote, 'Parents are the emergency contact');
  assert.equal(kid.medical, 'Hay fever');
  assert.equal(kid.photoConsent, false);
  assert.equal(records.find((record) => record.firstName === 'Casey').emergencyContact.name, 'Pat Friend');
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
  assert.equal(mine.length, 1 + 2 + 3 + 1 + 1 + 1, 'alex 1, parent 2 children, family 3, synced member 1, visitor 1, unconfirmed member 1');
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
