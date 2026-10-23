// End-to-end checkout test: API -> Stripe webhook -> Firestore records -> admin reports.
// Needs the Firebase emulators and an API server (Stripe mocked) already running; see DEVELOPMENT.md.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';
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
  assert.ok(mail.subject.includes(orderRef), 'receipt reference is searchable in the email subject');
  assert.ok(mail.html.includes(orderRef) && mail.html.includes('Receipt Member'), 'formatted email includes the reference and member');
  assert.ok(mail.html.includes(mail.retrievalUrl), 'formatted email links to the saved receipt');
  const linked = await call('GET', `/api/orders/${mail.retrievalUrl.split('/order/')[1]}`);
  assert.equal(linked.status, 200);
  assert.ok(linked.json.items.every((item) => item.personNames.join(', ') === 'Receipt Member'), 'every purchase has its assigned name');
  assert.ok(!('people' in linked.json) && !('receipt' in linked.json), 'raw people and legacy receipt data are not exposed');
  assert.ok(!JSON.stringify(linked.json).includes(receiptEmail) && !JSON.stringify(linked.json).includes(details.dob), 'names do not expose email or DOB');
  assert.equal((await call('GET', `${receiptPath.slice(0, receiptPath.indexOf('&receipt_token='))}&receipt_token=${'0'.repeat(64)}`)).status, 404);
});

await test('admin-chosen person details appear in the receipt email only', async () => {
  assert.equal((await call('GET', '/api/admin/receipt-email')).status, 401);
  assert.equal((await call('POST', '/api/admin/receipt-email', { body: { personFields: ['dob'] } })).status, 401);
  const saved = await call('POST', '/api/admin/receipt-email', { headers: admin, body: { personFields: ['phone', 'dob', 'emergencyContact', 'notAField'] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.personFields, ['dob', 'phone', 'emergencyContact']);
  try {
    const buyer = email('receipt-fields');
    const details = adultDetails({ firstName: 'Fields', lastName: 'Member', email: buyer });
    const started = await checkout(buyer, build(['membership-adult'], [details]));
    assert.equal(started.status, 200);
    assert.equal((await pay(started.json.orderRef)).status, 200);
    const mail = (await db.collection('testMail').where('orderRef', '==', started.json.orderRef).get()).docs[0].data();
    const dob = details.dob.split('-').reverse().join('/');
    for (const content of [mail.body, mail.html]) {
      assert.ok(content.includes(dob) && content.includes('07700 900111') && content.includes('Pat Friend (Friend), 07700 900222'), 'chosen details are emailed');
      assert.ok(!content.includes('Asthma') && !content.includes('1 River Road'), 'unchosen details are not emailed');
    }
    const linked = JSON.stringify((await call('GET', `/api/orders/${mail.retrievalUrl.split('/order/')[1]}`)).json);
    assert.ok(linked.includes('Fields Member') && !linked.includes(dob) && !linked.includes(details.dob) && !linked.includes('07700'), 'the receipt link stays name-only');
  } finally {
    assert.equal((await call('POST', '/api/admin/receipt-email', { headers: admin, body: { personFields: [] } })).status, 200);
  }
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
  assert.equal((await db.collection('discountCodes').doc(voucher.code).get()).data().sourceProductId, 'vouchers');
  const listing = (await call('GET', '/api/admin/discount-codes', { headers: admin })).json;
  assert.ok(!listing.codes.some((entry) => entry.code === voucher.code), 'bought vouchers are not listed one by one');
  assert.ok(listing.vouchers.find((group) => group.productId === 'vouchers').active >= 1, 'bought vouchers are totalled under their shop item');
  const byCode = await call('GET', `/api/admin/customer?q=${voucher.code}`, { headers: admin });
  assert.equal(byCode.json.email, buyer);
  const mail = await db.collection('testMail').where('orderRef', '==', shared.voucherOrder).get();
  assert.equal(mail.size, 1);
  assert.ok(mail.docs[0].data().vouchers.some((entry) => entry.code === voucher.code), 'voucher code is in the receipt email');
  const stored = (await db.collection('customers').get()).docs.map((document) => document.data()).find((record) => record.email === buyer);
  assert.ok(stored.vouchers.some((entry) => entry.code === voucher.code), 'voucher saved on customer record');
});

await test('voucher receipt links show unassigned items without contact details', async () => {
  const mail = (await db.collection('testMail').where('orderRef', '==', shared.voucherOrder).get()).docs[0].data();
  const key = mail.retrievalUrl.split('/order/')[1];
  const receipt = await call('GET', `/api/orders/${key}`);
  assert.equal(receipt.status, 200);
  assert.ok(receipt.json.items.length === 1);
  assert.deepEqual(receipt.json.items[0].personNames, []);
  assert.ok(receipt.json.copy.includes(shared.voucherOrder), 'plain-text saved receipt includes its order reference');
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

await test('a junior can join the household of a member parent or guardian', async () => {
  const parentEmail = email('member-guardian');
  const parent = adultDetails({ firstName: 'Parent', lastName: 'Member', email: parentEmail });
  await buy(parentEmail, build(['membership-adult'], [parent]));
  await buy(parentEmail, build(['membership-junior'], [juniorDetails({
    guardian: { ...juniorDetails().guardian, name: 'Parent Member', email: parentEmail }
  })]));
  const records = await membershipsFor(parentEmail);
  assert.equal(records.length, 2);
  assert.equal(records[0].householdId, records[1].householdId);
  const household = records[0].household;
  assert.equal(household.contactName, 'Parent Member');
  assert.equal(household.contactRelationship, 'Parent');
  assert.equal(household.emergencyContact.name, 'Pat Friend');
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

await test('siblings buying separate junior memberships together share one household', async () => {
  const parentEmail = email('batch-parent');
  const guardian = { ...juniorDetails().guardian, email: parentEmail };
  const basket = build(['membership-junior', 'membership-junior'], [
    juniorDetails({ firstName: 'One', guardian }),
    juniorDetails({ firstName: 'Two', dob: yearsAgo(10, 3, 3), guardian })
  ]);
  await buy(parentEmail, basket);
  const records = await membershipsFor(parentEmail);
  assert.equal(records.length, 2);
  assert.equal(records[0].householdId, records[1].householdId);
});

await test('junior members share a household only when their guardian matches, in checkout, Firestore and reports', async () => {
  const guardianA = {
    name: 'Morgan Guardian', phone: '07700 900441', email: email('guardian-morgan'), relationship: 'Parent',
    address: '41 Shared Road', postcode: 'EH4 4AA'
  };
  const guardianB = {
    name: 'Riley Guardian', phone: '07700 900552', email: email('guardian-riley'), relationship: 'Grandparent',
    address: '52 Separate Road', postcode: 'EH5 5BB'
  };
  const buyer = email('junior-households');
  const basket = build(['membership-junior', 'membership-junior', 'membership-junior'], [
    juniorDetails({ firstName: 'Morgan', lastName: 'Sibling', guardian: guardianA }),
    juniorDetails({ firstName: 'Taylor', lastName: 'Sibling', dob: yearsAgo(10, 4, 4), guardian: guardianA }),
    juniorDetails({ firstName: 'Riley', lastName: 'Other', dob: yearsAgo(11, 7, 7), guardian: guardianB })
  ]);
  const orderRef = await buy(buyer, basket);
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  const memberships = await Promise.all(order.people.map(async (person) => {
    const snapshot = await db.collection('memberships').doc(person.membershipId).get();
    return { id: snapshot.id, ...snapshot.data(), household: (await db.collection('households').doc(snapshot.data().householdId).get()).data() };
  }));
  const morgan = memberships.find((record) => record.firstName === 'Morgan');
  const taylor = memberships.find((record) => record.firstName === 'Taylor');
  const riley = memberships.find((record) => record.firstName === 'Riley');
  assert.equal(morgan.householdId, taylor.householdId, 'siblings with the same named guardian share contact data');
  assert.notEqual(morgan.householdId, riley.householdId, 'different guardians remain separate households');
  assert.deepEqual(
    [morgan.household.contactName, morgan.household.email, morgan.household.phone, morgan.household.address, morgan.household.postcode],
    ['Morgan Guardian', guardianA.email, guardianA.phone, guardianA.address, guardianA.postcode]
  );
  assert.deepEqual(
    [riley.household.contactName, riley.household.contactRelationship, riley.household.email, riley.household.phone],
    ['Riley Guardian', 'Grandparent', guardianB.email, guardianB.phone]
  );
  for (const member of memberships) {
    assert.equal(Object.hasOwn(member, 'email'), false, 'a junior membership does not copy the child email');
    assert.equal(Object.hasOwn(member, 'phone'), false, 'a junior membership does not copy the child phone');
    assert.equal(Object.hasOwn(member, 'guardian'), false, 'guardian details live on the household');
    assert.equal(Object.hasOwn(member.household, 'emergencyContact'), false, 'the guardian is the junior emergency contact');
  }

  const orders = (await call('GET', '/api/admin/reports?kind=orders', { headers: admin })).json.records;
  const report = orders.find((record) => record.id === orderRef);
  assert.equal(report.status, 'paid');
  assert.equal(report.people.length, 3);
  assert.deepEqual(
    [report.people.find((person) => person.name === 'Morgan Sibling').emergencyContact,
      report.people.find((person) => person.name === 'Taylor Sibling').emergencyContact,
      report.people.find((person) => person.name === 'Riley Other').emergencyContact],
    ['Morgan Guardian, Parent, 07700 900441', 'Morgan Guardian, Parent, 07700 900441', 'Riley Guardian, Grandparent, 07700 900552']
  );
  const memberRows = (await call('GET', '/api/admin/reports?kind=members', { headers: admin })).json.records;
  const morganRow = memberRows.find((record) => record.name === 'Morgan Sibling');
  const taylorRow = memberRows.find((record) => record.name === 'Taylor Sibling');
  const rileyRow = memberRows.find((record) => record.name === 'Riley Other');
  assert.deepEqual([morganRow.email, taylorRow.email, rileyRow.email], [guardianA.email, guardianA.email, guardianB.email]);
  assert.deepEqual([morganRow.parent, taylorRow.parent, rileyRow.parent], [
    'Morgan Guardian, Parent, 07700 900441', 'Morgan Guardian, Parent, 07700 900441', 'Riley Guardian, Grandparent, 07700 900552'
  ]);
  shared.juniorHouseholdOrder = orderRef;
  shared.juniorHouseholdEmails = [guardianA.email, guardianB.email];
});

await test('multiple copies of shop services can be bought by different members in one mixed basket', async () => {
  const buyer = email('multi-quantity');
  const basket = build([
    'membership-adult', 'membership-adult',
    'boat-hire', 'boat-hire',
    'keyhire', 'keyhire',
    'gold-sub'
  ], [
    adultDetails({ firstName: 'Quinn', lastName: 'Quantity', email: email('quantity-quinn') }),
    adultDetails({ firstName: 'Avery', lastName: 'Quantity', email: email('quantity-avery'), phone: '07700 900663', address: '63 Double Road', postcode: 'EH6 6CC' })
  ]);
  assert.equal(basket.people.length, 2);
  const orderRef = await buy(buyer, basket);
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.status, 'paid');
  assert.equal(order.items.length, 7);
  assert.deepEqual(
    ['membership-adult', 'boat-hire', 'keyhire', 'gold-sub'].map((id) => order.items.filter((item) => item.id === id).length),
    [2, 2, 2, 1]
  );
  const now = new Date();
  const monthsRemaining = Math.max(1, (now.getMonth() >= 2 ? 1 : 0) * 12 + 2 - now.getMonth());
  const boatPrice = monthsRemaining <= 5 ? 51 : 85;
  const goldPrice = Math.round(30 * monthsRemaining * 0.8 * 100) / 100;
  assert.equal(Number(order.total), 60 + boatPrice * 2 + 100 + goldPrice, 'each member and product line is priced, including the annual gold subscription');
  assert.equal(Number(order.total), order.items.reduce((total, item) => total + Number(item.price), 0));
  assert.deepEqual(
    order.people.map((person) => person.lineIds.map((lineId) => order.items.find((item) => item.lineId === lineId).id).sort())
      .sort((a, b) => a[0].localeCompare(b[0])),
    [['boat-hire', 'keyhire', 'membership-adult'], ['boat-hire', 'gold-sub', 'keyhire', 'membership-adult']]
  );
  const members = await Promise.all(order.people.map(async (person) =>
    (await db.collection('memberships').doc(person.membershipId).get()).data()
  ));
  assert.equal(members.length, 2);
  assert.ok(members.every((member) => member.privileges.some((privilege) => privilege.productId === 'boat-hire')
    && member.privileges.some((privilege) => privilege.productId === 'keyhire')));
  const report = (await call('GET', '/api/admin/reports?kind=orders', { headers: admin })).json.records.find((record) => record.id === orderRef);
  assert.deepEqual(
    ['ANNUAL BOAT & KIT HIRE', 'Boathouse Access', 'GOLD SUBSCRIPTION'].map((name) => report.items.filter((item) => item.name === name).length),
    [2, 2, 1]
  );
  assert.ok(report.items.every((item) => typeof item.price === 'number'));
  assert.deepEqual(report.people.map((person) => person.items.length).sort(), [3, 4]);
  shared.multiQuantityOrder = orderRef;
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
  // Boat hire is prorated: 60% from 1 October to the end of February.
  const boatPrice = [9, 10, 11, 0, 1].includes(new Date().getMonth()) ? 51 : 85;
  assert.equal(Number((await db.collection('orders').doc(scoped.json.orderRef).get()).data().total), Math.round(boatPrice * 0.8 * 100) / 100);
  const notApplicable = await checkout(email('newjoiner'), build(['membership-adult'], [adultDetails({ email: email('newjoiner') })]), { discountCode: code });
  assert.equal(notApplicable.status, 400);
  assert.equal((await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { label: 'Boat 50', discountType: 'multiplier', discountValue: 0.5, productIds: ['boat-hire'] } })).status, 200);
  const edited = await checkout(shared.alex, build(['boat-hire'], [member]), { discountCode: code });
  assert.equal(Number((await db.collection('orders').doc(edited.json.orderRef).get()).data().total), boatPrice * 0.5);
  await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { active: false } });
  assert.equal((await call('POST', '/api/discount-codes/validate', { body: { code } })).json.valid, false);
  await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { active: true } });
  assert.equal((await call('POST', '/api/discount-codes/validate', { body: { code } })).json.valid, true);
});

await test('a voucher limited to events issues codes that only events can use', async () => {
  const voucherId = `E2E-EVENT-VOUCHER-${run}`;
  await db.collection('products').doc(voucherId).set({ name: 'Event voucher', category: 'VOUCHERS', type: 'voucher', basePrice: 20,
    description: 'Test voucher', voucherScope: { categories: ['EVENTS', 'MEMBERSHIP'], productIds: [] } });
  const buyer = email('eventvoucher');
  const orderRef = await buy(buyer, { lines: [{ id: voucherId, lineId: `${voucherId}-line` }], people: [] });
  const voucher = (await db.collection('orders').doc(orderRef).get()).data().vouchers[0];
  const code = (await db.collection('discountCodes').doc(voucher.code).get()).data();
  assert.deepEqual([code.categories, code.productIds, code.sourceProductId], [['EVENTS'], [], voucherId], 'membership is never allowed');
  assert.deepEqual((await call('POST', '/api/discount-codes/validate', { body: { code: voucher.code } })).json.categories, ['EVENTS']);
  const member = { returning: true, firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), disclaimerAccepted: true };
  const hire = await checkout(shared.alex, build(['boat-hire'], [member]), { discountCode: voucher.code });
  assert.equal(hire.status, 400, 'boat hire is not an event');
  await db.collection('products').doc(voucherId).delete();
});

await test('a voucher is accepted once, taken off the price, then shows as used', async () => {
  const member = { returning: true, firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), disclaimerAccepted: true };
  const courseId = `E2E-VOUCHER-COURSE-${run}`;
  const course = {
    id: courseId, name: 'Voucher-funded week course', category: 'EVENTS', type: 'event-ticket', basePrice: 75,
    capacity: 4, eventSchedule: { mode: 'consecutive', startDate: '2027-07-12', startTime: '09:00',
      endTime: '16:00', days: 5, timeZone: 'Europe/London' }
  };
  const { id: _courseId, ...courseFields } = course;
  await db.collection('products').doc(courseId).set(courseFields);
  const line = { ...course, lineId: `${courseId}-line` };
  const people = assignLines([], [line], makeId).map((person) => ({ ...person, ...member }));
  const orderRef = await buy(shared.alex, { lines: [line], people }, { discountCode: shared.voucherCode });
  const paidOrder = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(Number(paidOrder.total), 15);
  assert.equal(paidOrder.items[0].eventSchedule.days, 5);
  assert.equal(paidOrder.people.length, 1);
  shared.voucherRedemptionOrder = orderRef;
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
  const imageUrl = 'https://example.test/course.jpg';
  await db.collection('products').doc(eventId).set({ name: 'E2E five-day course', category: 'EVENTS', type: 'event-ticket', basePrice: 50, eventSchedule: schedule, imageUrl });
  const line = { id: eventId, lineId: `ev-${run}`, name: 'E2E five-day course', category: 'EVENTS', type: 'event-ticket', basePrice: 50 };
  const people = assignLines([], [line], makeId).map((person) => ({ ...person, returning: true, firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), disclaimerAccepted: true }));
  const orderRef = await buy(shared.alex, { lines: [line], people });
  const savedOrder = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(savedOrder.items[0].imageUrl, imageUrl, 'order retains the catalogue event image');
  const mail = (await db.collection('testMail').where('orderRef', '==', orderRef).get()).docs[0].data();
  assert.ok(mail.html.includes(`src="${imageUrl}"`), 'event receipt email displays the saved image');
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
  const drew = family.people.find((person) => person.name === 'Drew Adult');
  const casey = family.people.find((person) => person.name === 'Casey Adult');
  assert.deepEqual([drew.emergencyContact, casey.emergencyContact], [
    'Pat Friend, Friend, 07700 900222', 'Pat Friend, Friend, 07700 900222'
  ]);
  assert.ok(family.people.every((person) => person.address === '1 River Road, EH1 1AA'
    && person.items.includes('CLUB MEMBERSHIP — FAMILY')), 'every family member reports the same household contact and membership');
  const alex = report.json.records.find((record) => record.id === shared.adultOrder);
  assert.equal(alex.people[0].medical, 'Asthma');
  assert.deepEqual(alex.items.map((item) => item.name), ['CLUB MEMBERSHIP — ADULT', 'ANNUAL BOAT & KIT HIRE']);
  assert.ok(alex.items.every((item) => typeof item.price === 'number'));
  const voucherPurchase = report.json.records.find((record) => record.id === shared.voucherOrder);
  assert.equal(voucherPurchase.status, 'paid');
  assert.equal(voucherPurchase.people.length, 0, 'a gift voucher purchase does not create a membership');
  assert.deepEqual(voucherPurchase.items.map((item) => [item.name, item.price]), [['Course place voucher', 60]]);
  const voucherRedemption = report.json.records.find((record) => record.id === shared.voucherRedemptionOrder);
  assert.deepEqual(voucherRedemption.items.map((item) => item.name), ['Voucher-funded week course']);
  assert.equal(voucherRedemption.total, 15);
  const multiQuantity = report.json.records.find((record) => record.id === shared.multiQuantityOrder);
  assert.equal(multiQuantity.items.length, 7);
  assert.equal(multiQuantity.people.length, 2);
});

await test('reports: one member register holds website and JustGo members, complete and readable', async () => {
  const report = await call('GET', '/api/admin/reports?kind=members', { headers: admin });
  assert.equal(report.status, 200);
  const mine = report.json.records.filter((record) => record.email.endsWith(`.${run}@example.test`));
  assert.equal(mine.length, 1 + 2 + 3 + 3 + 1 + 1 + 1 + 2 + 1 + 1 + 1 + 2, 'alex 1, parent 2 children, family 3, guardian-grouped juniors 3, synced member 1, visitor 1, unconfirmed member 1, Stripe members 2, coaching member 1, receipt member 1, legacy member 1, multi-quantity members 2');
  const alex = mine.find((record) => record.id === shared.alexMembership);
  assert.equal(alex.name, 'Alex Adult');
  assert.equal(alex.tier, 'adult');
  assert.equal(alex.status, 'Current');
  assert.deepEqual(alex.privileges.sort(), ['ANNUAL BOAT & KIT HIRE', 'Boathouse Access', 'BLUE SUBSCRIPTION'].sort());
  assert.equal(alex.history.length, 5, 'membership, key hire, subscription, voucher-paid course and the event ticket');
  assert.ok(alex.history.every((entry) => entry.orderRef && entry.paidAt && entry.items.length));
  assert.equal(alex.justgoSync, 'pending');
  assert.equal(alex.address, '1 River Road, EH1 1AA');
  for (const record of mine) for (const [key, value] of Object.entries(record)) {
    if (!['privileges', 'history', 'photoConsent'].includes(key)) assert.ok(['string', 'object', 'number'].includes(typeof value) && !Array.isArray(value) || value === null, `${key} is displayable`);
  }
  assert.ok(mine.some((record) => record.householdId));
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

await test('API responses carry security headers and CORS only answers approved origins', async () => {
  const approved = await call('GET', '/api/availability', { headers: { Origin: 'https://staging.example.test' } });
  const headers = (await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: apiPort, path: '/api/availability',
    headers: { Origin: 'https://staging.example.test' } }, (response) => { response.resume(); resolve(response.headers); }).on('error', reject)));
  assert.equal(approved.status, 200);
  assert.equal(headers['access-control-allow-origin'], 'https://staging.example.test');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.match(headers['content-security-policy'], /default-src 'none'/);
  assert.equal(headers['x-powered-by'], undefined);
  const blocked = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: apiPort, path: '/api/availability',
    headers: { Origin: 'https://attacker.example.test' } }, (response) => { response.resume(); resolve(response.headers); }).on('error', reject));
  assert.equal(blocked['access-control-allow-origin'], undefined);
});

await test('receipt links are never cached or sent as a referrer, and the unpaid order endpoint is gone', async () => {
  for (const path of ['/api/orders/FCC-NOPE.token', '/api/checkout-receipt?session_id=cs_x&receipt_token=y', '/order/FCC-NOPE.token', '/payment-success?receipt_token=y']) {
    const headers = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: apiPort, path }, (response) => { response.resume(); resolve(response.headers); }).on('error', reject));
    assert.equal(headers['cache-control'], 'no-store', path);
    assert.equal(headers['referrer-policy'], 'no-referrer', path);
  }
  const legacy = await call('POST', '/api/orders', { body: { email: email('legacy'), items: [{ id: 'keyhire' }], total: '0' } });
  assert.equal(legacy.status, 404);
  assert.equal((await db.collection('orders').where('email', '==', email('legacy')).get()).size, 0);
});

const LIST_EXAMPLES = {
  'Equipment Needed': ['What equipment do you need?: 2 paddles, 1 buoyancy aid', 'What date do you need it by?: 14 March'],
  'Volunteer Sign-ups': ['Which activities would you like to help with?: coaching', 'When are you available?: Thursday evenings'],
  'Event Participants': ['Which event?: Loch Lomond paddle', 'How many people are attending?: 3'],
  'Maintenance Tasks': ['What needs doing?: Fix the boat rack', 'Where is it?: boathouse'],
  Other: ['Tell us what you would like to add: =HYPERLINK("http://example.test")']
};

await test('every volunteering-page list type is stored, and bad submissions are rejected', async () => {
  for (const [category, items] of Object.entries(LIST_EXAMPLES)) {
    const submitter = email(`list-${category.split(' ')[0].toLowerCase()}`);
    const response = await call('POST', '/api/lists', { body: { name: 'List Tester', email: submitter, category, items, notes: 'From the flow test' } });
    assert.equal(response.status, 200, `${category}: ${response.text}`);
    assert.deepEqual(response.json, { success: true });
    const stored = (await db.collection('lists').where('email', '==', submitter).get()).docs.map((document) => document.data());
    assert.equal(stored.length, 1);
    assert.equal(stored[0].listType, category);
    assert.deepEqual(stored[0].items, items, 'answers are stored as written');
  }
  for (const body of [
    { name: 'X', email: 'bad', category: 'Other', items: ['a'] }, { name: 'X', email: email('bad-type'), category: 'Admin', items: ['a'] },
    { name: 'X', email: email('no-items'), category: 'Other', items: [] }, { name: 'X'.repeat(200), email: email('long'), category: 'Other', items: ['a'] }
  ]) assert.equal((await call('POST', '/api/lists', { body })).status, 400, JSON.stringify(body).slice(0, 50));
});

await test('a volunteer is linked to a member only when the name and email both match, and gets no code from the form', async () => {
  const memberEmail = email('volunteer-member');
  await buy(memberEmail, build(['membership-adult'], [adultDetails({ firstName: 'Vera', lastName: 'Volunteer', email: memberEmail })]));
  const [member] = await membershipsFor(memberEmail);
  const matched = await call('POST', '/api/lists', { body: { name: 'vera  volunteer', email: memberEmail.toUpperCase(), category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
  const nameOnly = await call('POST', '/api/lists', { body: { name: 'Vera Volunteer', email: email('impostor'), category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
  assert.deepEqual(matched.json, { success: true });
  assert.deepEqual(nameOnly.json, { success: true }, 'the response does not reveal whether a member matched');
  const linked = (await db.collection('lists').where('email', '==', memberEmail).get()).docs[0];
  assert.equal(linked.data().memberId, member.id);
  assert.equal(linked.data().discountCode, null);
  assert.equal((await db.collection('memberships').doc(member.id).get()).data().volunteer.inducted, false);
  assert.equal((await db.collection('lists').where('email', '==', email('impostor')).get()).docs[0].data().memberId, null);
  assert.equal((await db.collection('discountCodes').where('email', '==', memberEmail).get()).size, 0);
  shared.volunteerSignup = linked.id;
  shared.volunteerEmail = memberEmail;
  shared.volunteerMemberId = member.id;
});

await test('ticking "inducted" on a member volunteer issues and emails one thank-you code', async () => {
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { body: { inducted: true } })).status, 401);
  const listed = await call('GET', '/api/admin/volunteers', { headers: admin });
  assert.equal(listed.status, 200);
  const row = listed.json.volunteers.find((volunteer) => volunteer.id === shared.volunteerSignup);
  assert.equal(row.memberStatus, 'active');
  assert.equal(row.inducted, false);
  const inducted = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { inducted: true } });
  assert.equal(inducted.json.outcome, 'issued', inducted.text);
  const signup = (await db.collection('lists').doc(shared.volunteerSignup).get()).data();
  assert.match(signup.discountCode, /^VOL-[0-9A-F]{10}$/);
  assert.equal(signup.codeEmailed, true);
  const code = (await db.collection('discountCodes').doc(signup.discountCode).get()).data();
  assert.equal(code.discountType, 'multiplier');
  assert.equal(code.singleUse, true);
  assert.deepEqual(code.excludedCategories, ['MEMBERSHIP']);
  const mail = (await db.collection('testMail').where('signupId', '==', shared.volunteerSignup).get()).docs.map((document) => document.data());
  assert.equal(mail.length, 1);
  assert.equal(mail[0].email, shared.volunteerEmail);
  assert.ok(mail[0].body.includes(signup.discountCode));
  assert.equal((await db.collection('memberships').doc(shared.volunteerMemberId).get()).data().volunteer.inducted, true);
  assert.equal((await call('POST', '/api/discount-codes/validate', { body: { code: signup.discountCode } })).json.valid, true, 'the code works in the shop');

  const again = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { inducted: true } });
  assert.equal(again.json.outcome, 'issued');
  assert.equal((await db.collection('testMail').where('signupId', '==', shared.volunteerSignup).get()).size, 1, 'no second code or email');
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { inducted: false } })).status, 409);
});

await test('a non-member volunteer inducted first gets their code when a membership is bought for them', async () => {
  const volunteerEmail = email('volunteer-joiner');
  await call('POST', '/api/lists', { body: { name: 'Nina Newcomer', email: volunteerEmail, category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
  const signupId = (await db.collection('lists').where('email', '==', volunteerEmail).get()).docs[0].id;
  const pending = await call('PATCH', `/api/admin/volunteers/${signupId}`, { headers: admin, body: { inducted: true } });
  assert.equal(pending.json.outcome, 'awaiting-membership');
  assert.equal((await db.collection('lists').doc(signupId).get()).data().discountCode, null);
  const listed = (await call('GET', '/api/admin/volunteers', { headers: admin })).json.volunteers.find((volunteer) => volunteer.id === signupId);
  assert.equal(listed.memberStatus, 'not a member');

  await buy(volunteerEmail, build(['vouchers'], []));
  assert.equal((await db.collection('lists').doc(signupId).get()).data().discountCode, null, 'a non-membership purchase does not count');
  // Someone else pays: the volunteer's own contact email on the membership is what links them.
  await buy(email('volunteer-payer'), build(['membership-adult'], [adultDetails({ firstName: 'Nina', lastName: 'Newcomer', email: volunteerEmail })]));
  const signup = (await db.collection('lists').doc(signupId).get()).data();
  assert.match(signup.discountCode || '', /^VOL-/);
  assert.ok(signup.memberId);
  assert.equal((await db.collection('testMail').where('signupId', '==', signupId).get()).size, 1);
});

await test('admins save the boathouse code privately; only a changed code bumps its version', async () => {
  assert.equal((await call('GET', '/api/admin/boathouse-code')).status, 401);
  assert.equal((await call('POST', '/api/admin/boathouse-code', { body: { code: '1111' } })).status, 401);
  assert.equal((await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { code: '' } })).status, 400);
  const before = (await call('GET', '/api/admin/boathouse-code', { headers: admin })).json;
  const code = `B${run}`.slice(0, 40);
  const saved = await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { code, note: 'Side door padlock' } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.changed, true);
  assert.equal(saved.json.version, before.version + 1);
  const loaded = (await call('GET', '/api/admin/boathouse-code', { headers: admin })).json;
  assert.equal(loaded.code, code);
  assert.equal(loaded.note, 'Side door padlock');
  assert.equal(loaded.updatedBy, 'admin@forthcanoeclub.co.uk');
  const noteOnly = await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { code, note: 'Main door' } });
  assert.equal(noteOnly.json.changed, false);
  assert.equal(noteOnly.json.version, saved.json.version);
  assert.equal((await db.collection('settings').doc('boathouseCode').get()).data().note, 'Main door');
});

await test('active volunteers who are inducted members get the boathouse code once, and again when it changes', async () => {
  const codeMail = async (signupId) => (await db.collection('testMail').where('signupId', '==', signupId).get()).docs
    .map((document) => document.data()).filter((mail) => mail.kind === 'boathouse-code');
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { body: { active: true } })).status, 401);
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: 'yes' } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: true, inducted: true } })).status, 400);

  const ticked = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: true } });
  assert.equal(ticked.status, 200, ticked.text);
  assert.equal(ticked.json.boathouseCode, 'sent');
  const current = (await db.collection('settings').doc('boathouseCode').get()).data();
  const [first] = await codeMail(shared.volunteerSignup);
  assert.match(first.body, new RegExp(current.code));
  assert.equal(first.version, current.version);
  const again = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: true } });
  assert.equal(again.json.boathouseCode, 'up-to-date');
  assert.equal((await codeMail(shared.volunteerSignup)).length, 1, 'no repeat email');
  const listed = (await call('GET', '/api/admin/volunteers', { headers: admin })).json;
  assert.equal(listed.boathouseCodeSet, true);
  const row = listed.volunteers.find((volunteer) => volunteer.id === shared.volunteerSignup);
  assert.equal(row.active, true);
  assert.equal(row.boathouseCodeCurrent, true);

  // Active but not inducted: nothing is sent.
  const newcomerEmail = email('volunteer-not-inducted');
  await call('POST', '/api/lists', { body: { name: 'Otto Outsider', email: newcomerEmail, category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
  const newcomerId = (await db.collection('lists').where('email', '==', newcomerEmail).get()).docs[0].id;
  assert.equal((await call('PATCH', `/api/admin/volunteers/${newcomerId}`, { headers: admin, body: { active: true } })).json.boathouseCode, 'not-active');
  assert.equal((await codeMail(newcomerId)).length, 0);

  const noteOnly = await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { code: current.code, note: 'Back door' } });
  assert.equal(noteOnly.json.changed, false);
  assert.equal((await codeMail(shared.volunteerSignup)).length, 1, 'a note-only save emails nobody');

  const changed = await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { code: `C${run}`.slice(0, 40), note: 'Back door' } });
  assert.equal(changed.json.changed, true);
  assert.ok(changed.json.notified.sent >= 1, changed.text);
  const mails = await codeMail(shared.volunteerSignup);
  assert.equal(mails.length, 2);
  assert.ok(mails.some((mail) => mail.version === changed.json.version && /has changed/.test(mail.body)));
  assert.equal((await codeMail(newcomerId)).length, 0, 'still nothing for a volunteer who is not inducted');

  const untick = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: false } });
  assert.equal(untick.json.boathouseCode, 'not-active');
  await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { code: `D${run}`.slice(0, 40) } });
  assert.equal((await codeMail(shared.volunteerSignup)).length, 2, 'inactive volunteers are not emailed new codes');
});

await test('an active volunteer gets the boathouse code when checked in, or when they join after induction', async () => {
  const codeMail = async (signupId) => (await db.collection('testMail').where('signupId', '==', signupId).get()).docs
    .map((document) => document.data()).filter((mail) => mail.kind === 'boathouse-code');
  const signUp = async (name, address) => {
    await call('POST', '/api/lists', { body: { name, email: address, category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
    return (await db.collection('lists').where('email', '==', address).get()).docs[0].id;
  };
  const patch = async (signupId, body) => (await call('PATCH', `/api/admin/volunteers/${signupId}`, { headers: admin, body })).json;

  const memberEmail = email('boathouse-member');
  await buy(memberEmail, build(['membership-adult'], [adultDetails({ firstName: 'Bea', lastName: 'Boathouse', email: memberEmail })]));
  const memberSignup = await signUp('Bea Boathouse', memberEmail);
  assert.equal((await patch(memberSignup, { active: true })).boathouseCode, 'not-active', 'not checked in yet');
  assert.equal((await codeMail(memberSignup)).length, 0);
  const checkedIn = await patch(memberSignup, { inducted: true });
  assert.equal(checkedIn.outcome, 'issued');
  assert.equal(checkedIn.boathouseCode, 'sent');
  assert.equal((await codeMail(memberSignup)).length, 1);
  assert.equal((await patch(memberSignup, { inducted: true })).boathouseCode, 'up-to-date', 'checking in again sends nothing new');
  assert.equal((await codeMail(memberSignup)).length, 1);

  const joinerEmail = email('boathouse-joiner');
  const joinerSignup = await signUp('Jo Joiner', joinerEmail);
  await patch(joinerSignup, { active: true });
  const awaiting = await patch(joinerSignup, { inducted: true });
  assert.equal(awaiting.outcome, 'awaiting-membership');
  assert.equal(awaiting.boathouseCode, 'not-active');
  await buy(joinerEmail, build(['membership-adult'], [adultDetails({ firstName: 'Jo', lastName: 'Joiner', email: joinerEmail })]));
  assert.equal((await codeMail(joinerSignup)).length, 1, 'joining sends the boathouse code to a checked-in active volunteer');
  assert.match((await db.collection('lists').doc(joinerSignup).get()).data().discountCode || '', /^VOL-/);
});

await test('admins record PVG and safeguarding expiry dates on a volunteer member and see their status', async () => {
  const memberId = (await db.collection('lists').doc(shared.volunteerSignup).get()).data().memberId;
  assert.ok(memberId);
  const path = `/api/admin/memberships/${memberId}/checks`;
  const day = (offset) => new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  assert.equal((await call('PATCH', path, { body: { pvg: day(400) } })).status, 401);
  assert.equal((await call('PATCH', path, { headers: admin, body: { pvg: '31/12/2030' } })).status, 400);
  assert.equal((await call('PATCH', path, { headers: admin, body: { dbs: day(400) } })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/memberships/no-such-member/checks', { headers: admin, body: { pvg: day(400) } })).status, 404);

  const saved = await call('PATCH', path, { headers: admin, body: { pvg: day(400), safeguarding: day(30) } });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.checks, { pvg: { expiresOn: day(400), status: 'active' }, safeguarding: { expiresOn: day(30), status: 'due' } });
  const stored = (await db.collection('memberships').doc(memberId).get()).data().checks;
  assert.equal(stored.pvg.updatedBy, 'admin@forthcanoeclub.co.uk');
  const row = (await call('GET', '/api/admin/volunteers', { headers: admin })).json.volunteers.find((volunteer) => volunteer.id === shared.volunteerSignup);
  assert.equal(row.checks.safeguarding.status, 'due');

  const expired = await call('PATCH', path, { headers: admin, body: { pvg: day(-1) } });
  assert.equal(expired.json.checks.pvg.status, 'expired');
  assert.equal(expired.json.checks.safeguarding.status, 'due', 'an update to one check leaves the other alone');
  let register = [];
  for (let cursor = null, page = 0; page < 20; page += 1) {
    const result = (await call('GET', `/api/admin/reports?kind=members${cursor ? `&cursor=${cursor}` : ''}`, { headers: admin })).json;
    register = register.concat(result.records);
    if (register.some((record) => record.id === memberId) || !(cursor = result.nextCursor)) break;
  }
  assert.match(register.find((record) => record.id === memberId)?.pvg || '', /^Expired \(/);

  const cleared = await call('PATCH', path, { headers: admin, body: { pvg: '', safeguarding: '' } });
  assert.deepEqual(cleared.json.checks.pvg, { expiresOn: '', status: 'none' });
  assert.equal((await db.collection('memberships').doc(memberId).get()).data().checks.pvg, undefined);
});

await test('single-day trips are £10 off with annual boat hire and £10 off with a subscription, held or in the basket', async () => {
  const single = { mode: 'single', startDate: '2027-05-01', startTime: '09:00', endTime: '17:00', days: 1, timeZone: 'Europe/London' };
  const tripId = `E2E-TRIP-${run}`;
  const courseId = `E2E-TRIP-COURSE-${run}`;
  await db.collection('products').doc(tripId).set({ name: 'E2E river trip', category: 'EVENTS', type: 'event-ticket', basePrice: 35, eventSchedule: single });
  await db.collection('products').doc(courseId).set({ name: 'E2E two-day course', category: 'EVENTS', type: 'event-ticket', basePrice: 35,
    eventSchedule: { ...single, mode: 'consecutive', days: 2 } });
  let ticket = 0;
  const event = (id) => ({ id, lineId: `${id}-${++ticket}`, name: id, category: 'EVENTS', type: 'event-ticket', basePrice: 35 });
  const basket = (productIds, events, details) => {
    const lines = [...productIds.map(lineFor), ...events.map(event)];
    return { lines, people: assignLines([], lines, makeId).map((person) => ({ ...person, ...details })) };
  };
  const ticketLines = async (orderRef) => (await db.collection('orders').doc(orderRef).get()).data().items.filter((item) => item.category === 'EVENTS');

  const tripper = email('tripper');
  const details = adultDetails({ firstName: 'Tia', lastName: 'Tripper', email: tripper });
  const returning = { returning: true, firstName: 'Tia', lastName: 'Tripper', dob: details.dob, disclaimerAccepted: true };
  const first = await ticketLines(await buy(tripper, basket(['membership-adult', 'boat-hire'], [tripId, courseId], details)));
  assert.deepEqual(first.map((item) => [item.id, item.price, item.tripDiscount]), [[tripId, 25, 10], [courseId, 35, undefined]],
    'boat hire in the same basket discounts the single-day trip only');
  assert.deepEqual(first[0].tripDiscountReasons, ['annual boat hire']);

  const held = await ticketLines(await buy(tripper, basket([], [tripId], returning)));
  assert.equal(held[0].price, 25, 'boat hire bought earlier this club year still counts');
  await buy(tripper, basket(['blue-sub'], [], returning));
  const both = await ticketLines(await buy(tripper, basket([], [tripId], returning)));
  assert.equal(both[0].price, 15);
  assert.equal(both[0].tripDiscount, 20);

  const keyholder = email('keyholder');
  const keyOnly = await ticketLines(await buy(keyholder, basket(['membership-adult', 'keyhire'], [tripId], adultDetails({ firstName: 'Kay', lastName: 'Holder', email: keyholder }))));
  assert.equal(keyOnly[0].price, 35, 'key hire gives no trip discount');

  const forgedBasket = basket([], [tripId], { returning: true, firstName: 'Kay', lastName: 'Holder', dob: details.dob, disclaimerAccepted: true });
  const forged = await checkout(keyholder, forgedBasket, { items: forgedBasket.lines.map(({ id, lineId }) => ({ id, lineId, tripDiscount: 35, price: 0 })) });
  assert.equal(forged.status, 200, forged.text);
  assert.equal((await ticketLines(forged.json.orderRef))[0].price, 35, 'the browser cannot send its own discount');

  const freeTripId = `E2E-FREE-TRIP-${run}`;
  await db.collection('products').doc(freeTripId).set({ name: 'E2E free river trip', category: 'EVENTS', type: 'event-ticket', basePrice: 20, eventSchedule: single });
  const freeLines = [{ ...event(freeTripId), basePrice: 20 }];
  const started = await checkout(tripper, { lines: freeLines, people: assignLines([], freeLines, makeId).map((person) => ({ ...person, ...returning })) });
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.free, true, 'a trip discounted to £0 skips Stripe');
  const successUrl = new URL(started.json.checkoutUrl);
  assert.equal(successUrl.pathname, '/payment-success');
  assert.match(started.json.sessionId, /^cs_free_[a-f0-9]{32}$/);
  const freeOrder = (await db.collection('orders').doc(started.json.orderRef).get()).data();
  assert.deepEqual([freeOrder.status, freeOrder.total, freeOrder.paymentMethod, freeOrder.items[0].price, freeOrder.items[0].tripDiscount], ['paid', '0', 'free', 0, 20]);
  assert.equal((await call('GET', `/api/checkout-status?session_id=${started.json.sessionId}`)).json.status, 'paid');
  const freeReceipt = await call('GET', `/api/checkout-receipt?session_id=${started.json.sessionId}&receipt_token=${successUrl.searchParams.get('receipt_token')}`);
  assert.equal(freeReceipt.status, 200, freeReceipt.text);
  assert.equal(freeReceipt.json.receipt.payerEmail, tripper);
  const freeMail = await db.collection('testMail').where('orderRef', '==', started.json.orderRef).get();
  assert.equal(freeMail.size, 1, 'the free booking is emailed a receipt');
});

await test('events open to non-members keep them as contacts, close on time and email the leader an attendee list', async () => {
  const schedule = { mode: 'consecutive', startDate: '2027-06-05', startTime: '09:00', endTime: '16:00', days: 2, timeZone: 'Europe/London' };
  const openId = `E2E-OPEN-${run}`;
  const closedId = `E2E-CLOSED-${run}`;
  const memberOnlyId = `E2E-MEMBERS-${run}`;
  const leader = email('leader');
  await db.collection('products').doc(openId).set({ name: 'E2E open day', category: 'EVENTS', type: 'event-ticket', basePrice: 20, eventSchedule: schedule,
    membershipRequired: false, leaderName: 'Lee Leader', leaderEmail: leader, closeDate: '2027-06-01' });
  await db.collection('products').doc(closedId).set({ name: 'E2E closed day', category: 'EVENTS', type: 'event-ticket', basePrice: 20, eventSchedule: schedule,
    membershipRequired: false, closeDate: '2020-01-01', leaderEmail: leader });
  await db.collection('products').doc(memberOnlyId).set({ name: 'E2E members day', category: 'EVENTS', type: 'event-ticket', basePrice: 20, eventSchedule: schedule });
  const ticket = (id) => ({ id, lineId: `${id}-${makeId()}`, name: id, category: 'EVENTS', type: 'event-ticket', basePrice: 20 });
  const visitor = email('openday');
  const details = adultDetails({ firstName: 'Vic', lastName: 'Visitor', email: visitor, medical: 'Nut allergy' });
  const basket = (id, over = {}) => {
    const lines = [ticket(id)];
    return { lines, people: assignLines([], lines, makeId).map((person) => ({ ...person, ...details, ...over(lines) })) };
  };

  const closed = await checkout(visitor, basket(closedId, () => ({})));
  assert.equal(closed.status, 400);
  assert.match(closed.json.error, /Bookings for E2E closed day have closed/);

  const orderRef = await buy(visitor, basket(openId, (lines) => ({ ownKitLineIds: [lines[0].lineId] })));
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.items[0].ownKit, true, 'the own-kit tick is kept on the ticket');
  const contact = (await db.collection('memberships').doc(order.people[0].membershipId).get()).data();
  assert.equal(contact.contactOnly, true);
  assert.equal(contact.status, undefined, 'a non-member gets no membership status');
  assert.equal(contact.ownKitLineIds, undefined);
  let register = [];
  for (let cursor = null, page = 0; page < 20; page += 1) {
    const result = (await call('GET', `/api/admin/reports?kind=members${cursor ? `&cursor=${cursor}` : ''}`, { headers: admin })).json;
    register = register.concat(result.records);
    if (!(cursor = result.nextCursor)) break;
  }
  assert.ok(register.length > 0);
  assert.ok(!register.some((record) => record.id === order.people[0].membershipId), 'contacts stay out of the member register');

  const membersOnly = await checkout(visitor, basket(memberOnlyId, () => ({ returning: true, firstName: 'Vic', lastName: 'Visitor', dob: details.dob })));
  assert.equal(membersOnly.status, 409);
  assert.equal(membersOnly.json.code, 'membership_required');
  assert.match(membersOnly.json.error, /on our contact list .* not a club member/);
  const again = await buy(visitor, basket(openId, () => ({ returning: true, firstName: 'Vic', lastName: 'Visitor', dob: details.dob })));
  assert.ok(again, 'a contact can book another open event with just their date of birth');

  const path = `/api/admin/events/${openId}/roster`;
  assert.equal((await call('GET', path, { headers: admin })).json.sentAt, 0);
  assert.equal((await call('POST', path)).status, 401);
  const sent = await call('POST', path, { headers: admin });
  assert.equal(sent.status, 200, sent.text);
  assert.deepEqual([sent.json.attendees, sent.json.sentTo], [2, leader]);
  const mail = (await db.collection('testMail').where('productId', '==', openId).get()).docs.map((document) => document.data());
  assert.equal(mail.length, 1);
  assert.equal(mail[0].email, leader);
  assert.match(mail[0].subject, /^Attendee list: E2E open day/);
  assert.match(mail[0].body, /^Hello Lee Leader,/);
  assert.match(mail[0].body, /Vic Visitor \(Adult, born .*\n {3}Phone: 07700 900111 .*\n {3}Emergency contact: Pat Friend, Friend, 07700 900222\n {3}Medical: Nut allergy/);
  assert.match(mail[0].body, /Kit: Bringing own kit/);
  assert.match(mail[0].body, /Kit: Needs boat hire \(not paid\)/);
  assert.match(mail[0].body, /Membership: Not a member/);
  const status = (await call('GET', path, { headers: admin })).json;
  assert.deepEqual([status.sentTo, status.attendees, status.trigger], [leader, 2, 'admin']);
  assert.equal((await call('POST', `/api/admin/events/${memberOnlyId}/roster`, { headers: admin })).status, 400, 'no leader email to send to');
});

await test('a membership-included product makes each buyer a member, by age, until 1 March', async () => {
  const schedule = { mode: 'weekly', startDate: '2027-05-01', startTime: '10:00', endTime: '12:00', weeks: 6, timeZone: 'Europe/London' };
  const courseId = `E2E-INCLUDED-${run}`;
  const tasterId = `E2E-TASTER-${run}`;
  await db.collection('products').doc(courseId).set({ name: 'E2E beginner course', category: 'EVENTS', type: 'event-ticket', basePrice: 90, eventSchedule: schedule, membershipRule: 'included' });
  await db.collection('products').doc(tasterId).set({ name: 'E2E taster service', category: 'SERVICES', type: 'yearly-service', pricingMode: 'fixed', basePrice: 5, membershipRule: 'none' });
  const line = (id, category) => ({ id, lineId: `${id}-${makeId()}`, name: id, category });
  const basket = (id, category, details) => {
    const lines = [line(id, category)];
    return { lines, people: assignLines([], lines, makeId).map((person) => ({ ...person, ...details })) };
  };
  const adultEmail = email('included-adult');
  const adult = adultDetails({ firstName: 'Ida', lastName: 'Included', email: adultEmail });
  const orderRef = await buy(adultEmail, basket(courseId, 'EVENTS', adult));
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.items[0].membershipRule, 'included');
  assert.equal(order.people[0].grantMembership, true);
  const member = (await db.collection('memberships').doc(order.people[0].membershipId).get()).data();
  assert.equal(member.status, 'active');
  assert.equal(member.membershipTier, 'adult');
  assert.equal(member.contactOnly, undefined);
  assert.equal(member.grantMembership, undefined, 'the checkout flag is not copied onto the member');
  assert.equal(member.validUntil.toDate().getUTCMonth(), 2, 'membership runs to 1 March');
  assert.equal(member.justgoUpload.status, 'queued');
  assert.deepEqual(member.membershipIncludedWith, { productId: courseId, name: 'E2E beginner course', orderRef });

  const juniorEmail = email('included-junior');
  const junior = juniorDetails({ junior: true, firstName: 'Ivy', lastName: 'Included', guardian: { ...juniorDetails().guardian, email: juniorEmail } });
  const juniorOrder = (await db.collection('orders').doc(await buy(juniorEmail, basket(courseId, 'EVENTS', junior))).get()).data();
  assert.equal((await db.collection('memberships').doc(juniorOrder.people[0].membershipId).get()).data().membershipTier, 'junior');

  const returning = { returning: true, firstName: 'Ida', lastName: 'Included', dob: adult.dob, disclaimerAccepted: true };
  const hire = await checkout(adultEmail, basket('boat-hire', 'SERVICES', returning));
  assert.equal(hire.status, 200, `the new member can buy members-only items: ${hire.text}`);
  const repeatRef = await buy(adultEmail, basket(courseId, 'EVENTS', returning));
  const repeat = (await db.collection('orders').doc(repeatRef).get()).data();
  assert.equal(repeat.people[0].grantMembership, undefined, 'an active member keeps their existing membership');
  assert.equal((await db.collection('memberships').doc(repeat.people[0].membershipId).get()).data().membershipIncludedWith.orderRef, orderRef);

  const visitor = email('taster');
  const tasterOrder = (await db.collection('orders').doc(await buy(visitor, basket(tasterId, 'SERVICES', adultDetails({ firstName: 'Tess', lastName: 'Taster', email: visitor })))).get()).data();
  assert.equal(tasterOrder.items[0].membershipRule, 'none');
  assert.equal((await db.collection('memberships').doc(tasterOrder.people[0].membershipId).get()).data().contactOnly, true, 'open services keep non-members as contacts');
});

await test('a payer has one monthly subscription for everyone they pay for, and staff can stop one member\'s items', async () => {
  const lessonId = `E2E-LESSONS-${run}`;
  await db.collection('products').doc(lessonId).set({ name: 'E2E lesson block', category: 'SERVICES', pricingMode: 'subscription', allowMonthly: true, basePrice: 20, membershipRule: 'none' });
  const lessonLine = () => ({ id: lessonId, lineId: `${lessonId}-${makeId()}`, name: 'E2E lesson block', category: 'SERVICES', type: 'subscription', pricingMode: 'subscription', allowMonthly: true, basePrice: 20 });
  const lessonFor = (firstName) => {
    const lines = [lessonLine()];
    return { lines, people: assignLines([], lines, makeId).map((person) => ({ ...person, ...adultDetails({ firstName, lastName: 'Monthly', dob: yearsAgo(20), email: email(firstName.toLowerCase()) }) })) };
  };
  const payer = email('monthly-split');
  const lines = [...['membership-adult', 'membership-adult', 'gold-sub', 'gold-sub'].map(lineFor), lessonLine()];
  const basket = { lines, people: assignLines([], lines, makeId).map((person, index) => ({ ...person, ...adultDetails(index === 0
    ? { firstName: 'Mona', lastName: 'Monthly', email: payer }
    : { firstName: 'Ben', lastName: 'Monthly', dob: yearsAgo(30), email: email('monthly-partner') }) })) };
  assert.equal(basket.people.length, 2);
  const orderRef = await buy(payer, basket, { billingMode: 'monthly' });
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.subscriptionPlan.kind, 'new');
  assert.equal(order.stripeSubscriptionIds.length, 1, 'one Stripe subscription (one direct debit) for everything the payer pays monthly');
  const [subscriptionId] = order.stripeSubscriptionIds;
  assert.ok(order.items.filter((item) => item.monthly).every((item) => item.stripeSubscriptionId === subscriptionId && item.stripeSubscriptionItemId), 'every monthly line knows its Stripe item');
  assert.equal(order.subscriptionSetupNeedsStaff, false);
  const customerKey = (address) => createHash('sha256').update(address).digest('hex');
  assert.deepEqual((await db.collection('customers').doc(customerKey(payer)).get()).data().subscriptionIds, [subscriptionId]);

  const monaId = order.people.find((person) => person.firstName === 'Mona').membershipId;
  const benId = order.people.find((person) => person.firstName === 'Ben').membershipId;
  const listed = await call('GET', `/api/admin/subscriptions?orderRef=${orderRef}`, { headers: admin });
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.json.subscriptions.map((entry) => entry.id), [subscriptionId]);
  const items = listed.json.subscriptions[0].items;
  assert.deepEqual(items.filter((item) => item.membershipIds.includes(benId)).map((item) => item.productId), ['gold-sub']);
  assert.deepEqual(items.filter((item) => item.membershipIds.includes(monaId)).map((item) => item.productId).sort(), [lessonId, 'gold-sub'].sort());
  const benBefore = (await db.collection('memberships').doc(benId).get()).data();
  assert.deepEqual(benBefore.subscriptionItems.map(({ subscriptionId: id, productId, payerEmail, status }) => ({ id, productId, payerEmail, status })),
    [{ id: subscriptionId, productId: 'gold-sub', payerEmail: payer, status: 'active' }], 'Ben\'s record shows what he gets and who pays');
  const benList = await call('GET', `/api/admin/subscriptions?membershipId=${benId}`, { headers: admin });
  assert.deepEqual(benList.json.subscriptions.map((entry) => entry.id), [subscriptionId]);

  assert.equal((await call('POST', `/api/admin/subscriptions/${subscriptionId}/members/${benId}/cancel`)).status, 401, 'cancelling needs an admin');
  const benCancelled = await call('POST', `/api/admin/subscriptions/${subscriptionId}/members/${benId}/cancel`, { headers: admin });
  assert.equal(benCancelled.status, 200, benCancelled.text);
  assert.equal(benCancelled.json.cancelledWholeSubscription, false);
  assert.equal(benCancelled.json.subscription.status, 'active', 'the payer keeps paying for everyone else');
  assert.deepEqual(benCancelled.json.subscription.items.filter((item) => item.status === 'active').map((item) => item.productId).sort(), [lessonId, 'gold-sub'].sort());
  const benAfter = (await db.collection('memberships').doc(benId).get()).data();
  assert.ok(benAfter.privileges.find((privilege) => privilege.productId === 'gold-sub').endedAt, 'Ben\'s gold entitlement ends');
  assert.equal(benAfter.subscriptionItems[0].status, 'cancelled');
  assert.ok(!(await db.collection('memberships').doc(monaId).get()).data().privileges.find((privilege) => privilege.productId === 'gold-sub').endedAt);
  assert.equal((await call('POST', `/api/admin/subscriptions/${subscriptionId}/members/${benId}/cancel`, { headers: admin })).status, 409);

  const lesson = items.find((item) => item.productId === lessonId);
  const lessonCancelled = await call('POST', `/api/admin/subscriptions/${subscriptionId}/items/${lesson.lineId}/cancel`, { headers: admin });
  assert.equal(lessonCancelled.status, 200, lessonCancelled.text);
  assert.equal(lessonCancelled.json.subscription.status, 'active', 'Mona\'s gold is still paid');
  assert.ok((await db.collection('orders').doc(orderRef).get()).data().items.find((item) => item.lineId === lesson.lineId).monthlyCancelledAt);

  assert.equal((await pay(orderRef)).status, 200);
  assert.deepEqual((await db.collection('orders').doc(orderRef).get()).data().stripeSubscriptionIds, [subscriptionId], 'a replayed webhook creates no new subscriptions');
  assert.equal((await db.collection('subscriptions').doc(subscriptionId).get()).data().items.filter((item) => item.status === 'active').length, 1, 'and does not undo cancellations');

  const laterRef = await buy(payer, lessonFor('Cara'), { billingMode: 'monthly' });
  const later = (await db.collection('orders').doc(laterRef).get()).data();
  assert.equal(later.subscriptionPlan.kind, 'add');
  assert.deepEqual(later.stripeSubscriptionIds, [subscriptionId], 'a later purchase joins the payer\'s existing direct debit');
  assert.ok(Number(later.total) > 0 && Number(later.total) <= 20, 'its first payment only runs to the usual monthly payment date');
  const joined = (await db.collection('subscriptions').doc(subscriptionId).get()).data();
  assert.deepEqual([...joined.orderRefs].sort(), [orderRef, laterRef].sort());
  assert.equal(joined.items.filter((item) => item.status === 'active').length, 2);
  assert.deepEqual((await call('GET', `/api/admin/subscriptions?orderRef=${laterRef}`, { headers: admin })).json.subscriptions.map((entry) => entry.id), [subscriptionId]);

  const cardPayer = email('new-card');
  const firstCardRef = await buy(cardPayer, lessonFor('Dan'), { billingMode: 'monthly' });
  const firstCard = (await db.collection('orders').doc(firstCardRef).get()).data();
  const secondCard = (await db.collection('orders').doc(await buy(cardPayer, lessonFor('Eve'), { billingMode: 'monthly' })).get()).data();
  assert.equal(secondCard.subscriptionPlan.kind, 'add');
  assert.notEqual(secondCard.stripeSubscriptionIds[0], firstCard.stripeSubscriptionIds[0], 'different card or bank details, which may be someone else\'s, get a new subscription');
  assert.equal(secondCard.subscriptionPlan.newPaymentDetails, true);
  assert.equal(secondCard.subscriptionSetupNeedsStaff, false);
  assert.deepEqual((await db.collection('customers').doc(customerKey(cardPayer)).get()).data().subscriptionIds.sort(),
    [firstCard.stripeSubscriptionIds[0], secondCard.stripeSubscriptionIds[0]].sort());
  const untouched = (await db.collection('subscriptions').doc(firstCard.stripeSubscriptionIds[0]).get()).data();
  assert.deepEqual(untouched.orderRefs, [firstCardRef], 'the existing subscription stays as it was');
  assert.deepEqual(untouched.items.map((item) => item.names), [['Dan Monthly']]);

  const soonPayer = email('renews-soon');
  const soonFirst = (await db.collection('orders').doc(await buy(soonPayer, lessonFor('Hal'), { billingMode: 'monthly' })).get()).data();
  const soonCheckout = await checkout(soonPayer, lessonFor('Ida'), { billingMode: 'monthly' });
  assert.equal(soonCheckout.status, 200, soonCheckout.text);
  assert.equal(soonCheckout.json.free, true, 'a part-month under Stripe\'s 30p minimum is not charged');
  const soonLater = (await db.collection('orders').doc(soonCheckout.json.orderRef).get()).data();
  assert.equal(Number(soonLater.total), 0);
  assert.equal(soonLater.items[0].firstPayment, 0);
  assert.deepEqual(soonLater.stripeSubscriptionIds, soonFirst.stripeSubscriptionIds, 'a payment date two minutes away still joins the one subscription');

  const renewedPayer = email('renewed');
  const renewedFirst = (await db.collection('orders').doc(await buy(renewedPayer, lessonFor('Jo'), { billingMode: 'monthly' })).get()).data();
  const renewedLater = (await db.collection('orders').doc(await buy(renewedPayer, lessonFor('Kit'), { billingMode: 'monthly' })).get()).data();
  assert.deepEqual(renewedLater.stripeSubscriptionIds, renewedFirst.stripeSubscriptionIds);
  assert.equal(renewedLater.subscriptionPlan.renewedBeforeAdding, true, 'items added after a renewal are charged pro rata on the next debit');
  assert.equal(renewedLater.subscriptionSetupNeedsStaff, false);

  const failing = email('sub-fail');
  await buy(failing, lessonFor('Fay'), { billingMode: 'monthly' });
  const failedRef = await buy(failing, lessonFor('Gus'), { billingMode: 'monthly' });
  assert.equal((await db.collection('orders').doc(failedRef).get()).data().subscriptionSetupNeedsStaff, true, 'a refused change is flagged for staff');
  const failedList = await call('GET', `/api/admin/subscriptions?orderRef=${failedRef}`, { headers: admin });
  assert.deepEqual(failedList.json.failed.map(({ itemNames, names, error }) => ({ itemNames, names, error })),
    [{ itemNames: ['E2E lesson block'], names: ['Gus Monthly'], error: 'Your card was declined.' }], 'staff see which item and member failed');
  await db.collection('products').doc(lessonId).delete();
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
