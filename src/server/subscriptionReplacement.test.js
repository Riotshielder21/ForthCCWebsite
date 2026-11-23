import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { emailBlockId } from './emailSuppression.js';
import { annualReplacementCredit } from './annualReplacementCredit.js';
import { claimReplacement, completeReplacement, replacementTokenHash, stopReplacedSubscription } from './subscriptionReplacement.js';

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

test('annual dry run values unused days at what was paid, with a strict 300-day cutoff', () => {
  const day = 86400;
  const price = { id: 'price_annual', recurring: { interval: 'year', interval_count: 1 } };
  const subscription = { id: 'sub_annual', items: { data: [{ price }] } };
  const start = Date.parse('2027-01-01T00:00:00Z') / 1000;
  const end = start + 365 * day;
  const invoice = {
    status: 'paid', currency: 'gbp', subscription: subscription.id, amount_paid: 12000, amount_due: 12000,
    charge: { paid: true, currency: 'gbp', amount: 12000, amount_refunded: 0, disputed: false },
    lines: { data: [{ type: 'subscription', proration: false, period: { start, end }, price }] }
  };
  assert.deepEqual(annualReplacementCredit(subscription, invoice, end - 90 * day), {
    creditPence: 2959, remainingDays: 90, cardOnly: false, cardOnlyFirstChargeAt: null
  });
  assert.equal(annualReplacementCredit(subscription, invoice, end - 300 * day).cardOnly, false);
  assert.equal(annualReplacementCredit(subscription, invoice, end - 301 * day).cardOnlyFirstChargeAt, '2028-03-01T00:00:00.000Z');
  assert.equal(annualReplacementCredit(subscription, { ...invoice, charge: { ...invoice.charge, amount_refunded: 1 } }, start), null);
});
