import assert from 'node:assert/strict';
import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { registerVolunteerRoutes } from '../src/server/volunteers.js';
import { registerRenewalRoutes } from '../src/server/renewals.js';
import { registerMemberCheckRoutes } from '../src/server/memberChecks.js';
import { registerKeyAccessRoutes } from '../src/server/keyAccess.js';
import { clubYearOf, clubYearDates } from '../src/utils/clubYear.js';
import { PRODUCTS } from '../src/constants/products.js';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { DEFAULT_VOLUNTEER_BENEFITS } from '../src/utils/volunteering.js';

assertLocalFirebase({ ...process.env, GCLOUD_PROJECT: 'demo-fcc-volunteer-tests' });
const db = getFirestore(initializeApp({ projectId: 'demo-fcc-volunteer-tests' }, 'volunteer-tests'));
const app = express();
app.use(express.json());
const sent = [];
const year = clubYearOf();
const now = (req) => req.headers['x-test-now'] ? new Date(req.headers['x-test-now']) : new Date();
const requireAdmin = async (req, res) => {
  if (req.headers.authorization !== 'Bearer test-admin') { res.status(401).json({ error: 'Admin required.' }); return null; }
  return { uid: 'test-admin', email: 'admin@forthcanoeclub.co.uk' };
};
const sendEmail = async (message) => { sent.push(message); return true; };
const { settleKeyAccess } = registerKeyAccessRoutes(app, { requireAdmin, db: () => db, sendEmail });
const volunteers = registerVolunteerRoutes(app, { requireAdmin, db: () => db, sheets: () => null,
  toMembershipRecord: (document) => ({ ...document.data(), validUntil: document.data().validUntil.toMillis() }),
  stripeSubscriptionIsActive: async () => true, settleKeyAccess, sendEmail, loadCatalogue: async () => PRODUCTS, requestNow: now });
registerMemberCheckRoutes(app, { requireAdmin, db: () => db });
process.env.RENEWAL_JOB_TOKEN = 'local-test-volunteer-job-token-0123456789';
registerRenewalRoutes(app, { requireAdmin, db: () => db, loadCatalogue: async () => PRODUCTS, sendEmail,
  siteUrl: () => 'http://example.test', requestNow: now, ...volunteers });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.on('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, method = 'GET', body, date = null, admin = true) => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json',
    ...(admin ? { Authorization: 'Bearer test-admin' } : {}), ...(date ? { 'X-Test-Now': date } : {}) },
  body: body && JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
};
const run = Date.now().toString(36);
const memberId = `volunteer-${run}`;
const email = `${run}@example.test`;
const member = db.collection('memberships').doc(memberId);
const form = db.collection('forms').doc(`form-${run}`);
const settings = db.collection('settings').doc('volunteerBenefits');
const originalSettings = await settings.get();
let signupId;
try {
  await member.set({ firstName: 'Volunteer', lastName: 'Tester', email, status: 'active', renewalMethod: 'website',
    validUntil: Timestamp.fromDate(clubYearDates(year).end), clubYears: [year], privileges: [{ productId: 'boat-hire', clubYear: year }] });
  assert.equal((await call('/api/lists', 'POST', { name: 'Volunteer Tester', email, listType: 'Volunteer Sign-ups', tier: '40', items: ['Coaching', 'Weekends'] })).status, 200);
  signupId = (await db.collection('lists').where('email', '==', email).get()).docs[0].id;
  const path = `/api/admin/volunteers/${signupId}`;
  assert.equal((await call(path, 'PATCH', { active: true }, null, false)).status, 401);
  assert.equal((await call(path, 'PATCH', { active: true })).status, 200);
  let data = (await member.get()).data();
  assert.equal(data.volunteer.inducted, true);
  assert.equal(data.volunteer.years[year].tier, '40');
  assert.equal(data.volunteer.years[year].active, true);
  assert.deepEqual(data.privileges, [{ productId: 'boat-hire', clubYear: year }], 'already paid benefit is not changed');
  assert.equal(sent.filter((message) => message.record.kind === 'volunteer-benefits').length, 1);
  await call(path, 'PATCH', { active: false });
  assert.equal((await member.get()).data().volunteer.inducted, true);
  assert.equal((await member.get()).data().volunteer.years[year].active, false);
  await call(path, 'PATCH', { active: true });
  assert.equal(sent.filter((message) => message.record.kind === 'volunteer-benefits').length, 1, 'retry does not email benefits twice');
  // Old inducted rows are reconciled into the register without sending another benefits email.
  await member.update({ volunteer: {} });
  await db.collection('lists').doc(signupId).update({ memberId: null });
  let restored = await call('/api/admin/volunteers');
  assert.equal(restored.status, 200);
  assert.equal(restored.data.volunteers.find((volunteer) => volunteer.id === signupId).memberId, memberId);
  data = (await member.get()).data();
  assert.equal(data.volunteer.inducted, true);
  assert.equal(data.volunteer.years[year].active, true);
  assert.equal(data.volunteer.years[year].tier, '40');
  const profile = JSON.stringify(data.volunteer);
  await call('/api/admin/volunteers');
  assert.equal(JSON.stringify((await member.get()).data().volunteer), profile, 'reconciliation is repeatable');
  assert.equal(sent.filter((message) => message.record.kind === 'volunteer-benefits').length, 1, 'opening the table sends no emails');
  assert.equal((await call('/api/admin/volunteer-benefits', 'POST', { tiers: DEFAULT_VOLUNTEER_BENEFITS }, null, false)).status, 401);
  assert.equal((await call('/api/admin/volunteer-benefits', 'POST', { tiers: DEFAULT_VOLUNTEER_BENEFITS })).status, 200);
  assert.equal((await call('/api/volunteer-benefits')).data.tiers.length, 3);
  await form.set({ name: 'Enquiry', description: 'Test form', clubYear: year, fields: ['Reason'] });
  assert.ok((await call('/api/forms')).data.forms.some((candidate) => candidate.id === form.id));
  const formBody = { name: 'Form Tester', email, items: ['Reason: Test enquiry'] };
  assert.equal((await call(`/api/forms/${form.id}`, 'POST', { ...formBody, items: ['Wrong: No'] })).status, 400);
  assert.equal((await call(`/api/forms/${form.id}`, 'POST', formBody)).status, 200);

  assert.equal((await call(`/api/admin/memberships/${memberId}/checks`, 'PATCH', { pvg: '2028-01-01' })).status, 200);
  await member.update({ justgoSyncStatus: 'synced', checks: { pvg: { source: 'justgo', label: 'Current' } },
    validUntil: Timestamp.fromDate(clubYearDates(year + 1).end), clubYears: [year, year + 1] });
  const list = (await call('/api/admin/volunteers')).data.volunteers.find((volunteer) => volunteer.id === signupId);
  assert.equal(list.checksSynced, true);
  assert.equal(list.checks.pvg.label, 'Current');
  assert.equal((await call(`/api/admin/memberships/${memberId}/checks`, 'PATCH', { pvg: '' })).status, 409);
  await member.update({ justgoSyncStatus: 'pending', lastJustgoSync: Timestamp.now() });
  assert.equal((await call('/api/admin/volunteers')).data.volunteers.find((volunteer) => volunteer.id === signupId).checksSynced, true);
  assert.equal((await call(`/api/admin/memberships/${memberId}/checks`, 'PATCH', { pvg: '' })).status, 409, 'a future membership upload does not unlock JustGo checks');


  const job = async (day) => {
    const response = await fetch(`${base}/api/jobs/renewals`, { method: 'POST', headers: {
      Authorization: `Bearer ${process.env.RENEWAL_JOB_TOKEN}`, 'X-Test-Now': `${year + 1}-02-${day}T09:00:00Z` } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  await job('01');
  assert.equal(sent.filter((message) => message.record.kind === 'renewal').length, 0, 'next-year members receive no membership renewal');
  assert.equal(sent.filter((message) => message.record.kind === 'volunteer-renewal').length, 1, 'but they get a volunteer-only reminder');
  await job('01');
  assert.equal(sent.filter((message) => message.record.kind === 'volunteer-renewal').length, 1);
  await job('15');
  assert.equal(sent.filter((message) => message.record.kind === 'volunteer-renewal').length, 2);
  const message = sent.find((message) => message.record.kind === 'volunteer-renewal');
  const token = /volunteerRenew=([a-f0-9]{64})/.exec(message.body)[1];
  assert.equal((await call(`/api/volunteers/renew/${token}`)).status, 200);
  assert.equal((await member.get()).data().volunteer.years[year + 1], undefined, 'opening a link does not reactivate');
  const pendingSignup = db.collection('lists').doc(`pending-${run}`);
  await pendingSignup.set({ memberId, name: 'Volunteer Tester', email, listType: 'Volunteer Sign-ups', clubYear: year + 1,
    tier: '20', active: false, inducted: true, items: ['Activities: Canoeing'], notes: 'Keep this note', createdAt: Timestamp.now() });
  assert.equal((await call(`/api/volunteers/renew/${token}`, 'POST', { tier: '60' })).status, 200);
  assert.equal((await db.collection('lists').where('memberId', '==', memberId).where('clubYear', '==', year + 1).get()).size, 1, 'renewal reuses the pending signup');
  assert.deepEqual((await pendingSignup.get()).data().items, ['Activities: Canoeing']);
  assert.equal((await pendingSignup.get()).data().notes, 'Keep this note');
  assert.equal((await pendingSignup.get()).data().email, email);
  await call('/api/admin/volunteers');
  assert.equal((await member.get()).data().volunteer.years[year + 1].tier, '60', 'opening the table cannot replace renewed status with an older pending signup');

  data = (await member.get()).data();
  assert.equal(data.volunteer.years[year + 1].tier, '60');
  assert.equal(data.volunteer.years[year + 1].active, true);
  assert.match(data.volunteer.years[year + 1].benefits.join(' '), /CVC/);
  await job('15');
  assert.equal(sent.filter((message) => message.record.kind === 'volunteer-renewal').length, 2);
  assert.equal((await call(`/api/volunteers/renew/${token}`, 'GET', null, `${year + 1}-04-15T09:00:00Z`)).status, 404);
  await member.update({ validUntil: Timestamp.fromDate(clubYearDates(year).end), clubYears: [year],
    [`volunteer.years.${year + 1}.active`]: false });
  const combined = await call('/api/admin/renewals/send', 'POST', { membershipId: memberId }, `${year + 1}-01-15T09:00:00Z`);
  assert.equal(combined.data.emails, 1);
  assert.match(sent.find((message) => message.record.kind === 'renewal').body, /Keep your 40\+ hour commitment/);
  console.log('PASS: activation, membership benefits, deactivation, JustGo statuses, two volunteer-only renewal reminders, safe renewal links and changed brackets.');
} finally {
  const lists = await db.collection('lists').where('memberId', '==', memberId).get();
  const links = await db.collection('volunteerRenewals').where('memberId', '==', memberId).get();
  const invites = await db.collection('renewalInvites').where('membershipIds', 'array-contains', memberId).get();
  const submissions = await db.collection('formSubmissions').where('formId', '==', form.id).get();
  await Promise.all([...lists.docs, ...links.docs, ...invites.docs, ...submissions.docs].map((document) => document.ref.delete()));
  await form.delete();
  if (originalSettings.exists) await settings.set(originalSettings.data());
  else await settings.delete();
  await member.delete();
  await new Promise((resolve) => server.close(resolve));
  await db.terminate();
}
