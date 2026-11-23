import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { emailBlockId } from './emailSuppression.js';
import { applyReplacementCredit, replacementCredit } from './replacementCredit.js';
import { claimReplacement, completeReplacement, replacementItems, replacementTokenHash, stopReplacedSubscription } from './subscriptionReplacement.js';

function fixture() {
  const email = 'subscriber@example.test';
  const invite = { sourceAccount: 'acct_source', destinationAccount: 'acct_dest', sourceId: 'sub_old',
    orderRef: 'order', emailHash: emailBlockId(email), productIds: ['product'], sourcePriceIds: ['price_old'] };
  const order = { email, status: 'paid', stripe: { mode: 'test' },
    items: [{ id: 'product', monthly: true, debits: 2, lineId: 'line', stripeSubscriptionItemId: 'si_new' }],
    subscriptionPlan: { status: 'active', groups: [{ lineIds: ['line'], recorded: true, created: true, stripeSubscriptionId: 'sub_new' }] } };
  const calls = [];
  const source = async (path, method, params) => {
    calls.push({ path, method, params });
    if (path === 'account') return { id: 'acct_source' };
    if (path.startsWith('invoices?')) return { data: [] };
    if (method === 'DELETE') return { id: 'sub_old', status: 'canceled' };
    return { id: 'sub_old', livemode: false, status: 'active', customer: { email }, items: { data: [{ price: { id: 'price_old' } }] } };
  };
  const destination = async path => path === 'account' ? { id: 'acct_dest' } : {
    livemode: false, status: 'active', items: { data: [{ id: 'si_new', metadata: { line_id: 'line', order_ref: 'order' } }] }
  };
  return { params: { order, orderRef: 'order', invite, source, destination }, calls };
}

test('only a verified new subscription cancels the matching old one immediately without invoicing', async () => {
  const { params, calls } = fixture();
  await stopReplacedSubscription(params);
  assert.deepEqual(calls.filter(call => call.method === 'DELETE'), [
    { path: 'subscriptions/sub_old', method: 'DELETE', params: { invoice_now: 'false', prorate: 'false' } }
  ]);
});

test('unpaid, unrelated, inactive, or misattributed checkouts cannot cancel Source', async () => {
  const cases = [
    params => { params.order.status = 'pending'; },
    params => { params.order.items[0].id = 'unrelated'; },
    params => { params.order.subscriptionPlan.status = 'failed'; },
    params => {
      const destination = params.destination;
      params.destination = async path => path === 'account' ? destination(path) : {
        livemode: false, status: 'active', items: { data: [{ id: 'si_new', metadata: { line_id: 'line', order_ref: 'another-order' } }] }
      };
    }
  ];
  for (const change of cases) {
    const { params, calls } = fixture();
    change(params);
    await assert.rejects(stopReplacedSubscription(params));
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  }
});

test('dry-run emails have official HTML and text, and local preview links never store live billing identifiers', () => {
  const script = fileURLToPath(new URL('../../scripts/invite-subscription-replacements.mjs', import.meta.url));
  const fakeProvider = `
    import assert from 'node:assert/strict';
    import { google } from ${JSON.stringify(import.meta.resolve('googleapis'))};
    import { DocumentReference } from ${JSON.stringify(import.meta.resolve('firebase-admin/firestore'))};
    import { createHash } from 'node:crypto';
    let requests = 0;
    let invitation;
    let reads = 0;
    DocumentReference.prototype.create = async function(value) {
      assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
      assert.equal(this.firestore.projectId, 'demo-fcc');
      assert.equal(value.previewOnly, true);
      assert.equal(value.sourceId, 'sub_preview');
      assert.doesNotMatch(JSON.stringify(value), /sub_real|cus_real|private-customer/);
      invitation = value;
    };
    globalThis.fetch = async (url, request) => {
      assert.equal(process.env.LOCAL_PREVIEW, 'yes');
      if (url === 'http://localhost:3000') return new Response('Local website');
      assert.equal(request.method, 'GET');
      const path = url.replace('https://api.stripe.com/v1/', '');
      let value;
      if (path === 'account') {
        value = { id: request.headers.Authorization === 'Bearer sk_test_dest' ? 'acct_destination' : 'acct_source' };
      } else if (path === 'subscriptions?status=active&limit=1') {
        value = {data:[{id:'sub_real',customer:'cus_real',livemode:true,items:{data:[{price:{product:'prod_old'}}]}}]};
      } else if (path === 'products/prod_old') value = {name:'Boat <storage>'};
      else throw new Error('Unexpected Stripe read: ' + path);
      reads++;
      return new Response(JSON.stringify(value));
    };
    google.gmail = ({ version, auth }) => {
      assert.equal(version, 'v1');
      assert.deepEqual(auth.scopes, ['https://www.googleapis.com/auth/gmail.send']);
      return { users: { messages: { send: async (request, options) => {
      requests++;
      assert.equal(request.userId, 'me');
      assert.equal(options.retry, false);
      const mail = Buffer.from(request.requestBody.raw, 'base64url').toString();
      assert.match(mail, /To: pilot@example.test/);
      assert.match(mail, /From: .*club@example.test/);
      assert.match(mail, /Subject: \\[TEST ONLY\\]/);
      assert.match(mail, /Content-Type: multipart\\/alternative/);
      const parts = [...mail.matchAll(/Content-Type: text\\/(plain|html); charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+)/g)];
      assert.equal(parts.length, 2);
      const body = Buffer.from(parts[0][2].replace(/\\s/g, ''), 'base64').toString();
      const html = Buffer.from(parts[1][2].replace(/\\s/g, ''), 'base64').toString();
      assert.match(body, /Dear subscriber/);
      assert.match(html, /<h1[^>]*>Update your Forth Canoe Club subscription/);
      assert.doesNotMatch(body + html, /fictional|£120|300 days|Neither annual rule/);
      if (process.env.LOCAL_PREVIEW === 'yes') {
        const token = new URL(body.match(/http:\\/\\/localhost:3000\\/membership#replace=[a-f0-9.]+/)[0]).hash.slice('#replace='.length);
        assert.equal(createHash('sha256').update(token).digest('hex'), invitation.tokenHash);
        assert.equal(invitation.emailHash, createHash('sha256').update('pilot@example.test').digest('hex'));
        assert.match(html, /Boat &lt;storage&gt;/);
        assert.match(html, /href="http:\\/\\/localhost:3000\\/membership#replace=/);
      }
      if (process.env.MAIL_FAILURE === 'yes') throw new Error('Private provider error');
      if (process.env.MAIL_FAILURE === 'missing-id') return {data:{}};
      return {data:{id:'test-provider-receipt'}};
      } } } };
    };
    process.on('exit', () => {
      assert.equal(requests, 1);
      assert.equal(reads, process.env.LOCAL_PREVIEW === 'yes' ? 4 : 0);
    });
  `;
  for (const failure of ['no', 'yes', 'missing-id', 'local-preview']) {
    const local = failure === 'local-preview';
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(fakeProvider)}`, script, '--dry-run', ...(local ? ['--local-link'] : [])],
      { env: {
        GOOGLE_WORKSPACE_DELEGATED_USER: 'website@example.test', GOOGLE_WORKSPACE_SENDER: 'club@example.test',
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'fixture@example.test', private_key: 'fixture' }),
        STRIPE_REPLACEMENT_TEST_INBOX: 'pilot@example.test', MAIL_FAILURE: failure,
        ...(local ? { LOCAL_PREVIEW: 'yes', STRIPE_SECRET_KEY: 'sk_test_dest', STRIPE_REPLACEMENT_PREVIEW_SOURCE_KEY: 'rk_live_readonly' } : {})
      }, encoding: 'utf8' });
    assert.equal(result.status, failure === 'no' || local ? 0 : 1, result.stderr);
    if (local) assert.deepEqual(JSON.parse(result.stdout), {
      dryRun: true, previewSent: true, checked: 1, localLink: true, liveCancellationEnabled: false
    });
    else if (failure === 'no') assert.deepEqual(JSON.parse(result.stdout), { dryRun: true, previewSent: true, checked: 0 });
    else {
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Sent folder before retrying/);
      assert.doesNotMatch(result.stderr, /Private provider error/);
    }
  }
});

test('local preview can claim and verify a sandbox order but can never cancel the live Source', async t => {
  const { params, calls } = fixture();
  const env = { LOCAL_FIREBASE_EMULATORS: 'true', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-fcc' };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const token = `${'a'.repeat(64)}.${'b'.repeat(64)}`;
  params.invite = { ...params.invite, previewOnly: true, productIds: [], sourceId: 'sub_preview',
    expiresAt: { toMillis: () => Date.now() + 60000 }, tokenHash: replacementTokenHash(token) };
  params.order = { ...params.order, replacementInvite: 'a'.repeat(64) };
  const updates = [];
  const reference = collection => ({
    get: async () => ({ data: () => collection === 'orders' ? params.order : params.invite })
  });
  const db = {
    collection: collection => ({ doc: () => reference(collection) }),
    getAll: async (...refs) => refs.map(() => ({ exists: false, data: () => undefined })),
    runTransaction: async action => action({ get: ref => ref.get(), update: () => {} }),
    batch: () => ({ update: (ref, fields) => updates.push(fields), commit: async () => {} })
  };
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Preview must not call Source'); });
  await claimReplacement(db, {
    token, email: params.order.email, orderRef: 'order', items: params.order.items,
    subscriptionPlan: params.order.subscriptionPlan, destination: params.destination
  });
  await completeReplacement(db, 'order', {
    destination: params.destination,
    attention: { settle: async () => {}, raise: () => assert.fail('Unexpected cancellation warning') }
  });
  assert.deepEqual(updates, [{ previewComplete: true }, { replacementStatus: 'preview-complete' }]);
  await assert.rejects(stopReplacedSubscription(params), /must never cancel/);
  assert.equal(calls.length, 0);
  process.env.LOCAL_FIREBASE_EMULATORS = 'false';
  await assert.rejects(claimReplacement(db, { token, email: params.order.email }), /unavailable/);
});

test('local link refuses live checkout keys and remote database or website targets before sending', () => {
  const script = fileURLToPath(new URL('../../scripts/invite-subscription-replacements.mjs', import.meta.url));
  for (const settings of [
    { STRIPE_REPLACEMENT_TEST_URL: 'https://club.example.test' },
    { FIRESTORE_EMULATOR_HOST: 'remote.example.test:8080' },
    { STRIPE_REPLACEMENT_TEST_PROJECT: 'real-project' }
  ]) {
    const result = spawnSync(process.execPath, [script, '--dry-run', '--local-link'], {
      env: { STRIPE_REPLACEMENT_PREVIEW_SOURCE_KEY: 'rk_live_fixture',
        STRIPE_REPLACEMENT_TEST_INBOX: 'pilot@example.test', ...settings }, encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /loopback/);
  }
});

const paidInvoice = (subscription, price, start, end, amount) => ({
  status: 'paid', currency: 'gbp', subscription: subscription.id, amount_paid: amount, amount_due: amount,
  charge: { paid: true, currency: 'gbp', amount, amount_refunded: 0, disputed: false },
  lines: { data: [{ type: 'subscription', proration: false, period: { start, end }, price }] }
});
const day = 86400;

test('yearly credit is the unused share in 20% steps, rounded down; over 300 days left is card only until the next 1 March', () => {
  const price = { id: 'price_annual', recurring: { interval: 'year', interval_count: 1 } };
  const subscription = { id: 'sub_annual', items: { data: [{ price }] } };
  const start = Date.parse('2027-01-01T00:00:00Z') / 1000;
  const end = start + 365 * day;
  const invoice = paidInvoice(subscription, price, start, end, 12000);
  assert.deepEqual([90, 146, 219, 300].map((left) => replacementCredit(subscription, invoice, end - left * day).creditPence), [2400, 4800, 7200, 9600],
    '90 days left is 24.7%, so one fifth; 146 days is exactly two fifths');
  assert.equal(replacementCredit(subscription, invoice, end - 300 * day).cardOnly, false);
  assert.deepEqual(replacementCredit(subscription, invoice, end - 301 * day), {
    interval: 'year', creditPence: 0, unusedDays: 301, paidPence: 12000, cardOnly: true, firstChargeAt: '2028-03-01T00:00:00.000Z'
  });
  assert.equal(replacementCredit(subscription, { ...invoice, charge: { ...invoice.charge, amount_refunded: 1 } }, start), null);
});

test('monthly credit is the whole unused days of the last payment', () => {
  const price = { id: 'price_monthly', recurring: { interval: 'month', interval_count: 1 } };
  const subscription = { id: 'sub_monthly', items: { data: [{ price }] } };
  const start = Date.parse('2026-11-17T00:00:00Z') / 1000;
  const end = start + 30 * day;
  const plan = replacementCredit(subscription, paidInvoice(subscription, price, start, end, 2500), end - 27.5 * day);
  assert.deepEqual([plan.interval, plan.unusedDays, plan.creditPence, plan.cardOnly], ['month', 27, 2250, false]);
  assert.equal(replacementCredit(subscription, paidInvoice(subscription, price, start, end, 2500), start - day), null, 'a payment for a future period is not checked');
});

test('credit comes off the replaced lines\' first payments, and what is left is carried forward', () => {
  const items = [{ id: 'membership', pricePence: 3000 }, { id: 'blue', monthly: true, pricePence: 1000 }, { id: 'gold', monthly: true, pricePence: 1500 }];
  const some = applyReplacementCredit(items, ['blue', 'gold'], { creditPence: 2000 });
  assert.deepEqual([some.items.map((item) => item.pricePence), some.appliedPence, some.carryForwardPence], [[3000, 0, 500], 2000, 0]);
  const more = applyReplacementCredit(items, ['blue', 'gold'], { creditPence: 4000 });
  assert.deepEqual([more.items.map((item) => item.pricePence), more.appliedPence, more.carryForwardPence], [[3000, 0, 0], 2500, 1500]);
  const yearly = [{ id: 'gold', yearly: true, pricePence: 11520, firstDebitAt: 'next March' }];
  const cardOnly = applyReplacementCredit(yearly, ['gold'], { cardOnly: true, firstChargeAt: '2028-03-01T00:00:00.000Z' }, { timestamp: (iso) => `at ${iso}` });
  assert.deepEqual([cardOnly.items[0].pricePence, cardOnly.items[0].firstDebitAt, cardOnly.appliedPence, cardOnly.carryForwardPence],
    [0, 'at 2028-03-01T00:00:00.000Z', 11520, 0], 'nothing now; the first yearly payment moves to the 1 March after the old year');
  assert.equal(applyReplacementCredit(items, ['blue'], null).items, items);
});

test('a yearly invitation needs the replacement paid yearly, and a monthly one monthly', () => {
  const order = (line) => ({ items: [{ id: 'gold', lineId: 'l1', ...line }], subscriptionPlan: { groups: [{ lineIds: ['l1'] }] } });
  assert.equal(replacementItems({ productIds: ['gold'] }, order({ monthly: true })), true, 'older invitations are monthly');
  assert.equal(replacementItems({ productIds: ['gold'], interval: 'year' }, order({ monthly: true })), false);
  assert.equal(replacementItems({ productIds: ['gold'], interval: 'year' }, order({ yearly: true })), true);
});

test('credit left after the first payment is added once to the new subscription\'s customer, after the old one stops', async t => {
  const { params, calls } = fixture();
  const env = { STRIPE_REPLACEMENT_ENABLED: 'true', STRIPE_REPLACEMENT_SOURCE_KEY: 'sk_test_source' };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '');
    const body = await params.source(path, init.method, init.body && Object.fromEntries(init.body));
    return { ok: true, json: async () => body };
  });
  const order = { ...params.order, replacementInvite: 'invite', replacementStatus: 'pending',
    replacementCredit: { interval: 'month', creditPence: 2500, appliedPence: 1000, carryForwardPence: 1500 } };
  const posted = [];
  const destination = async (path, body, method, options) => {
    if (method === 'POST') { posted.push({ path, body, options }); return {}; }
    return path === 'account' ? params.destination(path) : { ...(await params.destination(path)), customer: 'cus_new' };
  };
  const updates = [];
  const reference = collection => ({
    get: async () => ({ data: () => collection === 'orders' ? order : params.invite }),
    update: async (fields) => updates.push(fields)
  });
  const db = {
    collection: collection => ({ doc: () => reference(collection) }),
    getAll: async (...refs) => refs.map(() => ({ exists: false, data: () => undefined })),
    runTransaction: async action => action({ get: ref => ref.get(), update: () => {} }),
    batch: () => ({ update: (ref, fields) => { updates.push(fields); if (fields.replacementStatus) Object.assign(order, fields); }, commit: async () => {} })
  };
  const attention = { settle: async () => {}, raise: () => assert.fail('Unexpected warning') };
  await completeReplacement(db, 'order', { destination, attention });
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 1, 'the old subscription is stopped first');
  assert.deepEqual(posted, [{ path: 'customers/cus_new/balance_transactions',
    body: [['amount', '-1500'], ['currency', 'gbp'], ['description', 'Credit from your previous subscription'], ['metadata[order_ref]', 'order']],
    options: { idempotencyKey: 'order-replacement-credit' } }]);
  assert.ok(updates.some(fields => fields['replacementCredit.carriedForwardAt']));
  order.replacementCredit.carriedForwardAt = 'set';
  await completeReplacement(db, 'order', { destination, attention });
  assert.equal(posted.length, 1, 'a retry does not add the credit twice');
});
