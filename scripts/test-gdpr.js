import assert from 'node:assert/strict';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { registerGdprRoutes } from '../src/server/gdpr.js';
import { emailBlockId, normalEmailBlocked } from '../src/server/emailSuppression.js';

const projectId = 'demo-fcc-gdpr-tests';
assertLocalFirebase({ ...process.env, GCLOUD_PROJECT: projectId });
const firebase = initializeApp({ projectId }, 'gdpr-tests');
const db = getFirestore(firebase);
const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json());
const subscriptions = new Map();
const customers = new Map();
const calls = [];
const emails = [];
let failCustomer = false;
let failDelete = false;
let failJustgo = false;
let rejectJustgoPreparation = false;
const justgoLinks = new Set();
let unlinkCalls = 0;
const request = async (path, options = {}) => {
  const url = new URL(path, 'https://stripe.invalid/');
  calls.push({ path, method: options.method || 'GET' });
  const id = url.pathname.split('/').at(-1);
  if (url.pathname === '/customers') return { data: [...customers.values()].filter((customer) => !customer.deleted && customer.email === url.searchParams.get('email')), has_more: false };
  if (url.pathname === '/subscriptions') return { data: [...subscriptions.values()].filter((subscription) => subscription.customer === url.searchParams.get('customer')), has_more: false };
  if (url.pathname.startsWith('/customers/')) {
    if (failCustomer) throw new Error('Stripe customer update failed');
    const customer = customers.get(id);
    if (options.method === 'POST') {
      for (const [key, value] of options.body) customer[key] = value;
    } else if (options.method === 'DELETE') {
      if (failDelete) throw new Error('Stripe customer deletion failed after redaction');
      assert.equal([...subscriptions.values()].some((subscription) => subscription.customer === id && subscription.status === 'active'), false);
      customer.deleted = true;
    }
    return customer;
  }
  const subscription = subscriptions.get(id);
  if (!subscription) throw Object.assign(new Error('Missing subscription'), { stripeCode: 'resource_missing' });
  if (options.method === 'DELETE') {
    assert.equal(await normalEmailBlocked(db, '', { kind: 'subscription-stopped', subscriptionId: id }), true,
      'suppression is committed before Stripe can deliver its cancellation webhook');
    subscription.status = 'canceled';
  }
  return subscription;
};
process.env.STRIPE_SUBSCRIPTION_ADMIN_KEY = 'sk_test_local_gdpr_fixture';
registerGdprRoutes(app, {
  db: () => db, localFirebase: true,
  requireAdmin: async (req, res) => {
    if (req.headers['x-test-admin'] !== 'yes') { res.status(401).json({ error: 'Admin required.' }); return null; }
    return { uid: 'gdpr-admin', email: 'admin@example.test' };
  },
  stripeReportRequest: () => request,
  justgoErasure: {
    prepare: async (records) => {
      const linked = records.filter((record) => record.justgoMemberId);
      if (linked.length && rejectJustgoPreparation) throw new Error('JustGo unlinking is not configured');
      return { unlink: async () => {
        let unlinked = 0, alreadyUnlinked = 0;
        for (const record of linked) {
          if (!justgoLinks.has(record.justgoMemberId)) { alreadyUnlinked += 1; continue; }
          unlinkCalls += 1;
          justgoLinks.delete(record.justgoMemberId);
          if (failJustgo) throw new Error('JustGo removal result could not be confirmed');
          unlinked += 1;
        }
        return { unlinked, alreadyUnlinked };
      } };
    }
  },
  normalizeEmail: (email) => String(email || '').trim().toLowerCase(),
  isValidEmail: (email) => /^[^@]+@[^@]+$/.test(email),
  sendEmail: async (message) => {
    assert.equal(await normalEmailBlocked(db, message.to, message.record), false);
    emails.push(message);
    return true;
  },
  stopSubscriptionItems: async (id, items, admin, stripeRequest, reason) => {
    assert.equal(stripeRequest, request);
    assert.equal(reason, 'Requested by the member');
    assert.equal(admin.uid, 'gdpr-admin');
    const reference = db.collection('subscriptions').doc(id);
    const data = (await reference.get()).data();
    const keys = new Set(items.map((item) => item.lineId));
    await reference.update({ items: data.items.map((item) => keys.has(item.lineId) ? { ...item, status: 'cancelled' } : item) });
    subscriptions.get(id).items.data = subscriptions.get(id).items.data.filter((item) => !keys.has(item.metadata.line_id));
  }
});
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
let client = 0;
const call = async (route, body, admin = true) => {
  client += 1;
  const result = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/gdpr/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${client}`,
      ...(admin ? { 'x-test-admin': 'yes' } : {}) },
    body: JSON.stringify(body)
  });
  return { status: result.status, data: await result.json() };
};
const run = Date.now().toString(36);
const written = new Set();
const put = async (path, value) => { written.add(path); await db.doc(path).set(value); };
const make = async (suffix, { shared = false, historical = false } = {}) => {
  const id = `M_${run}_${suffix}`;
  const email = `${suffix}.${run}@example.test`;
  written.add(`gdprEmailBlocks/${emailBlockId(email)}`);
  const sub = `sub_${run}_${suffix}`;
  const customer = `cus_${run}_${suffix}`;
  const other = `${id}_other`;
  const members = shared ? [id, other] : [id];
  const names = shared ? ['Erased Member', 'Staying Member'] : ['Erased Member'];
  await put(`memberships/${id}`, {
    firstName: 'Erased', lastName: 'Member', dob: shared ? '2014-01-01' : '1990-01-01',
    email, ...(historical ? {} : { subscriptionIds: [sub] }),
    ...(shared ? { householdId: `H_${id}` } : {})
  });
  if (shared) {
    await put(`households/H_${id}`, { email });
    await put(`memberships/${other}`, { firstName: 'Staying', lastName: 'Member', dob: '1990-01-01', householdId: `H_${id}`, subscriptionIds: [sub] });
  }
  const items = members.map((member, index) => ({ lineId: `l${index}`, orderRef: `o_${id}`, membershipIds: [member], names: [names[index]],
    monthlyAmount: 10 + index, status: historical ? 'cancelled' : 'active', name: 'Monthly membership' }));
  await put(`subscriptions/${sub}`, { email, names, membershipIds: members, items, stripeMode: 'test',
    status: historical ? 'cancelled' : 'active', cancelRequests: [{ by: email, reason: 'Private reason', at: Timestamp.now(), lineKeys: [`o_${id}/l0`] }] });
  await put(`attention/${sub}`, { subscriptionId: sub, email, detail: 'Erased Member private cancellation reason', data: { email }, resolutionNote: 'Private note' });
  customers.set(customer, { id: customer, email, name: 'Erased Member' });
  subscriptions.set(sub, { id: sub, customer, status: historical ? 'canceled' : 'active',
    metadata: {}, items: { data: items.map((item) => ({ id: `si_${item.lineId}`, metadata: { line_id: item.lineId } })) } });
  return { id, email, sub, customer, other };
};

try {
  assert.equal((await call('preview', {}, false)).status, 401);
  const sole = await make('sole');
  await put(`stripeSubscriptions/FCC-test-${sole.sub}`, { id: sole.sub, stripeMode: 'test', clubCustomerId: `FCC-test-${sole.customer}`, membershipIds: [sole.id, `M_${run}_kept`] });
  await put(`stripeCustomers/FCC-test-${sole.customer}`, { stripeCustomerId: sole.customer, stripeMode: 'test', membershipIds: [sole.id] });
  const unexplained = await call('erase', { membershipId: sole.id, scope: 'person', confirm: 'ERASE' });
  assert.equal(unexplained.status, 400, 'erasure needs a reason');
  assert.equal(customers.get(sole.customer).deleted, undefined, 'nothing is erased without a reason');
  const erased = await call('erase', { membershipId: sole.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' });
  assert.equal(erased.status, 200, JSON.stringify(erased.data));
  assert.equal(subscriptions.get(sole.sub).status, 'canceled');
  assert.equal(customers.get(sole.customer).deleted, true);
  assert.equal(erased.data.stripeCustomersDeleted, 1);
  assert.ok(erased.data.manual.some((step) => /historical invoices/.test(step)));
  assert.equal((await db.doc(`memberships/${sole.id}`).get()).exists, false);
  const mirrored = (await db.doc(`stripeSubscriptions/FCC-test-${sole.sub}`).get()).data();
  assert.deepEqual([mirrored.membershipIds, mirrored.status], [[`M_${run}_kept`], 'Inactive'], 'the Stripe mirror forgets the erased member');
  assert.deepEqual((await db.doc(`stripeCustomers/FCC-test-${sole.customer}`).get()).data().membershipIds, []);
  const stored = (await db.doc(`subscriptions/${sole.sub}`).get()).data();
  assert.equal(stored.suppressNormalEmails, true);
  assert.equal(await normalEmailBlocked(db, sole.email, { kind: 'invoice-paid' }), true);
  assert.equal(emails.filter((message) => message.to === sole.email && message.record.kind === 'gdpr-erasure').length, 1);
  assert.doesNotMatch(emails[0].body, /https?:|membership\?/);
  assert.equal(stored.email, '');
  assert.equal(stored.status, 'cancelled');
  assert.deepEqual(stored.names, []);
  assert.deepEqual(stored.membershipIds, []);
  assert.equal(stored.items[0].monthlyAmount, 10);
  assert.equal(JSON.stringify(stored).includes('Erased Member'), false);
  assert.equal(JSON.stringify(stored).includes('Private reason'), false);
  const alert = (await db.doc(`attention/${sole.sub}`).get()).data();
  assert.equal(alert.email, '');
  assert.equal(alert.resolutionNote, '');
  assert.deepEqual(alert.data, {});

  const shared = await make('shared', { shared: true });
  const partial = await call('erase', { membershipId: shared.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' });
  assert.equal(partial.status, 200, JSON.stringify(partial.data));
  assert.equal(partial.data.subscriptionItemsStopped, 1);
  assert.equal(subscriptions.get(shared.sub).status, 'active');
  assert.equal(customers.get(shared.customer).deleted, undefined);
  const kept = (await db.doc(`subscriptions/${shared.sub}`).get()).data();
  assert.deepEqual(kept.names, ['Staying Member']);
  assert.deepEqual(kept.membershipIds, [shared.other]);
  assert.equal(kept.items[0].status, 'cancelled');
  assert.equal(kept.items[1].status, 'active');
  assert.equal(kept.email, shared.email, 'the contact address belongs to the remaining household');
  assert.equal(await normalEmailBlocked(db, shared.email, { kind: 'invoice-paid', subscriptionId: shared.sub }), false,
    'remaining household members can still receive normal emails');

  const old = await make('historical', { historical: true });
  const historical = await call('erase', { membershipId: old.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' });
  assert.equal(historical.status, 200, JSON.stringify(historical.data));
  assert.equal((await db.doc(`subscriptions/${old.sub}`).get()).data().email, '', 'old subscriptions are found even without a member pointer');

  const retry = await make('retry');
  failCustomer = true;
  const refused = await call('erase', { membershipId: retry.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' });
  assert.equal(refused.status, 500);
  assert.match(refused.data.error, /member records were kept/);
  assert.equal((await db.doc(`memberships/${retry.id}`).get()).exists, true);
  assert.equal(subscriptions.get(retry.sub).status, 'canceled', 'billing stopped even though Stripe redaction failed');
  assert.equal(await normalEmailBlocked(db, retry.email, { kind: 'subscription-stopped', subscriptionId: retry.sub }), true,
    'a failed erasure does not reopen normal mail while awaiting retry');
  failCustomer = false;
  failDelete = true;
  assert.equal((await call('erase', { membershipId: retry.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' })).status, 500);
  assert.equal(customers.get(retry.customer).email, '', 'the failed deletion already cleared the search email');
  failDelete = false;
  assert.equal((await call('erase', { membershipId: retry.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' })).status, 200);
  assert.equal(customers.get(retry.customer).deleted, true);
  assert.ok(calls.some((entry) => entry.method === 'DELETE'));
  const justgo = await make('justgo');
  const justgoId = '22222222-2222-2222-2222-222222222222';
  await db.doc(`memberships/${justgo.id}`).update({ justgoMemberId: justgoId, justgoSyncStatus: 'synced' });
  justgoLinks.add(justgoId);
  rejectJustgoPreparation = true;
  assert.equal((await call('erase', { membershipId: justgo.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' })).status, 500);
  assert.equal(subscriptions.get(justgo.sub).status, 'active', 'JustGo preparation fails before billing cancellation');
  assert.equal((await db.doc(`memberships/${justgo.id}`).get()).exists, true);
  rejectJustgoPreparation = false;
  failJustgo = true;
  const unconfirmed = await call('erase', { membershipId: justgo.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' });
  assert.equal(unconfirmed.status, 500);
  assert.match(unconfirmed.data.error, /Check Stripe and JustGo/);
  assert.equal((await db.doc(`memberships/${justgo.id}`).get()).exists, true, 'unconfirmed unlink cannot erase local member');
  assert.equal(subscriptions.get(justgo.sub).status, 'canceled');
  failJustgo = false;
  const confirmed = await call('erase', { membershipId: justgo.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.justgoAlreadyUnlinked, 1);
  assert.equal(unlinkCalls, 1, 'retry checks current link state instead of removing twice');
  assert.ok(confirmed.data.manual.some((step) => /accounts and other clubs were not deleted/.test(step)));
  assert.equal((await db.doc(`memberships/${justgo.id}`).get()).exists, false);
  const normalJustgo = await make('justgosuccess');
  await db.doc(`memberships/${normalJustgo.id}`).update({ justgoMemberId: justgoId });
  justgoLinks.add(justgoId);
  await put(`memberships/${normalJustgo.id}_duplicate`, { justgoMemberId: justgoId });
  assert.equal((await call('erase', { membershipId: normalJustgo.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' })).status, 409);
  assert.equal(subscriptions.get(normalJustgo.sub).status, 'active', 'a staying linked account cannot be removed');
  await db.doc(`memberships/${normalJustgo.id}_duplicate`).delete();
  const complete = await call('erase', { membershipId: normalJustgo.id, scope: 'person', confirm: 'ERASE', reason: 'Requested by the member' });
  assert.equal(complete.status, 200, JSON.stringify(complete.data));
  assert.equal(complete.data.justgoUnlinked, 1);
  console.log('GDPR checks passed: cancellation, shared-item isolation, Stripe redaction/deletion, confirmed FCC-only JustGo unlinking, retained records on failure and safe retry.');
} finally {
  await Promise.all([...written].map((path) => db.doc(path).delete()));
  await new Promise((resolve) => server.close(resolve));
  await deleteApp(firebase);
}
