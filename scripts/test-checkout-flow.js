// End-to-end checkout test: API -> Stripe webhook -> Firestore records -> admin reports.
// Needs the Firebase emulators and an API server (Stripe mocked) already running. Run it through the integration suite in DEVELOPMENT.md, which starts that API.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { PRODUCTS } from '../src/constants/products.js';
import { assignLines } from '../src/utils/checkout.js';
import { DEFAULT_TRIP_DISCOUNTS, applyTripDiscounts } from '../src/utils/tripDiscount.js';
import { calculateCart } from '../src/utils/pricing.js';
import { eventAttendeeRows, justgoUploadRows, takingsSummary } from '../src/utils/adminReports.js';
import { sha256 } from '../src/utils/emailCodes.js';
import { applyConsentPrefill, checkoutWording } from '../src/utils/consents.js';
import { activeSubscriptionItems } from '../src/utils/subscriptions.js';
import { joiningShare, fullMonthsAfterCurrent, clubYearOf, clubYearDates, monthlyDebits, nextFirst } from '../src/utils/clubYear.js';

const projectId = assertLocalFirebase(process.env);
const apiPort = Number(process.env.TEST_API_PORT || 3010);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_local_only';
initializeAdminApp({ projectId });
const db = getFirestore();
const browserApp = initializeApp({ apiKey: 'demo-api-key', projectId });
const auth = getAuth(browserApp);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });

const run = Date.now().toString(36);
const affiliationNumberFor = (offset = 0) => String((Number.parseInt(run, 36) + offset) % 999999 + 1);
const syncedAffiliationNumber = affiliationNumberFor(1);
const unconfirmedAffiliationNumber = affiliationNumberFor(2);
const unknownAffiliationNumber = affiliationNumberFor(3);
let sourceAddress = 1;
// Each request comes from a different loopback address so the API's per-IP rate limits do not interfere.
// The Stripe return address for each checkout, as Stripe would hold it on the session.
const successUrls = new Map();
const rememberSuccessUrl = (json) => {
  const returnUrl = json?.orderRef && json.checkoutUrl ? new URL(json.checkoutUrl).searchParams.get('return_url') : null;
  if (returnUrl) successUrls.set(json.orderRef, returnUrl);
};
const call = (method, path, { body, headers = {}, raw } = {}) => new Promise((resolve, reject) => {
  sourceAddress = (sourceAddress % 250) + 1;
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const request = http.request({ host: '127.0.0.1', port: apiPort, path, method, localAddress: `127.0.0.${sourceAddress + 1}`,
    headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (response) => {
    let text = '';
    response.on('data', (chunk) => { text += chunk; });
    response.on('end', () => {
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      rememberSuccessUrl(json);
      resolve({ status: response.statusCode, json, text });
    });
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
  firstName: 'Alex', lastName: 'Adult', dob: yearsAgo(35), email: '', phone: '+447911123456', address: '1 River Road', postcode: 'EH1 1AA',
  swimming: 'confident', medical: 'Asthma', photoConsent: true, disclaimerAccepted: true,
  emergencyContact: { name: 'Pat Friend', phone: '+447911123457', relationship: 'Friend' }, ...over
});
const juniorDetails = (over = {}) => ({
  firstName: 'Jamie', lastName: 'Junior', dob: yearsAgo(12), swimming: 'basic', medical: 'None', photoConsent: true, disclaimerAccepted: true,
  guardian: { name: 'Parent Person', phone: '+447911123458', email: '', relationship: 'Parent', address: '9 Parent Street', postcode: 'EH9 9ZZ' }, ...over
});
const build = (productIds, fillers) => {
  const lines = productIds.map(lineFor);
  const people = assignLines([], lines, makeId).map((person, index) => ({ ...person, ...(fillers[index] || {}) }));
  return { lines, people };
};
// Agrees to whichever notices are published, as the checkout page does, unless a test sends its own noticeVersions.
const currentNoticeVersions = async () => Object.fromEntries((await db.collection('notices').get()).docs
  .filter((document) => !document.data().archived && document.data().currentVersion > 0).map((document) => [document.id, document.data().currentVersion]));
const checkout = async (emailAddress, { lines, people }, extra = {}, headers = {}) => call('POST', '/api/checkout-session', { body: {
  email: emailAddress, items: lines.map(({ id, lineId, size, clubYearChoice }) => ({ id, lineId, ...(size ? { size } : {}), ...(clubYearChoice ? { clubYearChoice } : {}) })), people, billingMode: 'annual',
  noticeVersions: await currentNoticeVersions(), wording: checkoutWording(), ...extra }, headers });
const sendWebhook = async (event) => {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `t=${timestamp},v1=${createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex')}`;
  return call('POST', '/api/stripe/webhook', { raw: payload, headers: { 'stripe-signature': signature } });
};
const pay = async (orderRef) => {
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  // Nothing due now but monthly payments to come: Checkout ran in setup mode and only saved the payment details.
  const setup = order.subscriptionPlan && order.totalPence === 0;
  return sendWebhook({ type: 'checkout.session.completed', data: { object: {
    id: order.stripe.sessionId, mode: setup ? 'setup' : 'payment', payment_status: setup ? 'no_payment_required' : 'paid',
    amount_total: setup ? null : order.totalPence, metadata: { order_ref: orderRef }, success_url: successUrls.get(orderRef) || null,
    ...(setup ? { setup_intent: `seti_${orderRef}`, payment_intent: null } : { payment_intent: `pi_${orderRef}` }) } } });
};
// Pretends checkout happens at `at` (the API honours X-Test-Now only against the emulators).
const testNow = (at) => ({ 'X-Test-Now': new Date(at).toISOString() });
const buy = async (emailAddress, basket, extra, headers = {}) => {
  const result = await checkout(emailAddress, basket, extra, headers);
  assert.equal(result.status, 200, `checkout failed: ${result.text}`);
  const webhook = await pay(result.json.orderRef);
  assert.equal(webhook.status, 200, `webhook failed: ${webhook.text}`);
  return result.json.orderRef;
};
// A member holding no services yet, for checks that buy one (a held service cannot be bought again in the same club year).
const newMember = async (name) => {
  const address = email(name);
  const details = adultDetails({ email: address, firstName: 'Fresh', lastName: name.replace(/[^a-z]/gi, '') });
  await buy(address, build(['membership-adult'], [details]));
  return { email: address, person: { returning: true, firstName: details.firstName, lastName: details.lastName, dob: details.dob, disclaimerAccepted: true } };
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
  const documents = [...new Map([...legacy.docs, ...householdMembers].map((document) => [document.id, document])).values()];
  return Promise.all(documents.map(async (document) => ({ id: document.id, ...document.data(), household: householdById.get(document.data().householdId) || {},
    entitlements: await entitlementsOf(document.id), purchases: await purchasesOf(document.id) })));
};
// Entitlements live on the member's membershipTerms documents and purchases on orders naming the member.
const termsOf = async (membershipId) => (await db.collection('membershipTerms').where('membershipId', '==', membershipId).get()).docs.map((document) => document.data());
const entitlementsOf = async (membershipId) => (await termsOf(membershipId)).flatMap((term) => (term.items || []).map((item) => ({ ...item, clubYear: term.clubYear })));
const purchasesOf = async (membershipId) => (await db.collection('orders').where('membershipIds', 'array-contains', membershipId).get()).docs;

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}`); }
  catch (error) { results.push({ name, ok: false, error }); console.log(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`); }
};

const token = await (await signInWithEmailAndPassword(auth, 'admin@forthcanoeclub.co.uk', 'local-test-password')).user.getIdToken(true);
const admin = { Authorization: `Bearer ${token}` };
const shared = {};
const reportFor = async (kind, recordId = '') => {
  const records = [];
  const cursors = new Set();
  let cursor = '';
  let response;
  do {
    const query = new URLSearchParams({ kind, ...(recordId ? { recordId } : {}), ...(cursor ? { cursor } : {}) });
    response = await call('GET', `/api/admin/reports?${query}`, { headers: admin });
    assert.equal(response.status, 200, response.text);
    assert.ok(Array.isArray(response.json.records), 'reports return records on every page');
    records.push(...response.json.records);
    cursor = response.json.nextCursor;
    if (cursor) {
      assert.ok(!cursors.has(cursor), 'report pagination must advance');
      cursors.add(cursor);
    }
  } while (cursor);
  assert.equal(new Set(records.map((record) => record.id)).size, records.length, 'report pages do not repeat records');
  return { ...response, json: { ...response.json, records } };
};

console.log(`Checkout flow test, run ${run}`);

await test('admin endpoints reject anonymous requests', async () => {
  for (const path of ['/api/admin/reports?kind=orders', '/api/admin/customer?q=a@b.co', '/api/admin/discount-codes']) assert.equal((await call('GET', path)).status, 401);
});

await test('new catalogue IDs are short, unique and admin-only', async () => {
  const path = '/api/admin/products/reserve-id';
  assert.equal((await call('POST', path)).status, 401);
  const first = await call('POST', path, { headers: admin });
  const second = await call('POST', path, { headers: admin });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.match(first.json.id, /^P\d{5,}$/);
  assert.match(second.json.id, /^P\d{5,}$/);
  assert.notEqual(first.json.id, second.json.id);
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
  const receiptPath = `/api/checkout-receipt?session_id=${order.stripe.sessionId}&receipt_token=${receiptToken}`;
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
  assert.equal(mail.replyTo, 'treasurer@forthcanoeclub.co.uk');
  assert.ok(mail.body.startsWith(response.json.copy), 'email and website use the same receipt copy');
  assert.ok(mail.subject.includes(orderRef), 'receipt reference is searchable in the email subject');
  assert.ok(mail.html.includes(orderRef) && mail.html.includes('Receipt Member'), 'formatted email includes the reference and member');
  assert.ok(mail.html.includes(mail.retrievalUrl), 'formatted email links to the saved receipt');
  assert.equal(mail.retrievalUrl.split('/order/')[1], `${orderRef}.${receiptToken}`, 'the email links with the same receipt token as the payment page');
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
      assert.ok(content.includes(dob) && content.includes('+447911123456') && content.includes('Pat Friend (Friend), +447911123457'), 'chosen details are emailed');
      assert.ok(!content.includes('Asthma') && !content.includes('1 River Road'), 'unchosen details are not emailed');
    }
    const linked = JSON.stringify((await call('GET', `/api/orders/${mail.retrievalUrl.split('/order/')[1]}`)).json);
    assert.ok(linked.includes('Fields Member') && !linked.includes(dob) && !linked.includes(details.dob) && !linked.includes(details.phone), 'the receipt link stays name-only');
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
  const stored = (await db.collection('discountCodes').doc(voucher.code).get()).data();
  assert.deepEqual([stored.orderRef, stored.email, stored.status, stored.type], [shared.voucherOrder, buyer, 'active', 'credit'], 'the voucher code records who bought it');
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
  assert.match(membership.householdId, /^H\d{5,}$/);
  assert.equal(membership.household.emergencyContact.name, 'Pat Friend');
  assert.equal(Object.hasOwn(membership, 'email'), false);
  assert.equal(membership.medical, 'Asthma');
  assert.equal(membership.justgoSyncStatus, 'pending');
  assert.deepEqual([membership.justgoUpload.status, membership.justgoUpload.attempts], ['queued', 0], 'queued for the guarded JustGo API uploader');
  assert.equal(Object.hasOwn(membership.justgoUpload, 'mode'), false, 'API uploads no longer select browser new-account or invitation modes');
  assert.ok(membership.validUntil.toDate() > new Date());
  assert.deepEqual(membership.entitlements.map((entry) => entry.productId), ['boat-hire']);
  assert.equal(membership.purchases.length, 1);
  assert.equal(membership.consents.disclaimer.policyKey, 'participation-disclaimer');
  assert.ok(membership.consents.disclaimer.version >= 1, 'the wording version shown at checkout is recorded');
  assert.equal(membership.consents.photoVideo.accepted, true);
  shared.alexMembership = membership.id;
  const order = (await db.collection('orders').doc(shared.adultOrder).get()).data();
  assert.equal(order.people[0].householdId, membership.householdId);
  assert.equal(order.status, 'paid');
  assert.equal(order.fulfilment.emailSent, true);
  assert.equal(order.people[0].membershipId, membership.id);
  for (const field of ['firstName', 'lastName', 'dob', 'email', 'phone', 'address', 'medical', 'emergencyContact']) {
    assert.equal(field in order.people[0], false, `the paid order holds a reference, not the ${field}`);
  }
  const customer = await call('GET', `/api/admin/customer?q=${encodeURIComponent(alex)}`, { headers: admin });
  assert.equal(customer.json.memberships.length, 1);
  assert.deepEqual(customer.json.memberships[0].privileges, ['ANNUAL BOAT & KIT HIRE']);
});

await test('an email only reveals that a record exists, names need the matching date of birth', async () => {
  const lookup = (body) => call('POST', '/api/membership-names', { body });
  assert.deepEqual((await lookup({ email: shared.alex })).json, { exists: true, names: [] });
  assert.deepEqual((await lookup({ email: shared.alex, dob: yearsAgo(36) })).json, { exists: true, names: [] });
  const prefill = { disclaimer: true, disclaimerChanged: false, photoConsent: true, photoChanged: false, notices: await currentNoticeVersions() };
  assert.deepEqual((await lookup({ email: shared.alex, dob: yearsAgo(35) })).json, { exists: true, names: [{ firstName: 'Alex', lastName: 'Adult', prefill, tripHeld: ['boat-hire'] }] },
    'the matching date of birth also says which boxes checkout may tick in advance and which trip discounts are already held');
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
  assert.deepEqual(records[0].entitlements.map((entry) => entry.productId).sort(), ['boat-hire', 'keyhire']);
  assert.equal(records[0].purchases.length, 2);
  assert.equal(records[0].household.address, '1 River Road', 'existing household details are not overwritten by the short form');
  assert.equal(Object.hasOwn(records[0], 'address'), false, 'the member does not duplicate household contact details');
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.people[0].existingMember, true);
});

await test("receipt emails show an existing member's recorded details only at their own email", async () => {
  assert.equal((await call('POST', '/api/admin/receipt-email', { headers: admin, body: { personFields: ['phone', 'address', 'emergencyContact'] } })).status, 200);
  try {
    const mailFor = async (orderRef) => (await db.collection('testMail').where('orderRef', '==', orderRef).get()).docs[0].data();
    const own = await newMember('receipt-own');
    const ownMail = await mailFor(await buy(own.email, build(['keyhire'], [own.person])));
    for (const content of [ownMail.body, ownMail.html]) {
      assert.ok(content.includes('+447911123456') && content.includes('1 River Road') && content.includes('Pat Friend (Friend), +447911123457'),
        'details held on the record are filled in for the member\'s own email');
    }
    const other = await newMember('receipt-other');
    const otherMail = await mailFor(await buy(email('receipt-someone-else'), build(['keyhire'], [{ ...other.person, email: other.email }])));
    for (const content of [otherMail.body, otherMail.html]) {
      assert.ok(!content.includes('+447911123456') && !content.includes('1 River Road') && !content.includes('Pat Friend'),
        'recorded details are not sent to a different receipt address');
    }
  } finally {
    assert.equal((await call('POST', '/api/admin/receipt-email', { headers: admin, body: { personFields: [] } })).status, 200);
  }
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
  assert.equal(membership.household.phone, '+447911123458');
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
    name: 'Morgan Guardian', phone: '+447911123459', email: email('guardian-morgan'), relationship: 'Parent',
    address: '41 Shared Road', postcode: 'EH4 4AA'
  };
  const guardianB = {
    name: 'Riley Guardian', phone: '+447911123460', email: email('guardian-riley'), relationship: 'Grandparent',
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

  const orders = (await reportFor('orders', orderRef)).json.records;
  const report = orders.find((record) => record.id === orderRef);
  assert.equal(report.status, 'paid');
  assert.equal(report.people.length, 3);
  assert.deepEqual(
    [report.people.find((person) => person.name === 'Morgan Sibling').emergencyContact,
      report.people.find((person) => person.name === 'Taylor Sibling').emergencyContact,
      report.people.find((person) => person.name === 'Riley Other').emergencyContact],
    ['Morgan Guardian, Parent, +447911123459', 'Morgan Guardian, Parent, +447911123459', 'Riley Guardian, Grandparent, +447911123460']
  );
  const memberRows = (await reportFor('members')).json.records;
  const morganRow = memberRows.find((record) => record.id === morgan.id);
  const taylorRow = memberRows.find((record) => record.id === taylor.id);
  const rileyRow = memberRows.find((record) => record.id === riley.id);
  assert.deepEqual([morganRow.email, taylorRow.email, rileyRow.email], [guardianA.email, guardianA.email, guardianB.email]);
  assert.deepEqual([morganRow.parent, taylorRow.parent, rileyRow.parent], [
    'Morgan Guardian, Parent, +447911123459', 'Morgan Guardian, Parent, +447911123459', 'Riley Guardian, Grandparent, +447911123460'
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
    adultDetails({ firstName: 'Avery', lastName: 'Quantity', email: email('quantity-avery'), phone: '+447911123461', address: '63 Double Road', postcode: 'EH6 6DA' })
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
  // Paid up front: the joining share of this month plus the full months to 1 March, less the annual discount.
  const goldPrice = Math.round(30 * (joiningShare(now) + fullMonthsAfterCurrent(now)) * 0.8 * 100) / 100;
  assert.equal(order.totalPence, Math.round((60 + boatPrice * 2 + 100 + goldPrice) * 100), 'each member and product line is priced, including the annual gold subscription');
  assert.equal(order.totalPence, order.items.reduce((total, item) => total + item.pricePence, 0));
  assert.ok(order.items.every((item) => Number.isInteger(item.pricePence) && !('price' in item)), 'order lines hold whole pence');
  assert.deepEqual(
    order.people.map((person) => person.lineIds.map((lineId) => order.items.find((item) => item.lineId === lineId).id).sort())
      .sort((a, b) => a.join(',').localeCompare(b.join(','))),
    [['boat-hire', 'gold-sub', 'keyhire', 'membership-adult'], ['boat-hire', 'keyhire', 'membership-adult']]
  );
  const members = await Promise.all(order.people.map(async (person) =>
    ({ ...(await db.collection('memberships').doc(person.membershipId).get()).data(), entitlements: await entitlementsOf(person.membershipId) })
  ));
  assert.equal(members.length, 2);
  assert.ok(members.every((member) => member.entitlements.some((privilege) => privilege.productId === 'boat-hire')
    && member.entitlements.some((privilege) => privilege.productId === 'keyhire')));
  const report = (await reportFor('orders', orderRef)).json.records.find((record) => record.id === orderRef);
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
  await db.collection('memberships').doc('sca-E2E-1').set({ affiliationNumber: syncedAffiliationNumber, firstName: 'Sam', lastName: 'Synced', email: email('synced'), dob: yearsAgo(40, 2, 2), status: 'active', validUntil: new Date(Date.now() + 90 * 86400000), source: 'justgo', justgoSyncStatus: 'synced', renewalMethod: 'justgo', lastJustgoSync: new Date() });
  const synced = { ...adultDetails({ firstName: 'Sam', lastName: 'Synced', dob: yearsAgo(40, 2, 2), email: email('synced') }), affiliationNumber: syncedAffiliationNumber };
  const bad = await checkout(email('synced'), build(['boat-hire'], [{ ...synced, dob: yearsAgo(41, 2, 2) }]));
  assert.equal(bad.status, 409);
  assert.equal(bad.json.code, 'identity_conflict');
  const wrongEmail = await checkout(email('synced'), build(['boat-hire'], [{ ...synced, email: 'someone.else@example.test' }]));
  assert.equal(wrongEmail.status, 409);
  assert.equal(wrongEmail.json.code, 'identity_conflict');
  assert.match(wrongEmail.json.error, /email address or date of birth/);
  assert.match(wrongEmail.json.error, /JustGo will email you/);
  await buy(email('synced'), build(['boat-hire'], [synced]));
  assert.equal((await entitlementsOf('sca-E2E-1'))[0].productId, 'boat-hire');
});

await test('an active member cannot buy a second membership, and JustGo members renew through JustGo', async () => {
  const again = await checkout(shared.alex, build(['membership-adult'], [adultDetails({ email: shared.alex })]));
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'membership_active');
  const synced = { ...adultDetails({ firstName: 'Sam', lastName: 'Synced', dob: yearsAgo(40, 2, 2), email: email('synced') }), affiliationNumber: syncedAffiliationNumber };
  const viaJustgo = await checkout(email('synced'), build(['membership-adult'], [synced]));
  assert.equal(viaJustgo.status, 409);
  assert.equal(viaJustgo.json.code, 'renews_via_justgo');
  assert.match(viaJustgo.json.error, /JustGo/);
  assert.equal((await checkout(email('synced'), build(['keyhire'], [synced]))).status, 200, 'add-ons are still allowed');
});

await test('a paid membership stays active for its club year whatever happens to any subscription', async () => {
  const coachingEmail = email('coaching-cancelled');
  const coachingDetails = adultDetails({ firstName: 'Coaching', lastName: 'Cancelled', email: coachingEmail });
  await buy(coachingEmail, build(['membership-adult', 'blue-sub'], [coachingDetails]), { billingMode: 'monthly' });
  const [coachingMember] = await membershipsFor(coachingEmail);
  assert.ok(!coachingMember.stripeMembershipSubscriptionId, 'a coaching subscription is not linked to the membership');
  assert.equal((await checkout(coachingEmail, build(['keyhire'], [coachingDetails]))).status, 200,
    'the separately paid membership counts as active');

  // Older records may still name a Bookwhen subscription (scripts/migrate-schema.js); it is kept only so erasure can stop that billing.
  const legacyEmail = email('stripe-cancelled');
  const legacyDetails = adultDetails({ firstName: 'Stripe', lastName: 'Cancelled', email: legacyEmail });
  await db.collection('memberships').doc(`stripe-cancelled-${run}`).set({
    firstName: legacyDetails.firstName, lastName: legacyDetails.lastName, dob: legacyDetails.dob, email: legacyEmail,
    status: 'active', validUntil: new Date('2099-03-01T00:00:00Z'), source: 'website', renewalMethod: 'website',
    stripeMembershipSubscriptionId: 'sub_e2e_cancelled', stripeMembershipMode: 'live'
  });
  assert.equal((await checkout(legacyEmail, build(['keyhire'], [legacyDetails]))).status, 200,
    'a cancelled or other-mode subscription does not end or block a paid membership');
  const duplicate = await checkout(legacyEmail, build(['membership-adult'], [legacyDetails]));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.code, 'membership_active');

  const noSubscriptionEmail = email('stripe-unlinked-history');
  const noSubscriptionDetails = adultDetails({ firstName: 'Legacy', lastName: 'Member', email: noSubscriptionEmail });
  await db.collection('memberships').doc(`legacy-no-sub-${run}`).set({
    firstName: noSubscriptionDetails.firstName, lastName: noSubscriptionDetails.lastName, dob: noSubscriptionDetails.dob,
    email: noSubscriptionEmail, status: 'active', validUntil: new Date('2099-03-01T00:00:00Z')
  });
  assert.equal((await checkout(noSubscriptionEmail, build(['keyhire'], [noSubscriptionDetails]))).status, 200, 'an annual member with no subscription reference is active');
});

await test('JustGo members are inactive until the sync confirms their renewal in the club year', async () => {
  const now = new Date();
  const yearStart = new Date(now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1, 2, 1);
  const lapsed = email('unconfirmed');
  const details = adultDetails({ firstName: 'Lou', lastName: 'Unconfirmed', dob: yearsAgo(45, 7, 7), email: lapsed });
  await db.collection('memberships').doc(`sca-E2E-U-${run}`).set({ affiliationNumber: unconfirmedAffiliationNumber, firstName: 'Lou', lastName: 'Unconfirmed', email: lapsed, dob: details.dob, status: 'active',
    validUntil: new Date(now.getTime() + 90 * 86400000), source: 'justgo', justgoSyncStatus: 'synced', renewalMethod: 'justgo', lastJustgoSync: new Date(yearStart.getTime() - 86400000) });
  const addOn = await checkout(lapsed, build(['boat-hire'], [details]));
  assert.equal(addOn.status, 409);
  assert.equal(addOn.json.code, 'membership_required');
  assert.match(addOn.json.error, /renewal has not been confirmed/);
  const register = (await reportFor('members', `sca-E2E-U-${run}`)).json.records.find((record) => record.id === `sca-E2E-U-${run}`);
  const inWindow = now - yearStart < 14 * 86400000;
  assert.equal(register.status, inWindow ? 'Awaiting renewal' : 'Unavailable', 'with no completed sync run we cannot tell whether they renewed');
  await db.collection('settings').doc('justgoSync').set({ lastSuccessAt: new Date() });
  const synced = await reportFor('members', `sca-E2E-U-${run}`);
  await db.collection('settings').doc('justgoSync').delete();
  assert.equal(synced.json.records.find((record) => record.id === `sca-E2E-U-${run}`).status, inWindow ? 'Awaiting renewal' : 'Expired', 'a running sync that did not confirm them');
  assert.equal(synced.json.justgoSync.healthy, true);
  await db.collection('memberships').doc(`sca-E2E-U-${run}`).set({ lastJustgoSync: new Date() }, { merge: true });
  assert.equal((await checkout(lapsed, build(['boat-hire'], [details]))).status, 200, 'active once the sync confirms them');
  const after = (await reportFor('members', `sca-E2E-U-${run}`)).json.records.find((record) => record.id === `sca-E2E-U-${run}`);
  assert.equal(after.status, 'Active');
});

await test('a person with an unknown membership number is queued for JustGo identity reconciliation', async () => {
  const visitor = email('visitor');
  const basket = build(['membership-adult'], [{ ...adultDetails({ firstName: 'Vic', lastName: 'Visitor', email: visitor }), affiliationNumber: unknownAffiliationNumber }]);
  await buy(visitor, basket);
  const [record] = await membershipsFor(visitor);
  assert.equal(record.affiliationNumber, unknownAffiliationNumber);
  assert.deepEqual([record.justgoUpload.status, record.justgoUpload.attempts], ['queued', 0]);
  assert.equal(Object.hasOwn(record.justgoUpload, 'mode'), false, 'the API resolves the number instead of sending a browser invitation');
  shared.visitorMembership = record.id;
});

await test('staff can retry the upload or mark it as done by hand, and failures reach the staff list', async () => {
  const act = (id, action) => call('POST', `/api/admin/memberships/${id}/justgo`, { headers: admin, body: { action } });
  assert.equal((await call('POST', `/api/admin/memberships/${shared.visitorMembership}/justgo`, { body: { action: 'retry' } })).status, 401);
  await db.collection('memberships').doc(shared.visitorMembership).set({ justgoUpload: { status: 'failed', needsStaff: true, failures: 3, attempts: 3, lastError: 'JustGo request refused before writing' } }, { merge: true });
  let report = (await reportFor('members', shared.visitorMembership)).json.records;
  const failed = report.find((record) => record.id === shared.visitorMembership);
  assert.equal(failed.justgo, 'Needs staff upload');
  assert.equal(failed.uploadFailures, 3);
  const staffRows = justgoUploadRows(report);
  const row = staffRows.find((entry) => entry[0] === shared.visitorMembership);
  assert.deepEqual([row[1], row[10], row[11], row[12]], ['Vic', unknownAffiliationNumber, 3, 'JustGo request refused before writing']);
  assert.equal((await act(shared.visitorMembership, 'retry')).status, 200);
  report = (await reportFor('members', shared.visitorMembership)).json.records;
  assert.equal(report.find((record) => record.id === shared.visitorMembership).justgo, 'Awaiting upload');
  for (const status of ['processing', 'submitted', 'review', 'revoked']) {
    await db.collection('memberships').doc(shared.visitorMembership).set({ justgoUpload: { status } }, { merge: true });
    assert.equal((await act(shared.visitorMembership, 'retry')).status, 409, `${status} needs reconciliation, not another write`);
    assert.equal((await db.collection('memberships').doc(shared.visitorMembership).get()).data().justgoUpload.status, status);
  }
  assert.equal((await act(shared.visitorMembership, 'manual')).status, 200);
  report = (await reportFor('members', shared.visitorMembership)).json.records;
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
  assert.ok(records.every((record) => record.household.address === '1 River Road' && record.household.phone === '+447911123456'));
  const kid = records.find((record) => record.firstName === 'Kit');
  assert.equal(Object.hasOwn(kid, 'emergencyNote'), false);
  assert.equal(kid.household.emergencyContact.name, 'Pat Friend');
  assert.equal(kid.medical, 'Hay fever');
  assert.equal(Object.hasOwn(kid, 'photoConsent'), false, 'consent is held in its versioned record');
  assert.equal(kid.consents.photoVideo.accepted, false);
  assert.equal(kid.consents.photoVideo.by, 'guardian');
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
  const create = await call('POST', '/api/admin/discount-codes', { headers: admin, body: { code, label: 'Boat 20', type: 'multiplier', discountValue: 0.2, productIds: ['boat-hire'] } });
  assert.equal(create.status, 200, create.text);
  assert.equal((await call('POST', '/api/admin/discount-codes', { headers: admin, body: { code, label: 'Dup', type: 'multiplier', discountValue: 0.2 } })).status, 409);
  assert.equal((await call('POST', '/api/admin/discount-codes', { headers: admin, body: { code: `X${run}`, label: 'Bad', type: 'multiplier', discountValue: 5 } })).status, 400);
  const listed = (await call('GET', '/api/admin/discount-codes', { headers: admin })).json.codes.find((entry) => entry.code === code);
  assert.deepEqual(listed.productIds, ['boat-hire']);
  const valid = await call('POST', '/api/discount-codes/validate', { body: { code } });
  assert.equal(valid.json.valid, true);
  const { email: memberEmail, person: member } = await newMember('discountmember');
  const scoped = await checkout(memberEmail, build(['boat-hire'], [member]), { discountCode: code });
  assert.equal(scoped.status, 200);
  // Boat hire is prorated: 60% from 1 October to the end of February.
  const boatPrice = [9, 10, 11, 0, 1].includes(new Date().getMonth()) ? 51 : 85;
  const scopedOrder = (await db.collection('orders').doc(scoped.json.orderRef).get()).data();
  assert.deepEqual([scopedOrder.totalPence, scopedOrder.discountPence, scopedOrder.subtotalPence, scopedOrder.discountCode],
    [Math.round(boatPrice * 0.8 * 100), boatPrice * 100 - Math.round(boatPrice * 0.8 * 100), boatPrice * 100, code], 'the order records its discount in pence and the code used');
  const notApplicable = await checkout(email('newjoiner'), build(['membership-adult'], [adultDetails({ email: email('newjoiner') })]), { discountCode: code });
  assert.equal(notApplicable.status, 400);
  assert.equal((await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { label: 'Boat 50', type: 'multiplier', discountValue: 0.5, productIds: ['boat-hire'] } })).status, 200);
  const edited = await checkout(memberEmail, build(['boat-hire'], [member]), { discountCode: code });
  assert.equal((await db.collection('orders').doc(edited.json.orderRef).get()).data().totalPence, boatPrice * 50);
  assert.equal((await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { status: 'disabled' } })).status, 200);
  assert.equal((await db.collection('discountCodes').doc(code).get()).data().status, 'disabled');
  assert.equal((await call('POST', '/api/discount-codes/validate', { body: { code } })).json.valid, false);
  assert.equal((await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { status: 'used' } })).status, 400, 'staff cannot mark a code used');
  assert.equal((await call('PATCH', `/api/admin/discount-codes/${code}`, { headers: admin, body: { status: 'active' } })).status, 200);
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
  const { email: memberEmail, person: member } = await newMember('eventvouchermember');
  const hire = await checkout(memberEmail, build(['boat-hire'], [member]), { discountCode: voucher.code });
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
  assert.equal(paidOrder.totalPence, 1500);
  assert.equal(paidOrder.items[0].eventSchedule.days, 5);
  assert.equal(paidOrder.people.length, 1);
  shared.voucherRedemptionOrder = orderRef;
  const customer = await call('GET', `/api/admin/customer?q=${encodeURIComponent(shared.gifter)}`, { headers: admin });
  assert.equal(customer.json.vouchers[0].status, 'used');
  assert.equal(customer.json.vouchers[0].usedByOrder, orderRef);
  assert.equal((await call('POST', '/api/discount-codes/validate', { body: { code: shared.voucherCode } })).json.valid, false);
  const other = await newMember('secondvouchermember');
  const second = await checkout(other.email, build(['boat-hire'], [other.person]), { discountCode: shared.voucherCode });
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
  const report = await reportFor('events', orderRef);
  const record = report.json.records.find((entry) => entry.id === orderRef);
  assert.equal(record.items.length, 1);
  assert.deepEqual(record.people[0].events[0].eventSchedule, schedule);
  const [row] = eventAttendeeRows([record], () => 'scheduled');
  assert.deepEqual([row[0], row[2], row[4], row[6], row[7]], ['E2E five-day course', 'Alex Adult', '+447911123456', 'Pat Friend, Friend, +447911123457', 'Asthma']);
  assert.equal(row[5], shared.alex);
});

await test('reports: orders list shows each person and what they bought', async () => {
  const report = await reportFor('orders');
  assert.equal(report.status, 200);
  const family = report.json.records.find((record) => record.id === shared.familyOrder);
  assert.equal(family.status, 'paid');
  assert.equal(family.people.length, 3);
  const kit = family.people.find((person) => person.name === 'Kit Adult');
  assert.equal(kit.kind, 'Under 18');
  assert.equal(kit.emergencyContact, 'Drew Adult, Parent/Guardian, +447911123456', 'a recorded junior\'s emergency contact is their household parent or guardian');
  assert.equal(kit.phone, '+447911123456', 'the household supplies an actionable parent contact alongside the note');
  assert.equal(kit.email, shared.family);
  assert.equal(kit.address, '1 River Road, EH1 1AA');
  assert.deepEqual(kit.items, ['CLUB MEMBERSHIP — FAMILY']);
  const drew = family.people.find((person) => person.name === 'Drew Adult');
  const casey = family.people.find((person) => person.name === 'Casey Adult');
  assert.deepEqual([drew.emergencyContact, casey.emergencyContact], [
    'Pat Friend, Friend, +447911123457', 'Pat Friend, Friend, +447911123457'
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
  const report = await reportFor('members');
  assert.equal(report.status, 200);
  const mine = report.json.records.filter((record) => record.email.endsWith(`.${run}@example.test`));
  const [memberships, households] = await Promise.all([db.collection('memberships').get(), db.collection('households').get()]);
  const contactEmails = new Map(households.docs.map((document) => [document.id, document.data().email]));
  const expectedIds = memberships.docs.filter((document) => {
    const member = document.data();
    return member.contactOnly !== true && String(contactEmails.get(member.householdId) || member.email || '').endsWith(`.${run}@example.test`);
  }).map((document) => document.id).sort();
  assert.ok(expectedIds.length >= 19, 'this run creates the member and household fixtures');
  assert.deepEqual(mine.map((record) => record.id).sort(), expectedIds, 'every member in this run appears exactly once, including separate household contacts');
  const alex = mine.find((record) => record.id === shared.alexMembership);
  assert.equal(alex.name, 'Alex Adult');
  assert.equal(alex.tier, 'adult');
  assert.equal(alex.status, 'Active');
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
  assert.equal(alex.emergencyContact, 'Pat Friend, Friend, +447911123457');
  const kid = mine.find((record) => record.name === 'Kit Adult');
  assert.equal(kid.emergencyContact, 'Drew Adult, Parent/Guardian, +447911123456');
  assert.equal(kid.parent, 'Drew Adult, Parent/Guardian, +447911123456', 'parent contact recorded for the child');
  assert.equal(kid.medical, 'Hay fever');
  const jam = mine.find((record) => record.name === 'Sam Synced');
  assert.equal(jam.source, 'justgo');
  assert.equal(jam.justgo, 'In JustGo');
  assert.equal(jam.renewalMethod, 'justgo');
  const everyone = report.json.records;
  assert.ok(everyone.some((record) => record.name === 'Test Current' && record.source === 'justgo' && record.status === 'Active'), 'JustGo-synced members are in the same register');
  assert.ok(everyone.some((record) => record.id === 'test-expired' && record.status === 'Pending'), 'the legacy JustGo fixture has never had a confirming sync, so its status is pending rather than assumed expired');
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
  assert.deepEqual([afterFailure.paymentFailure.code, afterFailure.paymentFailure.declineCode], ['card_declined', 'generic_decline']);
  assert.ok(afterFailure.paymentFailure.at);
  assert.deepEqual(afterFailure.items, before.items);
  assert.deepEqual(afterFailure.people, before.people);

  const expired = await sendWebhook({ type: 'checkout.session.expired', data: { object: {
    id: before.stripe.sessionId, metadata: { order_ref: orderRef }
  } } });
  assert.equal(expired.status, 200);
  const afterExpiry = (await orderRefDoc.get()).data();
  assert.equal(afterExpiry.status, 'expired');
  assert.deepEqual(afterExpiry.items, before.items);
  assert.deepEqual(afterExpiry.people, before.people);
  assert.equal((await call('GET', `/api/checkout-status?session_id=${before.stripe.sessionId}`)).json.status, 'expired');

  const asyncEmail = email('async-failure');
  const asyncStart = await checkout(asyncEmail, build(['membership-adult'], [adultDetails({ email: asyncEmail })]));
  const asyncOrder = (await db.collection('orders').doc(asyncStart.json.orderRef).get()).data();
  const asyncFailure = await sendWebhook({ type: 'checkout.session.async_payment_failed', data: { object: {
    id: asyncOrder.stripe.sessionId, metadata: { order_ref: asyncStart.json.orderRef }
  } } });
  assert.equal(asyncFailure.status, 200);
  assert.equal((await db.collection('orders').doc(asyncStart.json.orderRef).get()).data().status, 'payment_failed');
});

await test('merchandise sizes and event capacity limit sales, expiry releases holds and deleting a refunded order frees stock', async () => {
  const tee = `E2E-TEE-${run}`;
  await db.collection('products').doc(tee).set({ name: 'Club tee', category: 'MERCHANDISE', type: 'merchandise', basePrice: 15, description: 'Tee',
    variants: [{ size: 'S', stock: 1 }, { size: 'M', stock: 2 }], active: true, sortOrder: 1000, pricingMode: 'fixed', allowMonthly: false });
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
  const expired = await sendWebhook({ type: 'checkout.session.expired', data: { object: { id: lastOrder.stripe.sessionId, metadata: { order_ref: lastM.json.orderRef } } } });
  assert.equal(expired.status, 200);
  assert.deepEqual((await stock(tee)).remaining, { S: 0, M: 1 }, 'an expired session returns its reservation');

  assert.equal((await pay(first.json.orderRef)).status, 200);
  assert.deepEqual((await stock(tee)).remaining, { S: 0, M: 1 }, 'paying keeps the stock taken');
  const paidOrder = (await db.collection('orders').doc(first.json.orderRef).get()).data();
  assert.deepEqual(paidOrder.items.map((item) => item.size).sort(), ['M', 'S']);
  const report = (await reportFor('orders', first.json.orderRef)).json.records.find((record) => record.id === first.json.orderRef);
  assert.deepEqual(report.items.map((item) => item.name).sort(), ['Club tee (M)', 'Club tee (S)']);

  const remove = (orderRef) => call('DELETE', `/api/admin/records/orders/${orderRef}`, { headers: admin, body: { confirmId: orderRef, acknowledgeStripe: true, reason: 'Refunded' } });
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
  const erase = (body) => call('POST', '/api/admin/gdpr/erase', { headers: admin, body: { reason: 'Asked to be forgotten', ...body } });
  const preview = (body) => call('POST', '/api/admin/gdpr/preview', { headers: admin, body });
  const remove = (orderRef, reason = 'Duplicate order') => call('DELETE', `/api/admin/records/orders/${orderRef}`, { headers: admin, body: { confirmId: orderRef, acknowledgeStripe: true, reason } });

  const gdpr = email('gdpr');
  const details = adultDetails({ firstName: 'Gail', lastName: 'Erase', dob: yearsAgo(41, 3, 3), email: gdpr });
  const membershipOrder = await buy(gdpr, build(['membership-adult'], [details]));
  const addOnOrder = await buy(gdpr, build(['keyhire'], [{ returning: true, firstName: 'Gail', lastName: 'Erase', dob: details.dob, disclaimerAccepted: true }]));
  const tripId = `E2E-GDPR-TRIP-${run}`;
  await db.collection('products').doc(tripId).set({ name: 'GDPR trip', category: 'EVENTS', type: 'event-ticket', basePrice: 15, capacity: 1,
    eventSchedule: { mode: 'single', startDate: '2099-06-01', startTime: '10:00', endTime: '12:00', timeZone: 'Europe/London' } });
  const tripLine = { id: tripId, lineId: `${tripId}-1`, name: 'GDPR trip', category: 'EVENTS', type: 'event-ticket', basePrice: 15 };
  const tripOrder = await buy(gdpr, { lines: [tripLine], people: assignLines([], [tripLine], makeId)
    .map((person) => ({ ...person, returning: true, firstName: 'Gail', lastName: 'Erase', dob: details.dob, disclaimerAccepted: true })) });
  const tripStock = async () => (await call('GET', '/api/availability')).json.availability[tripId];
  const tripRoster = async () => (await call('GET', `/api/event-rosters/${tripId}`, { headers: admin })).json.attendees.map((row) => row.name);
  assert.equal((await tripStock()).soldOut, true, 'the erased person\'s ticket holds the only place');
  assert.deepEqual(await tripRoster(), ['Gail Erase']);
  const unexplained = await remove(addOnOrder, '  ');
  assert.equal(unexplained.status, 400, 'deleting a record needs a reason');
  assert.match(unexplained.json.error, /reason/i);
  assert.ok((await db.collection('orders').doc(addOnOrder).get()).exists, 'nothing is deleted without a reason');
  assert.equal((await remove(addOnOrder)).status, 200);
  const audit = (await db.collection('auditLog').where('recordId', '==', addOnOrder).get()).docs[0].data();
  assert.deepEqual([audit.kind, audit.action, audit.recordKind, audit.reason, audit.by], ['deletion', 'delete-record', 'orders', 'Duplicate order', 'admin@forthcanoeclub.co.uk']);
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
  assert.deepEqual(found.json.refundChecks.map((check) => [check.orderRef, check.name, check.attendee, check.lastDate, check.pricePence]),
    [[tripOrder, 'GDPR trip', 'Gail Erase', '2099-06-01', 1500]], 'upcoming event tickets are listed for a refund check first');
  const wrong = await preview({ ...identity, dob: yearsAgo(40, 3, 3) });
  assert.deepEqual([wrong.json.people.length, wrong.json.deletedRecords.length], [0, 0]);
  assert.equal((await erase(identity)).status, 400, 'confirmation is required');

  const before = (await db.collection('orders').doc(membershipOrder).get()).data();
  const total = before.totalPence;
  assert.ok(before.receiptTokenHash);
  const noReason = await erase({ ...identity, scope: 'person', confirm: 'ERASE', reason: '' });
  assert.equal(noReason.status, 400, 'erasure needs a reason');
  assert.match(noReason.json.error, /reason/i);
  assert.equal((await membershipsFor(gdpr)).length, 1, 'nothing is erased without a reason');
  const erased = await erase({ ...identity, scope: 'person', confirm: 'ERASE' });
  assert.equal(erased.status, 200, erased.text);
  assert.equal(erased.json.erased, 1);
  assert.equal((await membershipsFor(gdpr)).length, 0);
  const kept = (await db.collection('orders').doc(membershipOrder).get()).data();
  assert.deepEqual([kept.email, kept.totalPence, kept.items.length, kept.people[0].erased, kept.people[0].firstName, kept.receiptTokenHash], ['***', total, 1, true, undefined, '']);
  assert.equal('receipt' in kept, false);
  assert.equal(erased.json.eventTicketsReleased, 1);
  const keptTrip = (await db.collection('orders').doc(tripOrder).get()).data();
  assert.deepEqual([keptTrip.status, keptTrip.items[0].attendeeErased, keptTrip.items[0].pricePence], ['paid', true, 1500], 'the ticket stays as a financial record');
  assert.deepEqual(await tripRoster(), [], 'the erased person leaves the attendee list');
  assert.equal((await tripStock()).soldOut, false, 'their place is freed');
  const purged = (await db.collection('auditLog').where('recordId', '==', addOnOrder).get()).docs[0].data();
  assert.deepEqual([purged.snapshot, purged.personalDataErased], [null, true]);
  const trail = (await db.collection('auditLog').where('action', '==', 'gdpr-erasure').get()).docs.map((document) => document.data()).find((entry) => entry.summary.ordersRedacted.includes(membershipOrder));
  assert.ok(trail, 'the erasure itself is recorded');
  assert.deepEqual([trail.kind, trail.reason], ['deletion', 'Asked to be forgotten']);
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

  const sharedDetails = { contactName: 'Sam New', contactRelationship: 'Parent', phone: '+447911123462', email: email('gdpr-new'), address: '9 New Road', postcode: 'EH9 9ZZ',
    emergencyName: 'Pat New', emergencyPhone: '+447911123463', emergencyRelationship: 'Friend' };
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

await test('receipt lookups are never cached or sent as a referrer, and the unpaid order endpoint is gone', async () => {
  for (const path of ['/api/orders/FCC-NOPE.token', '/api/checkout-receipt?session_id=cs_x&receipt_token=y']) {
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

await test('activation records yearly volunteer benefits and emails them without issuing a discount code', async () => {
  const coordinatorEmail = email('volunteer-coordinator');
  await db.collection('settings').doc('volunteerCoordinator').set({ email: coordinatorEmail });
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { body: { inducted: true } })).status, 401);
  const listed = await call('GET', '/api/admin/volunteers', { headers: admin });
  assert.equal(listed.status, 200);
  const row = listed.json.volunteers.find((volunteer) => volunteer.id === shared.volunteerSignup);
  assert.equal(row.memberStatus, 'active');
  assert.equal(row.inducted, false);
  const inducted = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: true, tier: '20' } });
  assert.equal(inducted.json.outcome, 'benefits-added', inducted.text);
  const signup = (await db.collection('lists').doc(shared.volunteerSignup).get()).data();
  assert.equal(signup.discountCode, null);
  const mail = (await db.collection('testMail').where('signupId', '==', shared.volunteerSignup).get()).docs.map((document) => document.data()).filter((mail) => mail.kind === 'volunteer-benefits');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].email, shared.volunteerEmail);
  assert.equal(mail[0].replyTo, coordinatorEmail);
  assert.match(mail[0].body, /automatically at checkout/);
  assert.equal((await db.collection('memberships').doc(shared.volunteerMemberId).get()).data().volunteer.inducted, true);
  const again = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: true } });
  assert.equal(again.json.outcome, 'up-to-date');
  assert.equal((await db.collection('testMail').where('signupId', '==', shared.volunteerSignup).get()).docs.filter((document) => document.data().kind === 'volunteer-benefits').length, 1);
  await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: false } });
  assert.equal((await db.collection('memberships').doc(shared.volunteerMemberId).get()).data().volunteer.inducted, true, 'deactivation keeps induction history');
});

await test('a non-member volunteer activated first gets their benefits when a membership is bought for them', async () => {
  const volunteerEmail = email('volunteer-joiner');
  await call('POST', '/api/lists', { body: { name: 'Nina Newcomer', email: volunteerEmail, category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
  const signupId = (await db.collection('lists').where('email', '==', volunteerEmail).get()).docs[0].id;
  const pending = await call('PATCH', `/api/admin/volunteers/${signupId}`, { headers: admin, body: { active: true, tier: '20' } });
  assert.equal(pending.json.outcome, 'awaiting-membership');
  assert.equal((await db.collection('lists').doc(signupId).get()).data().discountCode, null);
  const listed = (await call('GET', '/api/admin/volunteers', { headers: admin })).json.volunteers.find((volunteer) => volunteer.id === signupId);
  assert.equal(listed.memberStatus, 'not a member');

  await buy(volunteerEmail, build(['vouchers'], []));
  assert.equal((await db.collection('lists').doc(signupId).get()).data().discountCode, null, 'a non-membership purchase does not count');
  // Someone else pays: the volunteer's own contact email on the membership is what links them.
  await buy(email('volunteer-payer'), build(['membership-adult'], [adultDetails({ firstName: 'Nina', lastName: 'Newcomer', email: volunteerEmail })]));
  const signup = (await db.collection('lists').doc(signupId).get()).data();
  assert.match(signup.benefitsEmailedFor || '', /:20$/);
  assert.ok(signup.memberId);
  const volunteerEmails = (await db.collection('testMail').where('signupId', '==', signupId).get()).docs.map((document) => document.data());
  assert.equal(volunteerEmails.filter((message) => message.kind === 'volunteer-benefits').length, 1);
  assert.equal(volunteerEmails.find((message) => message.kind === 'volunteer-benefits').replyTo, email('volunteer-coordinator'));
});

await test('activating a volunteer lowers existing monthly payments and offers pro-rata refunds for items paid in full', async () => {
  const address = email('volunteer-subscriber');
  const details = adultDetails({ firstName: 'Vic', lastName: 'Subscriber', email: address });
  const orderRef = await buy(address, build(['membership-adult', 'blue-sub', 'keyhire'], [details]), { billingMode: 'monthly' });
  await call('POST', '/api/lists', { body: { name: 'Vic Subscriber', email: address, category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
  const signupId = (await db.collection('lists').where('email', '==', address).get()).docs[0].id;
  const before = (await call('GET', `/api/admin/volunteers/${signupId}/adjustments`, { headers: admin })).json;
  assert.deepEqual([before.monthly, before.annual], [[], []], 'nothing changes before activation');
  assert.equal((await call('GET', `/api/admin/volunteers/${signupId}/adjustments`)).status, 401);

  const activated = await call('PATCH', `/api/admin/volunteers/${signupId}`, { headers: admin, body: { active: true, tier: '20' } });
  assert.equal(activated.json.outcome, 'benefits-added', activated.text);
  const [subscription] = (await db.collection('subscriptions').where('orderRefs', 'array-contains', orderRef).get()).docs.map((document) => document.data());
  const blue = subscription?.items.find((item) => item.productId === 'blue-sub');
  const result = (await call('GET', `/api/admin/volunteers/${signupId}/adjustments`, { headers: admin })).json;
  if (!result.monthsLeft) {
    assert.deepEqual(result.annual, [], 'no refund is offered in the last month');
    return;
  }
  if (blue) {
    assert.equal(blue.monthlyAmount, 20, 'Blue drops from £25 to £20 from the next debit');
    assert.equal(blue.volunteerAdjustment.from, 25);
    assert.deepEqual(result.monthly.map((entry) => [entry.name, entry.adjustedFrom, entry.monthlyAmount, entry.pending]), [[blue.name, 25, 20, null]]);
    const member = (await db.collection('memberships').doc(blue.membershipIds[0]).get()).data();
    assert.equal(member.subscriptionItems.find((item) => item.productId === 'blue-sub').monthlyAmount, 20);
  }
  const key = result.annual.find((entry) => entry.orderRef === orderRef);
  assert.equal(key.adjusted, false);
  assert.equal(key.amount, Math.round(5000 * result.monthsLeft / 12), 'Boathouse Access: £50 ÷ 12 × months left');
  assert.equal(key.paymentIntent, `pi_${orderRef}`);
  const retried = await call('POST', `/api/admin/volunteers/${signupId}/adjust-monthly`, { headers: admin });
  assert.equal(retried.status, 200, retried.text);
  assert.equal((await db.collection('subscriptions').where('orderRefs', 'array-contains', orderRef).get()).docs[0]?.data().items
    .find((item) => item.productId === 'blue-sub')?.monthlyAmount ?? 20, 20, 'repeating changes nothing');
});

await test('admins save the three boathouse codes privately; only a changed code bumps their version', async () => {
  assert.equal((await call('GET', '/api/admin/boathouse-code')).status, 401);
  const access = { gateCode: `G${run}`, alarmCode: `A${run}`, lockboxCode: `L${run}`, gateNote: 'Front gate', alarmNote: '', lockboxNote: 'Key box' };
  assert.equal((await call('POST', '/api/admin/boathouse-code', { body: access })).status, 401);
  assert.equal((await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { ...access, alarmCode: '' } })).status, 400);
  const before = (await call('GET', '/api/admin/boathouse-code', { headers: admin })).json;
  const saved = await call('POST', '/api/admin/boathouse-code', { headers: admin, body: access });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.changed, true);
  assert.equal(saved.json.version, before.version + 1);
  const loaded = (await call('GET', '/api/admin/boathouse-code', { headers: admin })).json;
  assert.equal(loaded.gateCode, access.gateCode);
  assert.equal(loaded.gateNote, 'Front gate');
  assert.equal(loaded.alarmCode, access.alarmCode);
  assert.equal(loaded.lockboxCode, access.lockboxCode);
  assert.equal(loaded.lockboxNote, 'Key box');
  assert.equal(loaded.updatedBy, 'admin@forthcanoeclub.co.uk');
  const noteOnly = await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { ...access, gateNote: 'Main gate' } });
  assert.equal(noteOnly.json.changed, false);
  assert.equal(noteOnly.json.version, saved.json.version);
  assert.equal((await db.collection('settings').doc('boathouseCode').get()).data().gateNote, 'Main gate');
});

await test('inducted key holders keep boathouse access across volunteer activation, once per code version', async () => {
  const codeMail = async (signupId) => (await db.collection('testMail').where('signupId', '==', signupId).get()).docs
    .map((document) => document.data()).filter((mail) => ['boathouse-code', 'volunteer-boathouse-code'].includes(mail.kind));
  const before = await codeMail(shared.volunteerSignup);
  const current = (await db.collection('settings').doc('boathouseCode').get()).data();
  assert.equal(before.filter((mail) => mail.version === current.version).length, 1, 'saving the codes already notified this inducted key holder, even while inactive');
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { body: { active: true } })).status, 401);
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: 'yes' } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { inducted: false } })).status, 400, 'induction history cannot be removed');

  const ticked = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: true, inducted: true } });
  assert.equal(ticked.status, 200, ticked.text);
  assert.equal(ticked.json.boathouseCode, 'up-to-date');
  const first = (await codeMail(shared.volunteerSignup)).find((mail) => mail.version === current.version);
  assert.equal(first.replyTo, email('volunteer-coordinator'));
  for (const field of ['gateCode', 'alarmCode', 'lockboxCode']) assert.ok(first.body.includes(current[field]), `email includes ${field}`);
  assert.match(first.body, /Gate code: /);
  assert.match(first.body, /Alarm code: /);
  assert.match(first.body, /Lockbox code: /);
  assert.equal(first.version, current.version);
  const again = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: true } });
  assert.equal(again.json.boathouseCode, 'up-to-date');
  assert.equal((await codeMail(shared.volunteerSignup)).length, before.length, 'no repeat email');
  const listed = (await call('GET', '/api/admin/volunteers', { headers: admin })).json;
  assert.equal(listed.boathouseCodeSet, true);
  const row = listed.volunteers.find((volunteer) => volunteer.id === shared.volunteerSignup);
  assert.equal(row.active, true);
  assert.equal(row.boathouseCodeCurrent, true);

  // Activation also records induction, but non-members still receive no codes.
  const newcomerEmail = email('volunteer-not-inducted');
  await call('POST', '/api/lists', { body: { name: 'Otto Outsider', email: newcomerEmail, category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
  const newcomerId = (await db.collection('lists').where('email', '==', newcomerEmail).get()).docs[0].id;
  assert.equal((await call('PATCH', `/api/admin/volunteers/${newcomerId}`, { headers: admin, body: { active: true, tier: '20' } })).json.boathouseCode, 'not-active');
  assert.equal((await db.collection('lists').doc(newcomerId).get()).data().inducted, true);
  assert.equal((await codeMail(newcomerId)).length, 0);

  const noteOnly = await call('POST', '/api/admin/boathouse-code', {
    headers: admin, body: { ...current, gateNote: 'Back door' }
  });
  assert.equal(noteOnly.json.changed, false);
  assert.equal((await codeMail(shared.volunteerSignup)).length, before.length, 'a note-only save emails nobody');

  const changedCodes = { ...current, alarmCode: `${current.alarmCode}-new` };
  const changed = await call('POST', '/api/admin/boathouse-code', { headers: admin, body: changedCodes });
  assert.equal(changed.json.changed, true);
  assert.ok(changed.json.notified.sent >= 1, changed.text);
  const mails = await codeMail(shared.volunteerSignup);
  assert.equal(mails.length, before.length + 1);
  const updatedMail = mails.find((mail) => mail.version === changed.json.version);
  assert.match(updatedMail.body, /boathouse codes have changed/i);
  for (const field of ['gateCode', 'alarmCode', 'lockboxCode']) assert.ok(updatedMail.body.includes(changedCodes[field]), `updated email includes ${field}`);
  assert.equal((await codeMail(newcomerId)).length, 0, 'still nothing for a volunteer who is not a member');

  const untick = await call('PATCH', `/api/admin/volunteers/${shared.volunteerSignup}`, { headers: admin, body: { active: false } });
  assert.equal(untick.json.boathouseCode, 'not-active');
  await call('POST', '/api/admin/boathouse-code', { headers: admin, body: { ...changedCodes, gateCode: `${current.gateCode}-new` } });
  assert.equal((await codeMail(shared.volunteerSignup)).length, before.length + 2, 'deactivation preserves key access until an admin explicitly revokes it');
});

await test('induction grants key access independently of yearly benefits, and an unlinked volunteer gets codes after joining', async () => {
  const codeMail = async (signupId) => (await db.collection('testMail').where('signupId', '==', signupId).get()).docs
    .map((document) => document.data()).filter((mail) => ['boathouse-code', 'volunteer-boathouse-code'].includes(mail.kind));
  const signUp = async (name, address) => {
    await call('POST', '/api/lists', { body: { name, email: address, tier: '20', category: 'Volunteer Sign-ups', items: LIST_EXAMPLES['Volunteer Sign-ups'] } });
    return (await db.collection('lists').where('email', '==', address).get()).docs[0].id;
  };
  const patch = async (signupId, body) => (await call('PATCH', `/api/admin/volunteers/${signupId}`, { headers: admin, body })).json;

  const memberEmail = email('boathouse-member');
  await buy(memberEmail, build(['membership-adult'], [adultDetails({ firstName: 'Bea', lastName: 'Boathouse', email: memberEmail })]));
  const memberSignup = await signUp('Bea Boathouse', memberEmail);
  const inducted = await patch(memberSignup, { inducted: true });
  assert.equal(inducted.boathouseCode, 'sent', 'induction grants key access without activating yearly benefits');
  assert.equal((await codeMail(memberSignup)).length, 1);
  const [inductedMember] = await membershipsFor(memberEmail);
  assert.ok(inductedMember.keyAccess.grantedAt);
  assert.equal(inductedMember.volunteer.years[clubYearOf()].active, false);
  const checkedIn = await patch(memberSignup, { active: true });
  assert.equal(checkedIn.outcome, 'benefits-added');
  assert.equal(checkedIn.boathouseCode, 'up-to-date');
  assert.equal((await codeMail(memberSignup)).length, 1);
  assert.equal((await patch(memberSignup, { inducted: true })).boathouseCode, 'up-to-date', 'checking in again sends nothing new');
  assert.equal((await codeMail(memberSignup)).length, 1);

  const joinerEmail = email('boathouse-joiner');
  const joinerSignup = await signUp('Jo Joiner', joinerEmail);
  const awaiting = await patch(joinerSignup, { active: true, inducted: true });
  assert.equal(awaiting.outcome, 'awaiting-membership');
  assert.equal(awaiting.boathouseCode, 'not-active');
  await buy(joinerEmail, build(['membership-adult'], [adultDetails({ firstName: 'Jo', lastName: 'Joiner', email: joinerEmail })]));
  assert.equal((await codeMail(joinerSignup)).length, 1, 'joining sends the boathouse code to a checked-in active volunteer');
  assert.equal((await db.collection('lists').doc(joinerSignup).get()).data().discountCode, null, 'volunteers get automatic prices, not codes');
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
  const register = (await reportFor('members', memberId)).json.records;
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
  assert.deepEqual(first.map((item) => [item.id, item.pricePence, item.tripDiscountPence]), [[tripId, 2500, 1000], [courseId, 3500, undefined]],
    'boat hire in the same basket discounts the single-day trip only');
  assert.deepEqual(first[0].tripDiscountReasons, ['annual boat hire']);

  const held = await ticketLines(await buy(tripper, basket([], [tripId], returning)));
  assert.equal(held[0].pricePence, 2500, 'boat hire bought earlier this club year still counts');
  await buy(tripper, basket(['blue-sub'], [], returning));
  const both = await ticketLines(await buy(tripper, basket([], [tripId], returning)));
  assert.equal(both[0].pricePence, 1500);
  assert.equal(both[0].tripDiscountPence, 2000);

  const keyholder = email('keyholder');
  const keyOnly = await ticketLines(await buy(keyholder, basket(['membership-adult', 'keyhire'], [tripId], adultDetails({ firstName: 'Kay', lastName: 'Holder', email: keyholder }))));
  assert.equal(keyOnly[0].pricePence, 3500, 'key hire gives no trip discount');

  const forgedBasket = basket([], [tripId], { returning: true, firstName: 'Kay', lastName: 'Holder', dob: details.dob, disclaimerAccepted: true });
  const forged = await checkout(keyholder, forgedBasket, { items: forgedBasket.lines.map(({ id, lineId }) => ({ id, lineId, tripDiscount: 35, price: 0, tripDiscountPence: 3500, pricePence: 0 })) });
  assert.equal(forged.status, 200, forged.text);
  assert.equal((await ticketLines(forged.json.orderRef))[0].pricePence, 3500, 'the browser cannot send its own discount');

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
  assert.deepEqual([freeOrder.status, freeOrder.totalPence, freeOrder.paymentMethod, freeOrder.items[0].pricePence, freeOrder.items[0].tripDiscountPence], ['paid', 0, 'free', 0, 2000]);
  assert.equal((await call('GET', `/api/checkout-status?session_id=${started.json.sessionId}`)).json.status, 'paid');
  const freeReceipt = await call('GET', `/api/checkout-receipt?session_id=${started.json.sessionId}&receipt_token=${successUrl.searchParams.get('receipt_token')}`);
  assert.equal(freeReceipt.status, 200, freeReceipt.text);
  assert.equal(freeReceipt.json.receipt.payerEmail, tripper);
  const freeMail = await db.collection('testMail').where('orderRef', '==', started.json.orderRef).get();
  assert.equal(freeMail.size, 1, 'the free booking is emailed a receipt');
  assert.equal(freeMail.docs[0].data().retrievalUrl.split('/order/')[1], `${started.json.orderRef}.${successUrl.searchParams.get('receipt_token')}`,
    'the free booking email links with the payment-page token');
});

await test('admins set the trip discounts, checkout charges them, and own kit neither gives nor removes one', async () => {
  const single = { mode: 'single', startDate: '2027-05-08', startTime: '09:00', endTime: '17:00', days: 1, timeZone: 'Europe/London' };
  const tripId = `E2E-RULES-TRIP-${run}`;
  await db.collection('products').doc(tripId).set({ name: 'E2E rules trip', category: 'EVENTS', type: 'event-ticket', basePrice: 35, eventSchedule: single });
  const basket = (productIds, details, ownKit) => {
    const lines = [...productIds.map(lineFor), { id: tripId, lineId: `${tripId}-${makeId()}`, name: tripId, category: 'EVENTS', type: 'event-ticket', basePrice: 35, eventSchedule: single }];
    return { lines, people: assignLines([], lines, makeId).map((person) => ({ ...person, ...details, ownKitLineIds: ownKit ? [lines.at(-1).lineId] : [] })) };
  };
  // What Stripe is asked for: each line's price, and the order total.
  const charged = async (emailAddress, productIds, details, ownKit) => {
    const started = await checkout(emailAddress, basket(productIds, details, ownKit));
    assert.equal(started.status, 200, started.text);
    const order = (await db.collection('orders').doc(started.json.orderRef).get()).data();
    const trip = order.items.find((item) => item.id === tripId);
    assert.equal(trip.ownKit === true, ownKit);
    assert.equal(order.totalPence, order.items.reduce((sum, item) => sum + item.pricePence, 0));
    return { trip: trip.pricePence, reasons: trip.tripDiscountReasons };
  };
  // The basket's price for a returning member's trip, worked out as the browser does from the public rules and their lookup.
  const basketPrice = async (emailAddress, details) => {
    const { lines, people } = basket([], details, false);
    const tripHeld = (await call('POST', '/api/membership-names', { body: { email: emailAddress, dob: details.dob } })).json.names[0].tripHeld || [];
    const held = new Map([[people[0].id, tripHeld.map((productId) => ({ productId, clubYear: clubYearOf(new Date()) }))]]);
    const rules = (await call('GET', '/api/trip-discounts')).json.rules;
    return Math.round(calculateCart(applyTripDiscounts(lines, people, held, new Date(), rules), true, null).total * 100);
  };
  const settings = () => call('GET', '/api/admin/trip-discounts', { headers: admin });
  const save = (rules, headers = admin) => call('PUT', '/api/admin/trip-discounts', { headers, body: { rules } });

  const defaults = (await call('GET', '/api/trip-discounts')).json.rules;
  assert.deepEqual(defaults, DEFAULT_TRIP_DISCOUNTS, 'until an admin saves, the starting discounts apply');
  assert.equal((await call('GET', '/api/admin/trip-discounts')).status, 401);
  assert.equal((await save(defaults, {})).status, 401);
  const options = (await settings()).json.products;
  assert.ok(options.some((product) => product.id === 'keyhire') && !options.some((product) => product.category === 'MEMBERSHIP'), 'services and subscriptions can qualify');

  const holder = email('rules-holder');
  const holderDetails = adultDetails({ firstName: 'Hal', lastName: 'Holder', email: holder });
  const returningHolder = { returning: true, firstName: 'Hal', lastName: 'Holder', dob: holderDetails.dob, disclaimerAccepted: true };
  assert.deepEqual(await charged(holder, ['membership-adult', 'boat-hire'], holderDetails, true), { trip: 2500, reasons: ['annual boat hire'] },
    'buying boat hire with own kit ticked still gets the discount');
  await buy(holder, build(['membership-adult', 'boat-hire'], [holderDetails]));
  for (const ownKit of [false, true]) assert.equal((await charged(holder, [], returningHolder, ownKit)).trip, 2500, `held boat hire, own kit ${ownKit ? 'ticked' : 'unticked'}`);
  assert.equal(await basketPrice(holder, returningHolder), 2500, 'the basket shows what checkout charges');

  const owner = email('rules-owner');
  const ownerDetails = adultDetails({ firstName: 'Oona', lastName: 'Owner', email: owner });
  for (const ownKit of [false, true]) assert.equal((await charged(owner, ['membership-adult'], ownerDetails, ownKit)).trip, 3500, `no hire, own kit ${ownKit ? 'ticked' : 'unticked'}`);

  for (const [rules, message] of [[[{ ...defaults[0], productIds: ['no-such-product'] }], /services or subscriptions in the shop/],
    [[{ ...defaults[0], amount: 500 }], /between £0.01 and £100/], [[{ ...defaults[0], productIds: ['membership-adult'] }], /services or subscriptions/],
    [[defaults[0], { ...defaults[1], productIds: ['boat-hire'] }], /one trip discount only/], ['all', /Keep up to/]]) {
    const refused = await save(rules);
    assert.equal(refused.status, 400, refused.text);
    assert.match(refused.json.error, message);
  }
  assert.deepEqual((await call('GET', '/api/trip-discounts')).json.rules, defaults, 'a refused save changes nothing');

  const changed = [{ ...defaults[0], amount: 12.5 }, { id: 'key-hire', productIds: ['keyhire'], amount: 5, label: 'key hire', short: 'Key hire' }];
  const saved = await save(changed);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.rules, changed);
  assert.equal(saved.json.updatedBy, 'admin@forthcanoeclub.co.uk');
  assert.deepEqual((await call('GET', '/api/trip-discounts')).json.rules, changed, 'the basket prices with the saved rules');
  assert.deepEqual((await db.collection('settings').doc('tripDiscounts').get()).data().productIds, ['boat-hire', 'keyhire'], 'firestore.rules lock these products');
  for (const ownKit of [false, true]) assert.equal((await charged(holder, [], returningHolder, ownKit)).trip, 2250, 'the new amount is charged');
  assert.equal(await basketPrice(holder, returningHolder), 2250, 'and the basket shows it');
  assert.equal((await charged(owner, ['membership-adult'], ownerDetails, true)).trip, 3500);
  const keyBuyer = await charged(owner, ['membership-adult', 'keyhire'], ownerDetails, true);
  assert.deepEqual([keyBuyer.trip, keyBuyer.reasons], [3000, ['key hire']], 'a newly qualifying product gives its discount');
  const lookup = await call('POST', '/api/membership-names', { body: { email: holder, dob: holderDetails.dob } });
  assert.deepEqual(lookup.json.names[0].tripHeld, ['boat-hire'], 'returning members are told which held products qualify now');

  assert.equal((await save([])).status, 200);
  assert.equal((await charged(holder, [], returningHolder, false)).trip, 3500, 'with no rules nobody gets a trip discount');
  assert.equal(await basketPrice(holder, returningHolder), 3500);
  assert.equal((await save(DEFAULT_TRIP_DISCOUNTS)).status, 200);
  assert.equal((await charged(holder, [], returningHolder, true)).trip, 2500);
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

  // Without a close date, an event can be booked until the end of its last date, so a course can be joined part way through.
  const day = (offset) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const overId = `E2E-OVER-${run}`;
  const runningId = `E2E-RUNNING-${run}`;
  await db.collection('products').doc(overId).set({ name: 'E2E finished course', category: 'EVENTS', type: 'event-ticket', basePrice: 20,
    membershipRule: 'none', eventSchedule: { ...schedule, startDate: day(-3), days: 2 } });
  await db.collection('products').doc(runningId).set({ name: 'E2E running course', category: 'EVENTS', type: 'event-ticket', basePrice: 20,
    membershipRule: 'none', eventSchedule: { ...schedule, startDate: day(-2), days: 4 } });
  const over = await checkout(email('over'), basket(overId, () => ({})));
  assert.equal(over.status, 400);
  assert.match(over.json.error, /Bookings for E2E finished course have closed/);
  const running = await checkout(email('running'), basket(runningId, () => ({})));
  assert.equal(running.status, 200, JSON.stringify(running.json));

  const orderRef = await buy(visitor, basket(openId, (lines) => ({ ownKitLineIds: [lines[0].lineId] })));
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.items[0].ownKit, true, 'the own-kit tick is kept on the ticket');
  const contact = (await db.collection('memberships').doc(order.people[0].membershipId).get()).data();
  assert.equal(contact.contactOnly, true);
  assert.equal(contact.status, undefined, 'a non-member gets no membership status');
  assert.equal(contact.ownKitLineIds, undefined);
  const register = (await reportFor('members')).json.records;
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
  assert.match(mail[0].body, /Vic Visitor \(Adult, born .*\n {3}Phone: \+447911123456 .*\n {3}Emergency contact: Pat Friend, Friend, \+447911123457\n {3}Medical: Nut allergy/);
  assert.match(mail[0].body, /Kit: Bringing own kit/);
  assert.match(mail[0].body, /Kit: Needs boat hire \(not paid\)/);
  assert.match(mail[0].body, /Membership: No\n/);
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

// Monthly checks run at pinned dates (sent as X-Test-Now) so they do not depend on when the test runs. The autumn date
// is always in the future, so every first debit is still to come: October sells this club year only; January sells
// this year, next year or both; 1–7 February still sells this year's membership; 8–14 February only its services.
const londonNoon = (year, month, day) => new Date(Date.UTC(year, month, day, 12));
const autumnYear = londonNoon(new Date().getUTCFullYear(), 9, 10) > new Date() ? new Date().getUTCFullYear() : new Date().getUTCFullYear() + 1;
const autumn = testNow(londonNoon(autumnYear, 9, 10));
const january = testNow(londonNoon(autumnYear + 1, 0, 10));
const earlyFebruary = testNow(londonNoon(autumnYear + 1, 1, 5));
const lateFebruary = testNow(londonNoon(autumnYear + 1, 1, 10));
const thisYear = clubYearDates(autumnYear);
const nextYear = clubYearDates(autumnYear + 1);
const seconds = (date) => Math.floor(date.getTime() / 1000);
const withChoice = (basket, clubYearChoice) => ({ ...basket, lines: basket.lines.map((line) => ({ ...line, clubYearChoice })) });
const lessonId = `E2E-LESSONS-${run}`;
const lessonLine = () => ({ id: lessonId, lineId: `${lessonId}-${makeId()}`, name: 'E2E lesson block', category: 'SERVICES', type: 'subscription', pricingMode: 'subscription', allowMonthly: true, basePrice: 20 });
const lessonFor = (firstName) => {
  const lines = [lessonLine()];
  return { lines, people: assignLines([], lines, makeId).map((person) => ({ ...person, ...adultDetails({ firstName, lastName: 'Monthly', dob: yearsAgo(20), email: email(firstName.toLowerCase()) }) })) };
};
const orderData = async (orderRef) => (await db.collection('orders').doc(orderRef).get()).data();
const subscriptionIdsPaidBy = async (address) => (await db.collection('subscriptions').where('email', '==', address).get()).docs.map((document) => document.id).sort();
await db.collection('products').doc(lessonId).set({ name: 'E2E lesson block', category: 'SERVICES', pricingMode: 'subscription', allowMonthly: true, basePrice: 20, membershipRule: 'none' });

await test('a payer has one monthly subscription per club year for everyone they pay for, and staff can stop one member\'s items', async () => {
  const payer = email('monthly-split');
  const lines = [...['membership-adult', 'membership-adult', 'gold-sub', 'gold-sub'].map(lineFor), lessonLine()];
  const basket = { lines, people: assignLines([], lines, makeId).map((person, index) => ({ ...person, ...adultDetails(index === 0
    ? { firstName: 'Mona', lastName: 'Monthly', email: payer }
    : { firstName: 'Ben', lastName: 'Monthly', dob: yearsAgo(30), email: email('monthly-partner') }) })) };
  assert.equal(basket.people.length, 2);
  const orderRef = await buy(payer, basket, { billingMode: 'monthly' }, autumn);
  const order = await orderData(orderRef);
  const golds = order.items.filter((item) => item.id === 'gold-sub');
  assert.deepEqual(golds.map(({ pricePence, monthlyPence, debits }) => ({ pricePence, monthlyPence, debits })), [0, 1].map(() => ({ pricePence: 2400, monthlyPence: 3000, debits: 4 })),
    'checkout takes 80% of October; debits run November to February');
  assert.equal(order.subscriptionPlan.groups.length, 1);
  const [group] = order.subscriptionPlan.groups;
  assert.equal(group.clubYear, autumnYear);
  assert.equal(group.firstDebitAt.toMillis(), seconds(new Date(Date.UTC(autumnYear, 10, 1))) * 1000, 'debits start on 1 November');
  assert.equal(group.cutoffAt.toMillis(), thisYear.end.getTime(), 'and stop at the 1 March club-year end');
  assert.equal(group.created, true);
  assert.equal(order.stripeSubscriptionIds.length, 1, 'one Stripe subscription (one direct debit) for everything the payer pays monthly');
  const [subscriptionId] = order.stripeSubscriptionIds;
  assert.ok(order.items.filter((item) => item.monthly).every((item) => item.stripeSubscriptionId === subscriptionId && item.stripeSubscriptionItemId), 'every monthly line knows its Stripe item');
  assert.equal(order.subscriptionSetupNeedsStaff, false);
  const stored = (await db.collection('subscriptions').doc(subscriptionId).get()).data();
  assert.equal(stored.clubYear, autumnYear);
  assert.equal(stored.cancelAt.toMillis(), thisYear.end.getTime());
  assert.deepEqual(await subscriptionIdsPaidBy(payer), [subscriptionId]);

  const named = await Promise.all(order.people.map(async ({ membershipId }) => [(await db.collection('memberships').doc(membershipId).get()).data().firstName, membershipId]));
  const monaId = named.find(([firstName]) => firstName === 'Mona')[1];
  const benId = named.find(([firstName]) => firstName === 'Ben')[1];
  const listed = await call('GET', `/api/admin/subscriptions?orderRef=${orderRef}`, { headers: admin });
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.json.subscriptions.map((entry) => entry.id), [subscriptionId]);
  const items = listed.json.subscriptions[0].items;
  assert.deepEqual(items.filter((item) => item.membershipIds.includes(benId)).map((item) => item.productId), ['gold-sub']);
  assert.deepEqual(items.filter((item) => item.membershipIds.includes(monaId)).map((item) => item.productId).sort(), [lessonId, 'gold-sub'].sort());
  const benBefore = (await db.collection('memberships').doc(benId).get()).data();
  assert.deepEqual(benBefore.subscriptionItems.map(({ subscriptionId: id, productId, payerEmail, status, clubYear }) => ({ id, productId, payerEmail, status, clubYear })),
    [{ id: subscriptionId, productId: 'gold-sub', payerEmail: payer, status: 'active', clubYear: autumnYear }], 'Ben\'s record shows what he gets and who pays');
  const benList = await call('GET', `/api/admin/subscriptions?membershipId=${benId}`, { headers: admin });
  assert.deepEqual(benList.json.subscriptions.map((entry) => entry.id), [subscriptionId]);

  assert.equal((await call('POST', `/api/admin/subscriptions/${subscriptionId}/members/${benId}/cancel`)).status, 401, 'cancelling needs an admin');
  const unexplained = await call('POST', `/api/admin/subscriptions/${subscriptionId}/members/${benId}/cancel`, { headers: admin, body: { reason: ' ' } });
  assert.equal(unexplained.status, 400, 'stopping a payment needs a reason');
  assert.match(unexplained.json.error, /reason/i);
  const benCancelled = await call('POST', `/api/admin/subscriptions/${subscriptionId}/members/${benId}/cancel`, { headers: admin, body: { reason: 'Ben moved away' } });
  assert.equal(benCancelled.status, 200, benCancelled.text);
  assert.equal(benCancelled.json.cancelledWholeSubscription, false);
  assert.equal(benCancelled.json.subscription.status, 'active', 'the payer keeps paying for everyone else');
  assert.deepEqual(benCancelled.json.subscription.items.filter((item) => item.status === 'active').map((item) => item.productId).sort(), [lessonId, 'gold-sub'].sort());
  const benAfter = (await db.collection('memberships').doc(benId).get()).data();
  const benGoldEnds = (await entitlementsOf(benId)).find((privilege) => privilege.productId === 'gold-sub').endedAt;
  assert.ok(benGoldEnds && benGoldEnds.toMillis() > Date.now(), 'Ben\'s gold entitlement runs to the date it is paid up to');
  assert.equal(benAfter.subscriptionItems[0].status, 'cancelled');
  assert.ok(!(await entitlementsOf(monaId)).find((privilege) => privilege.productId === 'gold-sub').endedAt);
  const benAudit = (await db.collection('auditLog').where('stripeSubscriptionId', '==', subscriptionId).get()).docs.map((document) => document.data());
  assert.ok(benAudit.some((entry) => entry.kind === 'subscription' && entry.reason === 'Ben moved away'), 'the reason is in the audit log');
  assert.equal((await call('POST', `/api/admin/subscriptions/${subscriptionId}/members/${benId}/cancel`, { headers: admin, body: { reason: 'Again' } })).status, 409);

  const lesson = items.find((item) => item.productId === lessonId);
  const lessonCancelled = await call('POST', `/api/admin/subscriptions/${subscriptionId}/items/${lesson.lineId}/cancel`, { headers: admin, body: { reason: 'Lessons finished' } });
  assert.equal(lessonCancelled.status, 200, lessonCancelled.text);
  assert.equal(lessonCancelled.json.subscription.status, 'active', 'Mona\'s gold is still paid');
  assert.ok((await orderData(orderRef)).items.find((item) => item.lineId === lesson.lineId).monthlyCancelledAt);

  assert.equal((await pay(orderRef)).status, 200);
  assert.deepEqual((await orderData(orderRef)).stripeSubscriptionIds, [subscriptionId], 'a replayed webhook creates no new subscriptions');
  assert.equal((await db.collection('subscriptions').doc(subscriptionId).get()).data().items.filter((item) => item.status === 'active').length, 1, 'and does not undo cancellations');

  const laterRef = await buy(payer, lessonFor('Cara'), { billingMode: 'monthly' }, autumn);
  const later = await orderData(laterRef);
  assert.equal(later.subscriptionPlan.groups[0].created, false);
  assert.deepEqual(later.stripeSubscriptionIds, [subscriptionId], 'a later purchase with the same details joins the payer\'s direct debit for that club year');
  assert.equal(later.totalPence, 1600, 'it pays its own share of this month; the next debit is a full month');
  const joined = (await db.collection('subscriptions').doc(subscriptionId).get()).data();
  assert.deepEqual([...joined.orderRefs].sort(), [orderRef, laterRef].sort());
  assert.equal(joined.items.filter((item) => item.status === 'active').length, 2);
  assert.deepEqual((await call('GET', `/api/admin/subscriptions?orderRef=${laterRef}`, { headers: admin })).json.subscriptions.map((entry) => entry.id), [subscriptionId]);

  const cardPayer = email('new-card');
  const firstCardRef = await buy(cardPayer, lessonFor('Dan'), { billingMode: 'monthly' }, autumn);
  const firstCard = await orderData(firstCardRef);
  const secondCard = await orderData(await buy(cardPayer, lessonFor('Eve'), { billingMode: 'monthly' }, autumn));
  assert.notEqual(secondCard.stripeSubscriptionIds[0], firstCard.stripeSubscriptionIds[0], 'different card or bank details, which may be someone else\'s, get a new subscription');
  assert.equal(secondCard.subscriptionPlan.newPaymentDetails, true);
  assert.equal(secondCard.subscriptionSetupNeedsStaff, false);
  assert.deepEqual(await subscriptionIdsPaidBy(cardPayer),
    [firstCard.stripeSubscriptionIds[0], secondCard.stripeSubscriptionIds[0]].sort());
  const untouched = (await db.collection('subscriptions').doc(firstCard.stripeSubscriptionIds[0]).get()).data();
  assert.deepEqual(untouched.orderRefs, [firstCardRef], 'the existing subscription stays as it was');
  assert.deepEqual(untouched.items.map((item) => item.names), [['Dan Monthly']]);

  const failing = email('sub-fail');
  const failedRef = await buy(failing, lessonFor('Gus'), { billingMode: 'monthly' }, autumn);
  assert.equal((await orderData(failedRef)).subscriptionSetupNeedsStaff, true, 'a refused subscription is flagged for staff');
  const failedList = await call('GET', `/api/admin/subscriptions?orderRef=${failedRef}`, { headers: admin });
  assert.deepEqual(failedList.json.failed.map(({ itemNames, names, error }) => ({ itemNames, names, error })),
    [{ itemNames: ['E2E lesson block'], names: ['Gus Monthly'], error: 'Your card was declined.' }], 'staff see which item and member failed');
});

const openAttention = async () => (await call('GET', '/api/admin/attention', { headers: admin })).json.entries;
const detailsSession = async (address) => {
  const token = createHash('sha256').update(`details-${address}-${Date.now()}`).digest('hex');
  await db.collection('emailSessions').doc(sha256(token)).set({ email: address, purpose: 'details', expiresAt: Date.now() + 60 * 60 * 1000, createdAt: Date.now() });
  return { 'x-email-session': token };
};

await test('problems reach staff: a refused set-up is listed, can be retried and resolved with a note', async () => {
  const entry = (await openAttention()).find((candidate) => candidate.kind === 'subscription-setup' && candidate.email === email('sub-fail'));
  assert.ok(entry, 'the refused monthly set-up is in Needs attention');
  assert.equal(entry.retry, true);
  const retried = await call('POST', `/api/admin/attention/${entry.id}/retry`, { headers: admin, body: {} });
  assert.equal(retried.status, 409, 'a retry Stripe still refuses is reported, not hidden');
  assert.ok((await openAttention()).some((candidate) => candidate.id === entry.id), 'the entry stays open');
  assert.equal((await call('POST', `/api/admin/attention/${entry.id}/resolve`, { headers: admin, body: { note: 'Member paid by bank transfer.' } })).status, 200);
  assert.ok(!(await openAttention()).some((candidate) => candidate.id === entry.id));
  const resolved = (await db.collection('attention').doc(entry.id).get()).data();
  assert.equal(resolved.resolutionNote, 'Member paid by bank transfer.');
});

await test('deleting a member stops their monthly payments without a refund; the payer keeps paying for others', async () => {
  const payer = email('delete-monthly');
  const lines = ['membership-adult', 'membership-adult', 'gold-sub', 'gold-sub'].map(lineFor);
  const basket = { lines, people: assignLines([], lines, makeId).map((person, index) => ({ ...person, ...adultDetails(index === 0
    ? { firstName: 'Dora', lastName: 'Deleted', email: payer }
    : { firstName: 'Kit', lastName: 'Kept', dob: yearsAgo(30), email: email('delete-monthly-partner') }) })) };
  const orderRef = await buy(payer, basket, { billingMode: 'monthly' }, autumn);
  const order = await orderData(orderRef);
  const [subscriptionId] = order.stripeSubscriptionIds;
  const named = await Promise.all(order.people.map(async ({ membershipId }) => [(await db.collection('memberships').doc(membershipId).get()).data().firstName, membershipId]));
  const doraId = named.find(([firstName]) => firstName === 'Dora')[1];
  const kitId = named.find(([firstName]) => firstName === 'Kit')[1];
  const remove = (body) => call('DELETE', `/api/admin/records/members/${doraId}`, { headers: admin, body: { confirmId: doraId, reason: 'Left the club', ...body } });

  const unchecked = await remove({});
  assert.equal(unchecked.status, 409, 'Stripe must still be checked for subscriptions set up outside the website');
  assert.equal(unchecked.json.requiresStripeAcknowledgement, true);
  assert.ok(activeSubscriptionItems((await db.collection('subscriptions').doc(subscriptionId).get()).data()).some((item) => item.membershipIds.includes(doraId)),
    'nothing is cancelled until the deletion is confirmed');

  const deleted = await remove({ acknowledgeStripe: true });
  assert.equal(deleted.status, 200, deleted.text);
  assert.deepEqual(deleted.json.stoppedMonthly.map((entry) => entry.id), [subscriptionId]);
  assert.equal((await db.collection('memberships').doc(doraId).get()).exists, false);
  const subscription = (await db.collection('subscriptions').doc(subscriptionId).get()).data();
  assert.equal(subscription.status, 'active', 'the payer keeps paying for Kit');
  const active = activeSubscriptionItems(subscription);
  assert.ok(active.length && active.every((item) => !item.membershipIds.includes(doraId) && item.membershipIds.includes(kitId)));
  const audit = (await db.collection('auditLog').where('stripeSubscriptionId', '==', subscriptionId).get()).docs.map((document) => document.data());
  assert.ok(audit.some((entry) => entry.kind === 'subscription' && entry.reason === 'Member record deleted: Left the club'), 'the stop is in the audit log');
});

await test('a temporary Stripe fault is retried without a second subscription, and a member can ask to cancel', async () => {
  const payer = email('flaky');
  const result = await checkout(payer, lessonFor('Flo'), { billingMode: 'monthly' }, autumn);
  assert.equal(result.status, 200, result.text);
  assert.equal((await pay(result.json.orderRef)).status, 500, 'Stripe is asked to resend the webhook');
  const waiting = await orderData(result.json.orderRef);
  assert.equal(waiting.status, 'paid');
  assert.equal(waiting.subscriptionPlan.status, 'pending');
  assert.equal(waiting.subscriptionSetupNeedsStaff, undefined);
  assert.equal((await pay(result.json.orderRef)).status, 200, 'the resent webhook finishes the set-up');
  const order = await orderData(result.json.orderRef);
  assert.equal(order.subscriptionPlan.status, 'active');
  assert.equal(order.stripeSubscriptionIds.length, 1);
  const [subscriptionId] = order.stripeSubscriptionIds;

  const blocked = await call('DELETE', `/api/admin/records/orders/${result.json.orderRef}`, { headers: admin, body: { confirmId: result.json.orderRef, reason: 'Test order' } });
  assert.equal(blocked.status, 409, 'an order cannot be deleted while its monthly payments run');
  assert.equal(blocked.json.code, 'active_monthly_payments');
  assert.deepEqual(blocked.json.activeMonthly.map((entry) => entry.id), [subscriptionId]);

  const session = await detailsSession(payer);
  const details = await call('GET', '/api/my-details', { headers: session });
  assert.equal(details.status, 200, details.text);
  const monthly = details.json.monthlyPayments.find((entry) => entry.subscriptionId === subscriptionId);
  assert.ok(monthly, 'My details lists the monthly payments');
  assert.deepEqual(monthly.items.map(({ name, names, cancelRequested }) => ({ name, names, cancelRequested })),
    [{ name: 'E2E lesson block', names: ['Flo Monthly'], cancelRequested: false }]);
  const path = `/api/my-details/monthly/${subscriptionId}/cancel-request`;
  assert.equal((await call('POST', path, { headers: await detailsSession(email('someone-else')), body: { itemKeys: [monthly.items[0].key] } })).status, 404,
    'another email cannot ask to cancel these payments');
  const requested = await call('POST', path, { headers: session, body: { itemKeys: [monthly.items[0].key], reason: 'Moving away' } });
  assert.equal(requested.status, 200, requested.text);
  assert.equal((await call('POST', path, { headers: session, body: { itemKeys: [monthly.items[0].key] } })).status, 400, 'a request is only sent once');
  const entry = (await openAttention()).find((candidate) => candidate.kind === 'cancel-request' && candidate.subscriptionId === subscriptionId);
  assert.ok(entry, 'staff see the request');
  assert.match(entry.detail, /Moving away/);
  assert.equal((await db.collection('subscriptions').doc(subscriptionId).get()).data().status, 'active', 'staff make the change, not the request');
  assert.equal((await call('GET', '/api/my-details', { headers: session })).json.monthlyPayments.find((entry) => entry.subscriptionId === subscriptionId).items[0].cancelRequested, true);
});

await test('an older unpaid checkout is closed, and a bank payment still clearing cannot be paid twice', async () => {
  const payer = email('clearing');
  const basket = build(['membership-adult'], [adultDetails({ firstName: 'Cleo', lastName: 'Clearing', email: payer })]);
  const first = await checkout(payer, basket);
  assert.equal(first.status, 200, first.text);
  const second = await checkout(payer, basket);
  assert.equal(second.status, 200, second.text);
  assert.equal((await orderData(first.json.orderRef)).status, 'expired', 'the earlier checkout can no longer be paid');

  const order = await orderData(second.json.orderRef);
  const session = { id: order.stripe.sessionId, mode: 'payment', payment_status: 'unpaid', amount_total: order.totalPence,
    metadata: { order_ref: second.json.orderRef }, payment_intent: `pi_${second.json.orderRef}` };
  assert.equal((await sendWebhook({ type: 'checkout.session.completed', data: { object: session } })).status, 200);
  assert.equal((await call('GET', `/api/checkout-status?session_id=${order.stripe.sessionId}`)).json.status, 'processing');
  assert.equal((await orderData(second.json.orderRef)).stripe.processing, true);
  const third = await checkout(payer, basket);
  assert.equal(third.status, 409, 'the same person and item cannot be bought while the payment clears');
  assert.equal(third.json.code, 'payment_processing');

  assert.equal((await sendWebhook({ type: 'checkout.session.async_payment_failed', data: { object: session } })).status, 200);
  assert.equal((await orderData(second.json.orderRef)).status, 'payment_failed');
  assert.ok((await openAttention()).some((entry) => entry.kind === 'payment-failed' && entry.orderRef === second.json.orderRef), 'staff are told');
  assert.equal((await checkout(payer, basket)).status, 200, 'after a failed payment the member can try again');
});

await test('starting again after paying, before Stripe tells us, is refused rather than charged twice', async () => {
  const payer = email('paid-late');
  const basket = build(['membership-adult'], [adultDetails({ firstName: 'Pat', lastName: 'Late', email: payer })]);
  const first = await checkout(payer, basket);
  assert.equal(first.status, 200, first.text);
  const again = await checkout(payer, basket);
  assert.equal(again.status, 409, 'the earlier payment is found instead of a second payment page');
  assert.equal(again.json.code, 'already_paid');
  assert.equal((await orderData(first.json.orderRef)).status, 'paid', 'the earlier order is recorded from Stripe');
});

await test('from January members renew for next club year or buy both, with a separate direct debit for each year', async () => {
  const payer = email('renew-both');
  const details = adultDetails({ firstName: 'Bea', lastName: 'Both', email: payer });
  const october = await checkout(payer, withChoice(build(['membership-adult'], [details]), 'next'), {}, autumn);
  assert.equal(october.status, 400, 'next club year is not sold before 1 January');
  assert.equal(october.json.code, 'club_year_unavailable');

  const orderRef = await buy(payer, withChoice(build(['membership-adult', 'gold-sub'], [details]), 'both'), { billingMode: 'monthly' }, january);
  const order = await orderData(orderRef);
  assert.deepEqual(order.items.map(({ id, clubYear, pricePence }) => ({ id, clubYear, pricePence })).sort((a, b) => a.id.localeCompare(b.id) || a.clubYear - b.clubYear), [
    { id: 'gold-sub', clubYear: autumnYear, pricePence: 2400 }, { id: 'gold-sub', clubYear: autumnYear + 1, pricePence: 0 },
    { id: 'membership-adult', clubYear: autumnYear, pricePence: order.items.find((item) => item.id === 'membership-adult' && item.clubYear === autumnYear).pricePence },
    { id: 'membership-adult', clubYear: autumnYear + 1, pricePence: order.items.find((item) => item.id === 'membership-adult' && item.clubYear === autumnYear + 1).pricePence }
  ], '"both" is one basket line charged as two club years; next year\'s monthly item has nothing due now');
  assert.deepEqual(order.subscriptionPlan.groups.map(({ clubYear, firstDebitAt, cutoffAt }) => [clubYear, firstDebitAt.toMillis(), cutoffAt.toMillis()]), [
    [autumnYear, Date.UTC(autumnYear + 1, 1, 1), thisYear.end.getTime()],
    [autumnYear + 1, nextYear.start.getTime(), nextYear.end.getTime()]
  ], 'this year gets its 1 February debit; next year gets twelve debits from 1 March through 1 February');
  assert.equal(new Set(order.stripeSubscriptionIds).size, 2, 'each club year has its own subscription, cancelled at its own cut-off');
  const [member] = await membershipsFor(payer);
  assert.deepEqual([...member.clubYears].sort(), [autumnYear, autumnYear + 1]);
  assert.equal(member.validUntil.toMillis(), nextYear.end.getTime(), 'membership runs to the end of next club year');
  assert.deepEqual(member.subscriptionItems.map((item) => item.clubYear).sort(), [autumnYear, autumnYear + 1]);

  const returning = { returning: true, firstName: details.firstName, lastName: details.lastName, dob: details.dob, disclaimerAccepted: true };
  const again = await checkout(payer, withChoice(build(['gold-sub'], [returning]), 'next'), { billingMode: 'monthly' }, january);
  assert.equal(again.status, 409, 'a service already held for that club year cannot be bought again');
  assert.equal(again.json.code, 'already_held');
  const membershipAgain = await checkout(payer, withChoice(build(['membership-adult'], [returning]), 'next'), {}, january);
  assert.equal(membershipAgain.status, 409);
  assert.equal(membershipAgain.json.code, 'membership_active');
});

await test('next year\'s monthly items with nothing due now only save the payment details', async () => {
  const payer = email('renew-next');
  const details = adultDetails({ firstName: 'Nat', lastName: 'Next', email: payer });
  await buy(payer, withChoice(build(['membership-adult'], [details]), 'next'), {}, january);
  const returning = { returning: true, firstName: details.firstName, lastName: details.lastName, dob: details.dob, disclaimerAccepted: true };
  const thisYearGold = await checkout(payer, withChoice(build(['gold-sub'], [returning]), 'this'), { billingMode: 'monthly' }, january);
  assert.equal(thisYearGold.status, 409, 'next year\'s membership does not cover this year in January');
  const orderRef = await buy(payer, withChoice(build(['gold-sub'], [returning]), 'next'), { billingMode: 'monthly' }, january);
  const order = await orderData(orderRef);
  assert.equal(order.totalPence, 0);
  assert.equal(order.status, 'paid');
  assert.equal(order.stripe.setupIntentId, `seti_${orderRef}`, 'Checkout ran in setup mode');
  assert.equal(order.subscriptionPlan.status, 'active', order.subscriptionPlan.error);
  assert.equal(order.subscriptionPlan.groups[0].firstDebitAt.toMillis(), nextYear.start.getTime());
});

await test('this year\'s membership stops on 8 February and its monthly items are the joining charge only in February', async () => {
  const payer = email('february');
  const details = adultDetails({ firstName: 'Fen', lastName: 'February', email: payer });
  const orderRef = await buy(payer, withChoice(build(['membership-adult', 'gold-sub'], [details]), 'this'), { billingMode: 'monthly' }, earlyFebruary);
  const order = await orderData(orderRef);
  const gold = order.items.find((item) => item.id === 'gold-sub');
  assert.equal(gold.pricePence, 3000, 'all of February');
  assert.equal(gold.debits, 0);
  assert.ok(!order.subscriptionPlan, 'no direct debit is set up');
  assert.ok(!order.stripeSubscriptionIds?.length);

  const late = adultDetails({ firstName: 'Lou', lastName: 'Late', email: email('february-late') });
  const refused = await checkout(late.email, withChoice(build(['membership-adult'], [late]), 'this'), {}, lateFebruary);
  assert.equal(refused.status, 400);
  assert.equal(refused.json.code, 'club_year_unavailable');
  assert.equal((await checkout(late.email, withChoice(build(['membership-adult'], [late]), 'next'), {}, lateFebruary)).status, 200);
});

await test('a subscription ending at the club-year boundary voids an unpaid February debit and is flagged for staff', async () => {
  const ending = async (address, name, endedAt) => {
    const order = await orderData(await buy(address, lessonFor(name), { billingMode: 'monthly' }, autumn));
    const [id] = order.stripeSubscriptionIds;
    const result = await sendWebhook({ type: 'customer.subscription.deleted', data: { object: {
      id, status: 'canceled', ended_at: endedAt, metadata: { club_year: String(autumnYear), cutoff_at: String(seconds(thisYear.end)) } } } });
    assert.equal(result.status, 200, result.text);
    return (await db.collection('subscriptions').doc(id).get()).data();
  };
  const unpaid = await ending(email('unpaid-feb'), 'Una', seconds(thisYear.end) + 5);
  assert.equal(unpaid.status, 'ended');
  assert.equal(unpaid.endedAtCutoff, true);
  assert.deepEqual(unpaid.voidedInvoices.map((invoice) => invoice.amountDue), [20], 'Stripe will not collect it later');
  assert.equal(unpaid.needsStaff, true);
  const paid = await ending(email('paid-feb'), 'Pia', seconds(thisYear.end) + 5);
  assert.equal(paid.endedAtCutoff, true);
  assert.ok(!paid.needsStaff, 'a fully paid year ends quietly');
  const early = await ending(email('ended-early'), 'Eli', seconds(thisYear.start) + 60);
  assert.equal(early.endedAtCutoff, false);
  assert.equal(early.needsStaff, true, 'an unexpected ending is flagged');
});

await test('each monthly payment Stripe collects is receipted once, including subscriptions set up outside the site; a debit that failed first says it has now gone through', async () => {
  const payer = email('monthly-receipt');
  const details = adultDetails({ firstName: 'Rhi', lastName: 'Receipt', email: payer });
  const order = await orderData(await buy(payer, withChoice(build(['membership-adult', 'gold-sub'], [details]), 'this'), { billingMode: 'monthly' }, autumn));
  const [subscriptionId] = order.stripeSubscriptionIds;
  const receipts = async () => (await db.collection('testMail').where('subscriptionId', '==', subscriptionId).get()).docs
    .map((document) => document.data()).filter((mail) => mail.kind === 'invoice-paid');
  const start = seconds(order.subscriptionPlan.groups[0].firstDebitAt.toDate());
  const period = { start, end: start + 31 * 24 * 60 * 60 };
  const { items } = (await db.collection('subscriptions').doc(subscriptionId).get()).data();
  const lines = items.map((item) => ({ subscription_item: item.stripeItemId, amount: Math.round(item.monthlyAmount * 100), period, description: `1 × ${item.name}` }));
  const amountPaid = lines.reduce((sum, line) => sum + line.amount, 0);
  const invoice = (id, fields = {}) => ({ id, subscription: subscriptionId, amount_paid: amountPaid, number: `RCPT-${id}`,
    status_transitions: { paid_at: start }, lines: { data: lines }, ...fields });

  assert.equal((await sendWebhook({ type: 'invoice.paid', data: { object: invoice(`in_trial_${subscriptionId}`, { amount_paid: 0 }) } })).status, 200);
  assert.equal((await receipts()).length, 0, 'the free trial invoice at set-up is not a payment');

  const first = `in_first_${subscriptionId}`;
  for (let resend = 0; resend < 2; resend += 1) assert.equal((await sendWebhook({ type: 'invoice.paid', data: { object: invoice(first) } })).status, 200);
  const [receipt, ...repeats] = await receipts();
  assert.equal(repeats.length, 0, 'Stripe resending the event does not send a second receipt');
  assert.equal(receipt.email, payer);
  assert.equal(receipt.subject, `Your Forth Canoe Club subscription payment receipt - RCPT-${first}`);
  assert.match(receipt.body, /^Forth Canoe Club subscription payment receipt\n/, 'the checkout receipt layout, headed as a subscription payment');
  assert.match(receipt.body, new RegExp(`Invoice: RCPT-${first}\nPaid by: ${payer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\nPaid: `));
  assert.match(receipt.body, new RegExp(`Total paid: £${(amountPaid / 100).toFixed(2)}`));
  assert.match(receipt.body, /\nRhi Receipt\n/, 'items are listed under the person they are for');
  for (const item of items) assert.match(receipt.body, new RegExp(`- ${item.name}: £${item.monthlyAmount.toFixed(2)} monthly payment`), 'every item paid monthly is listed');
  assert.doesNotMatch(receipt.body, /Discount or account credit|Adjustment/);
  assert.match(receipt.html, />Subscription payment</);

  const late = `in_late_${subscriptionId}`;
  assert.equal((await sendWebhook({ type: 'invoice.payment_failed', data: { object: { id: late, subscription: subscriptionId, amount_due: 3000,
    attempt_count: 1, next_payment_attempt: start + 3 * 24 * 60 * 60, customer_email: payer, lines: { data: [{ period: { start, end: start + 1 } }] } } } })).status, 200);
  assert.equal((await sendWebhook({ type: 'invoice.paid', data: { object: invoice(late) } })).status, 200);
  const recovered = (await receipts()).find((mail) => mail.invoiceId === late);
  assert.match(recovered.body, /has now gone through, so there is nothing more to do/);

  const outside = 'sub_set_up_outside_site';
  const outsideReceipts = async () => (await db.collection('testMail').where('subscriptionId', '==', outside).get()).docs
    .map((document) => document.data()).filter((mail) => mail.kind === 'invoice-paid');
  await db.collection('stripeSubscriptions').doc(`FCC-test-${outside}`).set({ membershipIds: [order.people[0].membershipId] }, { merge: true });
  const external = invoice('in_outside', { subscription: outside, customer_email: payer, livemode: false, amount_paid: 2500,
    lines: { data: [{ subscription_item: 'si_outside', amount: 2500, description: '1 × Blue Subscription (at £25.00 / month)', period }] } });
  for (let resend = 0; resend < 2; resend += 1) assert.equal((await sendWebhook({ type: 'invoice.paid', data: { object: external } })).status, 200);
  const [outsideReceipt, ...outsideRepeats] = await outsideReceipts();
  assert.equal(outsideRepeats.length, 0, 'a subscription set up outside the site is receipted once too');
  assert.equal(outsideReceipt.email, payer, 'it goes to the payer email on the Stripe invoice');
  assert.equal(outsideReceipt.setUpOutsideSite, true);
  assert.match(outsideReceipt.body, /Other items:\n- Blue Subscription: £25\.00 monthly payment/, 'items come from the invoice lines');
  assert.match(outsideReceipt.html, /For: Rhi Receipt/, 'with the names of members the subscriber import linked');
  assert.match(outsideReceipt.body, /Total paid: £25\.00/);
  assert.equal((await sendWebhook({ type: 'invoice.paid', data: { object: invoice('in_outside_no_email', { subscription: 'sub_no_payer_email' }) } })).status, 200);
  assert.equal((await db.collection('testMail').where('invoiceId', '==', 'in_outside_no_email').get()).size, 0, 'no payer email, no receipt');
});

await test('failed monthly debits email the member each time; when Stripe gives up, benefits end at the paid-up date and can be restarted', async () => {
  const payer = email('debit-fail');
  const details = adultDetails({ firstName: 'Dee', lastName: 'Debit', email: payer });
  const order = await orderData(await buy(payer, withChoice(build(['membership-adult', 'gold-sub'], [details]), 'this'), { billingMode: 'monthly' }, autumn));
  const [subscriptionId] = order.stripeSubscriptionIds;
  const paidUpSeconds = seconds(order.subscriptionPlan.groups[0].firstDebitAt.toDate());
  const mails = async (kind) => (await db.collection('testMail').where('subscriptionId', '==', subscriptionId).get()).docs
    .map((document) => document.data()).filter((mail) => mail.kind === kind);
  const failed = (attempt, nextAttempt) => sendWebhook({ type: 'invoice.payment_failed', data: { object: {
    id: `in_${subscriptionId}`, subscription: subscriptionId, amount_due: 2400, attempt_count: attempt, next_payment_attempt: nextAttempt, customer_email: payer,
    lines: { data: [{ period: { start: paidUpSeconds, end: paidUpSeconds + 31 * 24 * 60 * 60 } }] } } } });
  const invoiceAttention = async () => (await openAttention()).filter((entry) => entry.kind === 'invoice-failed' && entry.subscriptionId === subscriptionId);

  assert.equal((await failed(1, paidUpSeconds + 3 * 24 * 60 * 60)).status, 200);
  assert.equal((await failed(1, paidUpSeconds + 3 * 24 * 60 * 60)).status, 200, 'Stripe resends the event');
  const [retrying, ...repeats] = await mails('invoice-failed');
  assert.equal(repeats.length, 0, 'each attempt is emailed once');
  assert.equal(retrying.email, payer);
  assert.match(retrying.body, /£24\.00/);
  assert.match(retrying.body, /try again on/);
  assert.doesNotMatch(retrying.body, /restart=/);
  assert.equal((await mails('treasurer-copy')).length, 0, 'the treasurer is copied only once Stripe gives up');
  assert.equal((await invoiceAttention()).length, 0, 'staff are not asked to act while Stripe retries');

  assert.equal((await failed(4, null)).status, 200);
  const final = (await mails('invoice-failed')).find((mail) => mail.final);
  assert.match(final.body, /stopped/);
  const key = /restart=(\S+)/.exec(final.body)[1];
  assert.ok(final.body.includes(`/payment-issue?subscription=${key}`));
  const [copy] = await mails('treasurer-copy');
  assert.equal(copy.email, 'treasurer@forthcanoeclub.co.uk');
  assert.ok(copy.body.includes(payer));
  assert.equal((await invoiceAttention()).length, 1, 'staff see that Stripe has stopped retrying');

  const tooSoon = await call('GET', `/api/subscriptions/${key}/restart`, { headers: autumn });
  assert.equal(tooSoon.status, 409, 'until Stripe cancels, the payments are still running');
  assert.equal(tooSoon.json.code, 'payments_running');

  const ended = await sendWebhook({ type: 'customer.subscription.deleted', data: { object: {
    id: subscriptionId, status: 'canceled', ended_at: seconds(new Date()), cancellation_details: { reason: 'payment_failed' },
    metadata: { club_year: String(autumnYear), cutoff_at: String(seconds(thisYear.end)) } } } });
  assert.equal(ended.status, 200, ended.text);
  const record = (await db.collection('subscriptions').doc(subscriptionId).get()).data();
  assert.equal(record.status, 'ended');
  assert.equal(record.paidUntil.toMillis(), paidUpSeconds * 1000, 'paid up to the start of the unpaid month');
  assert.ok(record.items.every((item) => item.status !== 'active' && item.cancelledBy === 'stripe'));
  const [member] = await membershipsFor(payer);
  assert.equal(member.validUntil.toMillis(), thisYear.end.getTime(), 'the membership itself was paid in full, so it runs on');
  assert.ok(!member.subscriptionItems.some((item) => item.status === 'active'), 'the monthly benefits end');
  assert.equal((await mails('subscription-stopped')).length, 0, 'the member already had the final email with the links');

  const december = testNow(londonNoon(autumnYear, 11, 10));
  const restart = await call('GET', `/api/subscriptions/${key}/restart`, { headers: december });
  assert.equal(restart.status, 200, restart.text);
  assert.equal(restart.json.billingMode, 'monthly');
  assert.equal(restart.json.email, payer);
  assert.deepEqual(restart.json.items.map((item) => item.id), ['gold-sub'], 'only what Stripe stopped');
  assert.deepEqual(restart.json.people.map((person) => [person.firstName, person.returning, person.lineIds.length]), [['Dee', true, 1]]);
  assert.deepEqual(restart.json.people[0].prefill, { disclaimer: true, disclaimerChanged: false, photoConsent: true, photoChanged: false, notices: await currentNoticeVersions() },
    'the answers on the record are offered in advance');

  const people = restart.json.people.map((person) => applyConsentPrefill(person, person.prefill));
  const resumed = await checkout(payer, { lines: restart.json.items, people }, { billingMode: 'monthly', restartOf: key }, december);
  assert.equal(resumed.status, 200, resumed.text);
  assert.equal((await orderData(resumed.json.orderRef)).restartOf, subscriptionId);
  assert.equal((await pay(resumed.json.orderRef)).status, 200);
  assert.equal((await db.collection('subscriptions').doc(subscriptionId).get()).data().restartedAs, resumed.json.orderRef);
  assert.equal((await invoiceAttention()).length, 0, 'restarting settles the failed debit');
  assert.equal((await call('GET', `/api/subscriptions/${key}/restart`, { headers: december })).json.code, 'payments_restarted');
  const twice = await checkout(payer, { lines: restart.json.items, people }, { billingMode: 'monthly', restartOf: key }, december);
  assert.equal(twice.status, 409);
  assert.equal(twice.json.code, 'already_paid');
});

await test('when Stripe cancels without a final failure email, the member is told and can confirm the payments are stopping', async () => {
  const payer = email('debit-fail.quiet');
  const order = await orderData(await buy(payer, lessonFor('Quinn'), { billingMode: 'monthly' }, autumn));
  const [subscriptionId] = order.stripeSubscriptionIds;
  const ended = await sendWebhook({ type: 'customer.subscription.deleted', data: { object: {
    id: subscriptionId, status: 'canceled', ended_at: seconds(new Date()), metadata: { club_year: String(autumnYear), cutoff_at: String(seconds(thisYear.end)) } } } });
  assert.equal(ended.status, 200, ended.text);
  const stopped = (await db.collection('testMail').where('subscriptionId', '==', subscriptionId).get()).docs.map((document) => document.data())
    .filter((mail) => mail.kind === 'subscription-stopped');
  assert.equal(stopped.length, 1);
  const key = /subscription=(\S+)/.exec(stopped[0].body)[1];
  assert.equal((await call('GET', `/api/subscriptions/${subscriptionId}.${'0'.repeat(64)}/restart`)).status, 404, 'a wrong token is refused');
  const cancelled = await call('POST', `/api/subscriptions/${key}/cancel`);
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(cancelled.json.decision, 'cancelled');
  assert.equal((await call('POST', `/api/subscriptions/${key}/cancel`)).status, 200, 'confirming twice is harmless');
  assert.ok(!(await openAttention()).some((entry) => entry.kind === 'subscription-ended' && entry.subscriptionId === subscriptionId), 'staff need do nothing');
  assert.equal((await call('GET', `/api/subscriptions/${key}/restart`)).json.code, 'payments_cancelled');
});

await test('a failed bank payment emails links to retry the same basket or cancel the order', async () => {
  const failedOrder = async (payer, firstName) => {
    const started = await checkout(payer, build(['membership-adult'], [adultDetails({ firstName, lastName: 'Bank', email: payer })]));
    assert.equal(started.status, 200, started.text);
    const order = await orderData(started.json.orderRef);
    assert.equal((await sendWebhook({ type: 'checkout.session.async_payment_failed', data: { object: {
      id: order.stripe.sessionId, metadata: { order_ref: started.json.orderRef } } } })).status, 200);
    const mail = (await db.collection('testMail').where('orderRef', '==', started.json.orderRef).get()).docs.map((document) => document.data())
      .find((entry) => entry.kind === 'payment-failed');
    return { orderRef: started.json.orderRef, retryKey: /retry=(\S+)/.exec(mail.body)[1], cancelKey: /payment-issue\?order=(\S+)/.exec(mail.body)[1] };
  };
  const payer = email('retry-bank');
  const { orderRef, retryKey, cancelKey } = await failedOrder(payer, 'Rory');
  assert.equal(retryKey, cancelKey);
  const retry = await call('GET', `/api/orders/${retryKey}/retry`);
  assert.equal(retry.status, 200, retry.text);
  assert.equal(retry.json.email, payer);
  assert.deepEqual(retry.json.items.map((item) => item.id), ['membership-adult']);
  assert.equal(retry.json.people[0].firstName, 'Rory');
  assert.ok(!('membershipId' in retry.json.people[0]));
  assert.deepEqual([retry.json.people[0].disclaimerAccepted, retry.json.people[0].photoConsent], [false, false], 'boxes are only ticked from the offered answers');
  assert.deepEqual(retry.json.people[0].prefill, { disclaimer: true, disclaimerChanged: false, photoConsent: true, photoChanged: false, notices: await currentNoticeVersions() },
    'the answers given on the failed order are offered while their wording is current');
  const retryPeople = retry.json.people.map((person) => applyConsentPrefill(person, person.prefill));

  const again = await checkout(payer, { lines: retry.json.items, people: retryPeople }, { retryOf: retryKey });
  assert.equal(again.status, 200, again.text);
  assert.equal((await orderData(again.json.orderRef)).retryOf, orderRef);
  assert.equal((await pay(again.json.orderRef)).status, 200);
  assert.equal((await orderData(orderRef)).retriedAs, again.json.orderRef);
  assert.ok(!(await openAttention()).some((entry) => entry.kind === 'payment-failed' && entry.orderRef === orderRef), 'paying again settles it for staff');
  assert.equal((await call('GET', `/api/orders/${retryKey}/retry`)).json.code, 'order_retried');
  const twice = await checkout(payer, { lines: retry.json.items, people: retryPeople }, { retryOf: retryKey });
  assert.equal(twice.status, 409);
  assert.equal(twice.json.code, 'already_paid');
  assert.equal((await call('POST', `/api/orders/${cancelKey}/cancel`)).json.code, 'order_retried', 'a paid retry cannot be cancelled');

  const other = await failedOrder(email('cancel-bank'), 'Cara');
  const cancelled = await call('POST', `/api/orders/${other.cancelKey}/cancel`);
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal((await orderData(other.orderRef)).status, 'cancelled');
  assert.equal((await call('POST', `/api/orders/${other.cancelKey}/cancel`)).status, 200, 'cancelling twice is harmless');
  assert.equal((await call('GET', `/api/orders/${other.retryKey}/retry`)).json.code, 'order_cancelled');
  assert.ok(!(await openAttention()).some((entry) => entry.kind === 'payment-failed' && entry.orderRef === other.orderRef));
  assert.equal((await call('GET', `/api/orders/${other.orderRef}.${'0'.repeat(64)}/retry`)).status, 404, 'a wrong token is refused');
});

await test('earlier answers are offered only for the wording in force now; a no and a withdrawal in My details carry to the next checkout', async () => {
  const address = email('consent-prefill');
  const details = adultDetails({ firstName: 'Pria', lastName: 'Prefill', dob: yearsAgo(41, 3, 3), email: address });
  await buy(address, build(['membership-adult'], [details]));
  const [joined] = await membershipsFor(address);
  const noticeVersions = await currentNoticeVersions();
  const offered = async (dob = details.dob) => (await call('POST', '/api/membership-names', { body: { email: address, dob } })).json.names;
  assert.deepEqual((await offered())[0].prefill, { disclaimer: true, disclaimerChanged: false, photoConsent: true, photoChanged: false, notices: noticeVersions });
  assert.deepEqual(await offered(yearsAgo(42, 3, 3)), [], 'nothing is offered without the matching date of birth');

  const returning = { returning: true, firstName: 'Pria', lastName: 'Prefill', dob: details.dob };
  const unticked = await checkout(address, build(['keyhire'], [{ ...returning, disclaimerAccepted: false, photoConsent: true }]));
  assert.equal(unticked.status, 400, 'unticking the disclaimer blocks checkout; it is not a withdrawal');
  assert.match(unticked.json.error, /disclaimer must be accepted/);
  for (const wording of [undefined, { ...checkoutWording(), photoVideo: '00000000' }]) {
    const stale = await checkout(address, build(['keyhire'], [{ ...returning, disclaimerAccepted: true, photoConsent: true }]), { wording });
    assert.equal(stale.status, 409, 'a page showing older consent wording must reload');
    assert.equal(stale.json.code, 'wording_changed');
  }

  // New photo consent wording: the earlier yes no longer counts, and checkout can say why.
  await db.collection('policies').doc('photo-video-consent').set({ currentHash: 'older wording' }, { merge: true });
  const synced = await call('POST', '/api/admin/policies/sync', { headers: admin });
  assert.equal(synced.status, 200, synced.text);
  const photoVersion = synced.json.recorded.find((entry) => entry.key === 'photo-video-consent')?.version;
  assert.equal(photoVersion, joined.consents.photoVideo.version + 1);
  assert.deepEqual((await offered())[0].prefill, { disclaimer: true, disclaimerChanged: false, photoConsent: false, photoChanged: true, notices: noticeVersions });

  // A no is an answer: it replaces the yes (including fields only older records had) and is kept in the history.
  await db.collection('memberships').doc(joined.id).update({ 'consents.photoVideo.legacyUnversioned': true });
  const declinedRef = await buy(address, build(['keyhire'], [{ ...returning, disclaimerAccepted: true, photoConsent: false }]));
  const declined = (await db.collection('memberships').doc(joined.id).get()).data().consents;
  const { recordedAt, notices, ...answered } = declined.photoVideo;
  assert.deepEqual(answered, { policyKey: 'photo-video-consent', version: photoVersion, accepted: false, by: 'self', source: 'checkout', orderRef: declinedRef },
    'nothing from the older record is left');
  assert.ok(recordedAt.toMillis() > joined.consents.photoVideo.recordedAt.toMillis());
  assert.deepEqual(Object.fromEntries(notices.map((entry) => [entry.noticeId, entry.version])), noticeVersions, 'the notice versions in force are kept with the answer');
  assert.deepEqual(declined.photoVideoHistory.map((entry) => [entry.accepted, entry.version]), [[true, photoVersion - 1], [false, photoVersion]]);
  assert.deepEqual((await offered())[0].prefill, { disclaimer: true, disclaimerChanged: false, photoConsent: false, photoChanged: false, notices: noticeVersions });

  // My details: anyone in the household can be changed by its contact address, and only theirs.
  const session = await detailsSession(address);
  const shown = await call('GET', '/api/my-details', { headers: session });
  assert.equal(shown.status, 200, shown.text);
  const household = shown.json.households.find((entry) => entry.people.some((person) => person.memberId === joined.id));
  assert.equal(household.people.find((person) => person.memberId === joined.id).photoConsent, false);
  const answer = (accepted, extra = {}, headers = session, memberId = joined.id) => call('PUT',
    `/api/my-details/${household.id}/photo-consent/${memberId}`, { headers, body: { accepted, ...extra } });
  assert.equal((await answer(true)).json.code, 'wording_changed', 'consent is only given to the wording shown');
  assert.equal((await answer(true, { wording: checkoutWording() }, await detailsSession(email('someone-else')))).status, 404);
  assert.equal((await answer(false, {}, session, shared.alexMembership)).status, 404, 'someone outside the household cannot be changed');
  const given = await answer(true, { wording: checkoutWording() });
  assert.equal(given.status, 200, given.text);
  assert.equal(given.json.household.people.find((person) => person.memberId === joined.id).photoConsent, true);
  const regiven = (await db.collection('memberships').doc(joined.id).get()).data().consents;
  assert.deepEqual([regiven.photoVideo.accepted, regiven.photoVideo.version, regiven.photoVideo.by, regiven.photoVideo.source, regiven.photoVideo.orderRef],
    [true, photoVersion, 'household-contact', 'my-details', null]);
  assert.equal(regiven.photoVideoHistory.length, 3);
  assert.ok((await db.collection('selfServiceChanges').where('memberId', '==', joined.id).get()).docs.some((document) => document.data().fields.includes('photoConsent')),
    'the change is logged for staff');
  assert.equal((await offered())[0].prefill.photoConsent, true);

  // A withdrawal after a payment failed beats the answer on the failed order when it is retried.
  const started = await checkout(address, build(['boat-hire'], [{ ...returning, disclaimerAccepted: true, photoConsent: true }]));
  assert.equal(started.status, 200, started.text);
  const failedOrder = await orderData(started.json.orderRef);
  assert.equal((await sendWebhook({ type: 'checkout.session.async_payment_failed', data: { object: {
    id: failedOrder.stripe.sessionId, metadata: { order_ref: started.json.orderRef } } } })).status, 200);
  const failedMail = (await db.collection('testMail').where('orderRef', '==', started.json.orderRef).get()).docs.map((document) => document.data())
    .find((entry) => entry.kind === 'payment-failed');
  const retryKey = /retry=(\S+)/.exec(failedMail.body)[1];
  const withdrawn = await answer(false);
  assert.equal(withdrawn.status, 200, withdrawn.text);
  assert.equal(withdrawn.json.changed, true);
  assert.equal((await answer(false)).json.changed, false, 'the same answer again changes nothing');
  assert.equal((await db.collection('memberships').doc(joined.id).get()).data().consents.photoVideoHistory.length, 4);
  assert.equal((await offered())[0].prefill.photoConsent, false, 'the next checkout reflects the withdrawal');
  const retry = await call('GET', `/api/orders/${retryKey}/retry`);
  assert.equal(retry.status, 200, retry.text);
  assert.deepEqual([retry.json.people[0].prefill.disclaimer, retry.json.people[0].prefill.photoConsent], [true, false], 'the newer withdrawal wins');
  assert.equal((await call('POST', `/api/orders/${retryKey}/cancel`)).status, 200);
});

await test('a delayed bank payment backdates the subscription to its missed 1st', async () => {
  // Checkout 40 days ago, paid only now: the first 1st has passed.
  const checkedOut = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const { debits, subscriptionEnd } = monthlyDebits(clubYearOf(checkedOut), checkedOut);
  const schedule = debits > 0 && nextFirst(new Date()) < subscriptionEnd;
  if (!schedule) { console.log('       (skipped: too close to the club-year change)'); return; }
  const orderRef = await buy(email('delayed'), lessonFor('Del'), { billingMode: 'monthly' }, testNow(checkedOut));
  const order = await orderData(orderRef);
  assert.equal(order.subscriptionPlan.status, 'active', order.subscriptionPlan.error);
  assert.equal(order.subscriptionPlan.groups[0].created, true);
});

await test('a delayed checkout cannot restore photo consent withdrawn while its bank payment clears', async () => {
  const payer = email('delayed-consent');
  const details = adultDetails({ firstName: 'Dana', lastName: 'Delayed', email: payer });
  await buy(payer, build(['membership-adult'], [details]));
  const [member] = await membershipsFor(payer);
  const returning = { returning: true, firstName: details.firstName, lastName: details.lastName, dob: details.dob,
    disclaimerAccepted: true, photoConsent: true };
  const started = await checkout(payer, build(['boat-hire'], [returning]));
  assert.equal(started.status, 200, started.text);
  const order = await orderData(started.json.orderRef);
  assert.equal(order.photoConsentAsked, true);
  const session = { id: order.stripe.sessionId, mode: 'payment', payment_status: 'unpaid', amount_total: order.totalPence,
    metadata: { order_ref: started.json.orderRef }, payment_intent: `pi_${started.json.orderRef}` };
  assert.equal((await sendWebhook({ type: 'checkout.session.completed', data: { object: session } })).status, 200);

  const sessionHeaders = await detailsSession(payer);
  const detailsPage = await call('GET', '/api/my-details', { headers: sessionHeaders });
  const household = detailsPage.json.households.find((entry) => entry.people.some((person) => person.memberId === member.id));
  const withdrawal = await call('PUT', `/api/my-details/${household.id}/photo-consent/${member.id}`, {
    headers: sessionHeaders, body: { accepted: false }
  });
  assert.equal(withdrawal.status, 200, withdrawal.text);
  const withdrawn = (await db.collection('memberships').doc(member.id).get()).data().consents.photoVideo;
  assert.equal(withdrawn.accepted, false);

  assert.equal((await sendWebhook({ type: 'checkout.session.async_payment_succeeded', data: { object: { ...session, payment_status: 'paid' } } })).status, 200);
  const after = (await db.collection('memberships').doc(member.id).get()).data().consents;
  assert.equal(after.photoVideo.accepted, false, 'the later withdrawal remains the current answer');
  assert.equal(after.photoVideo.recordedAt.toMillis(), withdrawn.recordedAt.toMillis());
  assert.ok(after.photoVideoHistory.some((entry) => entry.accepted === true && entry.orderRef === started.json.orderRef
    && entry.recordedAt.toMillis() === order.createdAt.toMillis()), 'the earlier checkout answer remains in history at its answer time');
});

await test('a pre-deploy order without a photo-consent marker does not create a false withdrawal', async () => {
  const payer = email('legacy-consent-order');
  const details = adultDetails({ firstName: 'Lee', lastName: 'Legacy', email: payer });
  await buy(payer, build(['membership-adult'], [details]));
  const [member] = await membershipsFor(payer);
  const before = (await db.collection('memberships').doc(member.id).get()).data().consents;
  const returning = { returning: true, firstName: details.firstName, lastName: details.lastName, dob: details.dob,
    disclaimerAccepted: true, photoConsent: false };
  const started = await checkout(payer, build(['boat-hire'], [returning]));
  assert.equal(started.status, 200, started.text);
  const orderRef = started.json.orderRef;
  await db.collection('orders').doc(orderRef).update({ photoConsentAsked: FieldValue.delete() });
  assert.equal((await pay(orderRef)).status, 200);

  const after = (await db.collection('memberships').doc(member.id).get()).data().consents;
  assert.deepEqual(after.photoVideo, before.photoVideo, 'the earlier checkout did not ask this existing member');
  assert.deepEqual(after.photoVideoHistory, before.photoVideoHistory);
});

await test('renewal emails: one per contact address, a basket link, sent on 1 February and a 15 February reminder', async () => {
  const renewer = email('renewer');
  const child = { firstName: 'Rio', lastName: 'Renew', dob: yearsAgo(10), swimming: 'basic', junior: true, disclaimerAccepted: true, photoConsent: false, medical: '' };
  const household = build(['membership-family', 'keyhire'], [adultDetails({ email: renewer, firstName: 'Ren', lastName: 'Renew' }), child]);
  await buy(renewer, { ...household, people: household.people.filter((person) => person.firstName) }, {}, autumn);
  const records = await membershipsFor(renewer);
  assert.equal(records.length, 2);
  const ids = records.map((record) => record.id).sort();
  const adminAt = (when) => ({ ...admin, ...when });

  assert.equal((await call('POST', '/api/admin/renewals/send', { body: {}, headers: adminAt(autumn) })).json.code, 'renewals_closed', 'not before 1 January');
  const summary = await call('GET', '/api/admin/renewals', { headers: adminAt(january) });
  assert.equal(summary.status, 200, summary.text);
  assert.equal(summary.json.renewalYear, autumnYear + 1);
  assert.ok(summary.json.members >= 2 && summary.json.open);

  const sent = await call('POST', '/api/admin/renewals/send', { body: { membershipId: ids[0] }, headers: adminAt(january) });
  assert.equal(sent.status, 200, sent.text);
  assert.deepEqual([sent.json.emails, sent.json.members], [1, 2], 'one email for the household');
  const mails = async () => (await db.collection('testMail').where('kind', '==', 'renewal').where('email', '==', renewer).get()).docs.map((document) => document.data());
  const [mail] = await mails();
  assert.deepEqual([...mail.membershipIds].sort(), ids);
  assert.match(mail.subject, new RegExp(`${autumnYear + 1}/`));
  assert.match(mail.body, /MEMBERSHIP — FAMILY \((Ren, Rio|Rio, Ren)\)/);
  assert.match(mail.body, /Boathouse Access \(Ren\)/);
  const token = /renew=([a-f0-9]{64})/.exec(mail.body)[1];
  assert.ok(mail.body.includes(`https://fccwebsite-23cfc.web.app/membership?renew=${token}`));

  const link = await call('GET', `/api/renewals/${token}`, { headers: january });
  assert.equal(link.status, 200, link.text);
  assert.equal(link.json.email, renewer);
  assert.equal(link.json.billingMode, 'annual');
  assert.deepEqual(link.json.items.map((item) => [item.id, item.clubYearChoice]), [['membership-family', 'next'], ['keyhire', 'next']]);
  assert.deepEqual(link.json.people.map((person) => [person.firstName, person.returning, person.junior, person.lineIds.length]).sort(), [['Ren', true, false, 2], ['Rio', true, true, 1]]);
  assert.deepEqual(link.json.people.map((person) => [person.firstName, person.prefill.disclaimer, person.prefill.photoConsent]).sort(), [['Ren', true, true], ['Rio', true, false]],
    'each person is offered their own answers, including a no to photos');
  assert.equal((await call('GET', `/api/renewals/${token}`, { headers: testNow(londonNoon(autumnYear + 1, 3, 2)) })).json.code, 'renewal_expired', 'expires after 31 March');
  assert.equal((await call('GET', `/api/renewals/${'0'.repeat(64)}`)).status, 404);

  // The prefilled basket checks out as these returning members.
  const lines = link.json.items.map((item) => ({ ...PRODUCTS.find((product) => product.id === item.id), ...item }));
  const renewal = await checkout(renewer, { lines, people: link.json.people.map((person) => applyConsentPrefill(person, person.prefill)) }, {}, january);
  assert.equal(renewal.status, 200, renewal.text);
  const order = await orderData(renewal.json.orderRef);
  assert.deepEqual(order.people.map((person) => person.membershipId).sort(), ids, 'matched to the existing records');

  const job = (when, secret = process.env.RENEWAL_JOB_TOKEN) => call('POST', '/api/jobs/renewals', { body: {}, headers: { Authorization: `Bearer ${secret}`, ...when } });
  assert.equal((await job(january, 'x'.repeat(40))).status, 401);
  assert.equal((await job(january)).json.waiting, true, 'the job waits for 1 February');
  const daily = await job(earlyFebruary);
  assert.equal(daily.status, 200, daily.text);
  assert.equal((await mails()).length, 1, 'already emailed, so the job skips them');
  assert.equal(daily.json.failures, 0);
  assert.equal((await job(earlyFebruary)).json.emails, 0, 'nobody is emailed twice');
  // The January renewal was never paid, so the 15 February reminder still goes, once.
  const lateFebruary = testNow(londonNoon(autumnYear + 1, 1, 20));
  const reminder = await job(lateFebruary);
  assert.equal(reminder.json.round, 'reminder', reminder.text);
  assert.equal((await mails()).length, 2, 'the reminder is the second email');
  assert.match((await mails()).find((mail) => mail.subject.startsWith('Reminder')).subject, /^Reminder: renew/);
  assert.equal((await job(lateFebruary)).json.emails, 0, 'the reminder is sent once');
  // Once they hold next year's membership nobody on the household is emailed again.
  await Promise.all(ids.map((id) => db.collection('memberships').doc(id).update({ clubYears: FieldValue.arrayUnion(autumnYear + 1), renewalReminderSentFor: [] })));
  assert.equal((await job(lateFebruary)).json.emails, 0, 'renewed members are skipped');
  assert.equal((await mails()).length, 2);
});

await db.collection('products').doc(lessonId).delete();

await test('checkout needs agreement to the current version of every published notice', async () => {
  const noticeId = `test-notice-${run}`;
  const publish = (body) => call('PUT', `/api/admin/notices/${noticeId}`, { body: { title: 'Test notice', body }, headers: admin });
  const first = await publish('Version one wording.');
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.version, 1);
  try {
    const address = email('notices');
    const basket = () => build(['membership-adult'], [adultDetails({ email: address, firstName: 'Nora', lastName: 'Notices' })]);
    const others = Object.fromEntries(Object.entries(await currentNoticeVersions()).filter(([id]) => id !== noticeId));
    const missing = await checkout(address, basket(), { noticeVersions: others });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.code, Object.keys(others).length ? 'notices_changed' : 'notices_required');
    assert.equal((await publish('Version two wording.')).json.version, 2);
    const stale = await checkout(address, basket(), { noticeVersions: { ...others, [noticeId]: 1 } });
    assert.equal(stale.status, 400);
    assert.equal(stale.json.code, 'notices_changed');
    const orderRef = await buy(address, basket(), { noticeVersions: { ...others, [noticeId]: 2 } });
    const order = (await db.collection('orders').doc(orderRef).get()).data();
    assert.ok(order.noticeAgreement.versions.some((entry) => entry.noticeId === noticeId && entry.version === 2), 'the order records the agreed version');
    const [member] = await membershipsFor(address);
    assert.equal(member.consents.notices.orderRef, orderRef);
    assert.ok(member.consents.notices.versions.some((entry) => entry.noticeId === noticeId && entry.version === 2), 'the member record keeps the agreed version');
    const offered = async () => (await call('POST', '/api/membership-names', { body: { email: address, dob: member.dob } })).json.names[0].prefill.notices;
    assert.deepEqual(await offered(), { ...others, [noticeId]: 2 }, 'the agreement is offered while every notice is unchanged');
    assert.equal((await publish('Version three wording.')).json.version, 3);
    assert.equal(await offered(), null, 'one changed notice means agreeing again');
    const pdf = await call('GET', `/api/notices/${noticeId}/pdf?version=1`);
    assert.equal(pdf.status, 200);
    assert.ok(pdf.text.startsWith('%PDF-'), 'superseded versions stay downloadable');
  } finally {
    await call('DELETE', `/api/admin/notices/${noticeId}`, { headers: admin });
  }
});

// Staff credits: items paid for outside the website, or given free, go through checkout's checks with no Stripe payment.
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const creditPayment = (over = {}) => ({ method: 'bank-transfer', amountPence: 4500, receivedAt: yesterday, reference: `FCC ${run}`, note: '', ...over });
const credit = async (emailAddress, { lines, people }, payment = creditPayment(), headers = admin) => call('POST', '/api/admin/credits', { headers, body: {
  email: emailAddress, items: lines.map(({ id, lineId, size, clubYearChoice }) => ({ id, lineId, ...(size ? { size } : {}), ...(clubYearChoice ? { clubYearChoice } : {}) })), people,
  noticeVersions: await currentNoticeVersions(), wording: checkoutWording(), payment } });

await test('an admin credits items paid by bank transfer to an existing member, with a receipt and an audit entry', async () => {
  const member = await newMember('credit-member');
  const basket = build(['boat-hire'], [member.person]);
  const result = await credit(member.email, basket);
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.credited, true);
  assert.equal(result.json.receiptEmailed, true);
  const orderRef = result.json.orderRef;
  shared.creditOrder = orderRef;
  const order = (await db.collection('orders').doc(orderRef).get()).data();
  assert.equal(order.status, 'paid');
  assert.equal(order.paymentMethod, 'credit');
  assert.match(order.stripe.sessionId, /^credit_/);
  assert.equal(order.stripe.paymentIntentId, '');
  assert.equal(order.payment.method, 'bank-transfer');
  assert.equal(order.payment.amountPence, 4500);
  assert.equal(order.payment.reference, `FCC ${run}`);
  assert.equal(order.payment.receivedAt.toDate().toISOString().slice(0, 10), yesterday);
  assert.equal(order.payment.creditedBy, 'admin@forthcanoeclub.co.uk');
  if (order.noticeAgreement) assert.equal(order.noticeAgreement.recordedBy, 'admin@forthcanoeclub.co.uk', 'the admin is recorded as ticking the notices for the customer');
  const [record] = await membershipsFor(member.email);
  assert.ok(record.entitlements.some((privilege) => privilege.productId === 'boat-hire'), 'the credited item is held like a bought one');
  const mail = (await db.collection('testMail').where('orderRef', '==', orderRef).get()).docs.map((document) => document.data());
  assert.equal(mail.length, 1);
  assert.match(mail[0].body, /Total paid: £45\.00\nPaid by bank transfer/);
  assert.match(mail[0].html, /Paid by bank transfer/);
  const audit = (await db.collection('auditLog').where('orderRef', '==', orderRef).get()).docs.map((document) => document.data());
  assert.equal(audit.length, 1);
  assert.equal(audit[0].kind, 'item');
  assert.equal(audit[0].action, 'credit-items');
  assert.equal(audit[0].by, 'admin@forthcanoeclub.co.uk');
  assert.equal(audit[0].method, 'bank-transfer');
  assert.equal(audit[0].amountPence, 4500);
  assert.deepEqual(audit[0].membershipIds, [record.id]);
  const again = await credit(member.email, build(['boat-hire'], [member.person]));
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'already_held', 'a credit cannot give an item the member already holds');
});

await test('a credit follows checkout rules and needs an admin and a valid payment record', async () => {
  const stranger = email('credit-stranger');
  const basket = build(['boat-hire'], [adultDetails({ email: stranger })]);
  assert.equal((await credit(stranger, basket, creditPayment(), {})).status, 401);
  const refused = await credit(stranger, basket);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, 'membership_required', 'a non-member cannot be credited members-only items without a membership');
  for (const payment of [creditPayment({ reference: '' }), creditPayment({ method: 'complimentary', note: 'Gift' }), creditPayment({ amountPence: 0 }),
    creditPayment({ method: 'card' }), creditPayment({ receivedAt: '2999-01-01' })]) {
    assert.equal((await credit(stranger, basket, payment)).status, 400, JSON.stringify(payment));
  }
  assert.equal((await db.collection('orders').where('email', '==', stranger).get()).size, 0, 'refused credits leave no order');

  const member = await newMember('credit-capacity');
  const eventId = `E2E-CREDIT-CAP-${run}`;
  const schedule = { mode: 'single', startDate: '2099-06-01', startTime: '10:00', endTime: '12:00', timeZone: 'Europe/London' };
  await db.collection('products').doc(eventId).set({ name: 'Credit capacity course', category: 'EVENTS', type: 'event-ticket', basePrice: 20, eventSchedule: schedule, capacity: 1 });
  const ticket = (n) => {
    const line = { id: eventId, lineId: `${eventId}-${n}`, name: 'Credit capacity course', category: 'EVENTS', type: 'event-ticket', basePrice: 20 };
    return { lines: [line], people: assignLines([], [line], makeId).map((person) => ({ ...person, ...member.person })) };
  };
  const cash = creditPayment({ method: 'cash', amountPence: 2000, reference: '' });
  const first = await credit(member.email, ticket(1), cash);
  assert.equal(first.status, 200, first.text);
  const full = await credit(member.email, ticket(2), cash);
  assert.equal(full.status, 409);
  assert.equal(full.json.code, 'sold_out', 'a credit cannot oversell an event');
});

await test('a non-member is credited a membership with their items, recording the same details and consents as checkout', async () => {
  const joiner = email('credit-joiner');
  const details = adultDetails({ email: joiner, firstName: 'Credit', lastName: 'Joiner' });
  const result = await credit(joiner, build(['membership-adult', 'keyhire'], [details]), creditPayment({ method: 'complimentary', amountPence: 0, reference: '', note: 'Committee thank you' }));
  assert.equal(result.status, 200, result.text);
  const [member] = await membershipsFor(joiner);
  assert.ok(member, 'the membership is created');
  assert.equal(member.firstName, 'Credit');
  assert.equal(member.consents.disclaimer.policyKey, 'participation-disclaimer');
  if (Object.keys(await currentNoticeVersions()).length) assert.equal(member.consents.notices.orderRef, result.json.orderRef);
  assert.equal(member.consents.photoVideo.accepted, true);
  assert.equal(member.medical, 'Asthma');
  assert.ok(member.entitlements.some((privilege) => privilege.productId === 'keyhire'));
  const mail = (await db.collection('testMail').where('orderRef', '==', result.json.orderRef).get()).docs[0].data();
  assert.match(mail.body, /Total paid: £0\.00\nComplimentary \(no charge\)/);
});

await test('credited orders are reported apart from Stripe takings and cannot be refunded through Stripe', async () => {
  const [creditRecord] = (await reportFor('orders', shared.creditOrder)).json.records;
  assert.equal(creditRecord.credited, true);
  assert.equal(creditRecord.paidVia, 'Bank transfer');
  assert.equal(creditRecord.amountReceived, 45);
  assert.equal(creditRecord.paymentReference, `FCC ${run}`);
  assert.equal(creditRecord.creditedBy, 'admin@forthcanoeclub.co.uk');
  const [stripeRecord] = (await reportFor('orders', shared.adultOrder)).json.records;
  assert.equal(stripeRecord.paidVia, 'Stripe');
  assert.equal('credited' in stripeRecord, false);
  assert.deepEqual(takingsSummary([creditRecord, stripeRecord]), { stripe: stripeRecord.total, stripeOrders: 1, credited: 45, creditedOrders: 1 });

  const order = (await db.collection('orders').doc(shared.creditOrder).get()).data();
  const lineId = order.items[0].lineId;
  const base = `/api/admin/orders/${shared.creditOrder}/items/${encodeURIComponent(lineId)}`;
  const payments = await call('GET', `${base}/payments?action=refund`, { headers: admin });
  assert.equal(payments.status, 409);
  assert.match(payments.json.error, /credited by staff.*cannot be refunded here/);
  const refund = await call('POST', `${base}/actions`, { headers: admin, body: { action: 'refund', reason: 'Asked for a refund', operationId: '00000000-0000-4000-8000-000000000085',
    paymentIntent: 'pi_credit', amount: 100, revoke: false } });
  assert.equal(refund.status, 409);
  assert.match(refund.json.error, /credited by staff/);
  assert.equal((await call('GET', `${base}/payments?action=revoke`, { headers: admin })).status, 200, 'credited items can still be revoked');
});

await test('every paid order produced a receipt email record', async () => {
  const orders = (await db.collection('orders').where('status', '==', 'paid').get()).docs.filter((document) => document.id !== 'TEST-MEMBERSHIP');
  const created = orders.filter((document) => document.data().stripe?.sessionId?.startsWith('cs_e2e_') && document.data().email.endsWith(`.${run}@example.test`));
  assert.ok(created.length >= 8);
  for (const order of created) {
    assert.equal(order.data().fulfilment.emailSent, true, `${order.id} email sent`);
    assert.equal(order.data().schemaVersion, 2, `${order.id} is written in the current order shape`);
    assert.equal((await db.collection('testMail').where('orderRef', '==', order.id).get()).size, 1, `${order.id} has one email`);
  }
});

await test('replaying a webhook does not duplicate records or emails', async () => {
  const before = (await membershipsFor(shared.family)).map((record) => record.purchases.length);
  const replay = await pay(shared.familyOrder);
  assert.equal(replay.status, 200);
  assert.deepEqual((await membershipsFor(shared.family)).map((record) => record.purchases.length), before);
  assert.equal((await db.collection('testMail').where('orderRef', '==', shared.familyOrder).get()).size, 1);
});

await test('admins can make a membership lifetime, which needs no renewal, and undo it exactly', async () => {
  const member = await newMember('lifetime');
  const [record] = await membershipsFor(member.email);
  const path = `/api/admin/memberships/${record.id}/lifetime`;
  const body = { action: 'grant', reason: 'Committee decision', confirmation: record.id };
  assert.equal((await call('POST', path, { body })).status, 401);
  assert.equal((await call('POST', path, { headers: admin, body: { ...body, confirmation: 'wrong' } })).status, 400);
  assert.equal((await call('POST', path, { headers: admin, body: { ...body, reason: ' ' } })).status, 400);
  assert.equal((await call('POST', path, { headers: admin, body })).status, 200);
  assert.equal((await call('POST', path, { headers: admin, body })).status, 409, 'granting twice is refused');
  const lifetime = (await db.collection('memberships').doc(record.id).get()).data();
  assert.equal(lifetime.validUntil, undefined);
  assert.equal(lifetime.lifetimeMembership.previousValidUntil.toMillis(), record.validUntil.toMillis());
  const report = (await reportFor('members', record.id)).json.records.find((entry) => entry.id === record.id);
  assert.equal(report.status, 'Active (lifetime)');
  assert.equal(report.lifetime.reason, 'Committee decision');
  const blocked = await checkout(member.email, build(['membership-adult'], [member.person]));
  assert.equal(blocked.status, 409, blocked.text);
  assert.match(blocked.json.error, /lifetime membership/);
  assert.equal((await db.collection('auditLog').where('membershipId', '==', record.id).where('action', '==', 'lifetime-membership-grant').get()).size, 1);
  assert.equal((await call('POST', path, { headers: admin, body: { ...body, action: 'remove', reason: 'Granted by mistake' } })).status, 200);
  const restored = (await db.collection('memberships').doc(record.id).get()).data();
  assert.equal(restored.lifetimeMembership, undefined);
  assert.equal(restored.validUntil.toMillis(), record.validUntil.toMillis());
  assert.equal(restored.status, 'active');
});

await test('admins publish the weekly timetable and the public sees only active sessions', async () => {
  const path = '/api/admin/timetable';
  assert.equal((await call('GET', path)).status, 401);
  assert.equal((await call('PUT', path, { body: { sessions: [] } })).status, 401);
  assert.equal((await call('PUT', path, { headers: admin, body: { sessions: [{ name: 'Bad', weekday: 1, start: '19:00', end: '18:00' }] } })).status, 400);
  try {
    const saved = await call('PUT', path, { headers: admin, body: { sessions: [
      { name: 'Polo training', discipline: 'Canoe polo', weekday: 1, start: '18:00', end: '20:00', location: 'Harrison Park' },
      { name: 'Open night', weekday: 4, start: '18:30', seasonStart: 4, seasonEnd: 10 },
      { name: 'Paused', weekday: 4, start: '10:00', active: false }
    ] } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.sessions.length, 3);
    const published = await call('GET', '/api/timetable');
    assert.equal(published.status, 200);
    assert.deepEqual(published.json.days.map((day) => [day.day, day.sessions.map((entry) => entry.name)]), [['Monday', ['Polo training']], ['Thursday', ['Open night']]]);
    assert.equal(published.json.days[1].sessions[0].seasonStart, 4);
  } finally {
    await db.collection('settings').doc('timetable').delete();
  }
  const fallback = (await call('GET', '/api/timetable')).json.days;
  assert.deepEqual(fallback.map((day) => day.day), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Sunday'], 'until saved, the starting timetable is shown');
  const unsaved = await call('GET', path, { headers: admin });
  assert.equal(unsaved.json.updatedAt, 0);
  assert.equal(unsaved.json.sessions.length, 6);
});

await test('new and renewing members get the admin-written welcome email once per term', async () => {
  const path = '/api/admin/welcome-email';
  const welcomeMail = async (membershipId) => (await db.collection('testMail').where('membershipId', '==', membershipId).get()).docs
    .map((document) => document.data()).filter((mail) => mail.kind === 'welcome-email');
  const paragraph = (content) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  assert.equal((await call('GET', path)).status, 401);
  assert.equal((await call('POST', path, { headers: admin, body: { enabled: true, subject: 'Hi', doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x.test/a.png' } }] } } })).status, 400);
  const saved = await call('POST', path, { headers: admin, body: { enabled: true, subject: 'Welcome {{firstName}}',
    doc: paragraph([{ type: 'text', text: 'Hello {{firstName}} <script>', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'javascript:alert(1)' } }] }]) } });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.doc.content[0].content[0].marks, [{ type: 'bold' }], 'unsafe links are dropped when saved');
  const draft = await call('POST', `${path}/test`, { headers: admin, body: { subject: 'Draft {{firstName}}', doc: paragraph([{ type: 'text', text: 'Draft' }]) } });
  assert.equal(draft.status, 200, draft.text);
  assert.equal(draft.json.sentTo, 'admin@forthcanoeclub.co.uk');
  try {
    const address = email('welcome');
    await buy(address, build(['membership-adult'], [adultDetails({ email: address, firstName: 'Wendy' })]));
    const [member] = await membershipsFor(address);
    const [mail] = await welcomeMail(member.id);
    assert.equal(mail.subject, 'Welcome Wendy');
    assert.equal(mail.email, address);
    assert.match(mail.html, /<strong>Hello Wendy &lt;script&gt;<\/strong>/);
    assert.doesNotMatch(mail.html, /<script|javascript:/);
    assert.equal(member.welcomeEmailDue, false);
    assert.equal(member.welcomeEmail.sentFor, member.validUntil.toMillis());

    // The JustGo sync flags the same term again (for example on a repeat run): nothing more is sent.
    const job = (secret = process.env.RENEWAL_JOB_TOKEN) => call('POST', '/api/jobs/welcome-emails', { body: {}, headers: { Authorization: `Bearer ${secret}` } });
    assert.equal((await job('wrong-token-wrong-token-wrong-token-00')).status, 401);
    await db.collection('memberships').doc(member.id).update({ welcomeEmailDue: true });
    assert.equal((await job()).status, 200);
    assert.equal((await welcomeMail(member.id)).length, 1, 'one welcome per term');
    assert.equal((await db.collection('memberships').doc(member.id).get()).data().welcomeEmailDue, false);

    // Someone who joins through JustGo is flagged by the sync and welcomed by the job, at the household (guardian) email.
    const guardianEmail = email('welcome-guardian');
    const household = await db.collection('households').add({ contactName: 'Guardian Person', email: guardianEmail });
    const joiner = await db.collection('memberships').add({ firstName: 'Jess', lastName: 'Joiner', householdId: household.id, status: 'active',
      membershipTier: 'junior', validUntil: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000), source: 'justgo', welcomeEmailDue: true });
    assert.equal((await job()).status, 200);
    const [joined] = await welcomeMail(joiner.id);
    assert.equal(joined.email, guardianEmail);
    assert.equal(joined.subject, 'Welcome Jess');

    // Switched off: due members are cleared rather than emailed later when it is switched back on.
    assert.equal((await call('POST', path, { headers: admin, body: { ...saved.json, enabled: false } })).status, 200);
    const later = await db.collection('memberships').add({ firstName: 'Late', lastName: 'Joiner', householdId: household.id, status: 'active',
      validUntil: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000), welcomeEmailDue: true });
    assert.equal((await job()).status, 200);
    assert.equal((await welcomeMail(later.id)).length, 0);
    assert.equal((await later.get()).data().welcomeEmailDue, false);
  } finally {
    await db.collection('settings').doc('welcomeEmail').delete();
  }
});

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const entry of failed) console.log(`\n${entry.name}\n${entry.error.stack}`); process.exit(1); }
process.exit(0);
