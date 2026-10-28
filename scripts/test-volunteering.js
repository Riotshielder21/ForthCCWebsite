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
import { DEFAULT_VOLUNTEER_PAGE } from '../src/utils/volunteerPage.js';

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
const coordinatorSettings = db.collection('settings').doc('volunteerCoordinator');
const originalCoordinatorSettings = await coordinatorSettings.get();
const pageSettings = db.collection('settings').doc('volunteerPage');
const originalPageSettings = await pageSettings.get();
const versionCounter = db.collection('settings').doc('volunteerVersions');
const originalVersionCounter = await versionCounter.get();
const originalVersions = await db.collection('volunteerVersions').get();
const clearVersions = async () => {
  await Promise.all((await db.collection('volunteerVersions').get()).docs.map((document) => document.ref.delete()));
  await versionCounter.delete();
};
let signupId;
try {
  await pageSettings.delete();
  await clearVersions();
  const defaultPage = await call('/api/volunteering', 'GET', null, null, false);
  assert.equal(defaultPage.status, 200);
  assert.deepEqual(defaultPage.data.content, DEFAULT_VOLUNTEER_PAGE);
  assert.equal(defaultPage.data.tiers.length, 3);
  const liveContent = { ...DEFAULT_VOLUNTEER_PAGE, title: 'Live volunteer page', formTitle: 'Join our volunteers',
    opportunities: [{ title: 'Test opportunity', description: 'Help run a session' }] };
  assert.equal((await call('/api/admin/volunteering', 'POST', liveContent, null, false)).status, 401);
  assert.equal((await call('/api/admin/volunteering', 'POST', { ...liveContent, tileLayout: [] })).status, 400);
  assert.equal((await call('/api/admin/volunteering', 'POST', { ...liveContent, fields: ['Custom question'] })).status, 400);
  assert.equal((await call('/api/admin/volunteering', 'POST', liveContent)).status, 200);
  assert.deepEqual((await call('/api/volunteering', 'GET', null, null, false)).data.content, liveContent, 'fresh public reads see saved content without a build');
  assert.equal((await pageSettings.get()).data().updatedBy, 'test-admin');
  assert.ok((await pageSettings.get()).data().updatedAt instanceof Timestamp);
  assert.deepEqual((await call('/api/volunteer-benefits')).data.tiers, defaultPage.data.tiers, 'wording saves do not change benefits');
  assert.equal((await call('/api/admin/volunteering', 'POST', { ...liveContent, opportunities: [] })).status, 200);
  assert.deepEqual((await call('/api/volunteering')).data.content.opportunities, [], 'all list items can be removed without deleting its fixed tile');
  await form.set({ name: 'Test form', fields: ['Activity'], clubYear: year });
  const submitted = await call(`/api/forms/${form.id}`, 'POST', { name: 'Volunteer Tester', email, items: ['Activity: Canoeing'] }, null, false);
  assert.equal(submitted.status, 200);
  const responses = await db.collection('formSubmissions').where('formId', '==', form.id).get();
  assert.equal(responses.size, 1);
  assert.match(responses.docs[0].id, /^R\d{5,}$/);
  await coordinatorSettings.set({ email: `coordinator-${run}@example.test` });
  await member.set({ firstName: 'Volunteer', lastName: 'Tester', email, dob: '1989-04-03', status: 'active', renewalMethod: 'website',
    validUntil: Timestamp.fromDate(clubYearDates(year).end), clubYears: [year], privileges: [{ productId: 'boat-hire', clubYear: year }] });
  assert.equal((await call('/api/lists', 'POST', { name: 'Volunteer Tester', email, listType: 'Volunteer Sign-ups', tier: '40', items: ['Coaching', 'Weekends'] })).status, 200);
  assert.equal(sent.find((message) => message.record.kind === 'volunteer-induction')?.to, `coordinator-${run}@example.test`);
  signupId = (await db.collection('lists').where('email', '==', email).get()).docs[0].id;
  assert.match(signupId, /^V\d{5,}$/);
  const path = `/api/admin/volunteers/${signupId}`;
  assert.equal((await call(path, 'PATCH', { active: true }, null, false)).status, 401);
  assert.equal((await call(path, 'PATCH', { active: true })).status, 200);
  let data = (await member.get()).data();
  assert.equal(data.volunteer.inducted, true);
  assert.equal(data.volunteer.years[year].tier, '40');
  assert.equal(data.volunteer.years[year].active, true);
  assert.deepEqual(data.privileges, [{ productId: 'boat-hire', clubYear: year }], 'already paid benefit is not changed');
  assert.equal(sent.filter((message) => message.record.kind === 'volunteer-benefits').length, 1);
  assert.equal((await call('/api/admin/volunteer-coordinator')).data.email, `coordinator-${run}@example.test`);
  assert.equal((await call('/api/admin/volunteer-coordinator', 'PUT', { email: 'not-an-email' })).status, 400);
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
  const extraLevel = { id: `level-${run}`.toLowerCase().slice(0, 40), hours: 80, title: 'Committee', description: 'Run the club', extra: '', monthlyDiscount: 0, monthlyCap: 0, freeProductIds: [] };
  const withExtra = await call('/api/admin/volunteer-benefits', 'POST', { tiers: [...DEFAULT_VOLUNTEER_BENEFITS, extraLevel] });
  assert.equal(withExtra.status, 200, JSON.stringify(withExtra.data));
  assert.equal((await call('/api/volunteer-benefits')).data.tiers.at(-1).title, 'Committee');
  const inUse = await call('/api/admin/volunteer-benefits', 'POST', { tiers: DEFAULT_VOLUNTEER_BENEFITS.filter((level) => level.id !== '40') });
  assert.equal(inUse.status, 409, 'a level with volunteers this year cannot be deleted');
  assert.match(inUse.data.error, /40\+ hours/);
  assert.equal((await call('/api/admin/volunteer-benefits', 'POST', { tiers: DEFAULT_VOLUNTEER_BENEFITS })).status, 200, 'an unused level can be deleted');

  assert.equal((await call('/api/admin/volunteering/versions', 'GET', null, null, false)).status, 401);
  const history = (await call('/api/admin/volunteering/versions')).data.versions;
  assert.deepEqual(history.map((item) => item.version), [6, 5, 4, 3, 2, 1], 'version 1 is created on the server and every save adds a version; rejected saves do not');
  assert.deepEqual([history.at(-1).change, history.at(-1).editor], ['initial', 'Server (initial version)']);
  assert.deepEqual([history[4].change, history[4].editor], ['content', 'admin@forthcanoeclub.co.uk']);
  assert.equal(history[1].change, 'levels');
  assert.ok(!Number.isNaN(Date.parse(history[0].createdAt)));
  assert.equal((await call('/api/admin/volunteering/versions/2/restore', 'POST', null, null, false)).status, 401);
  assert.equal((await call('/api/admin/volunteering/versions/999/restore', 'POST')).status, 404);
  assert.equal((await call('/api/admin/volunteering/versions/abc/restore', 'POST')).status, 400);
  const restoredContent = await call('/api/admin/volunteering/versions/2/restore', 'POST');
  assert.equal(restoredContent.status, 200, JSON.stringify(restoredContent.data));
  assert.equal(restoredContent.data.version, 7);
  assert.deepEqual((await call('/api/volunteering', 'GET', null, null, false)).data.content, liveContent, 'restoring version 2 brings back its content');
  const restoredLevels = await call('/api/admin/volunteering/versions/5/restore', 'POST');
  assert.equal(restoredLevels.status, 200, JSON.stringify(restoredLevels.data));
  assert.equal((await call('/api/volunteer-benefits')).data.tiers.at(-1).title, 'Committee', 'restoring version 5 brings back its levels');
  assert.deepEqual((await call('/api/volunteering')).data.content.opportunities, [], 'and the content saved at that time');
  const latest = (await call('/api/admin/volunteering/versions')).data.versions;
  assert.deepEqual(latest.slice(0, 2).map((item) => [item.version, item.change, item.restoredFrom]), [[8, 'restore', 5], [7, 'restore', 2]]);
  await db.collection('volunteerVersions').doc('v009999').set({ version: 9999, change: 'levels', editor: 'test', createdAt: Timestamp.now(),
    content: liveContent, tiers: DEFAULT_VOLUNTEER_BENEFITS.filter((level) => level.id !== '40') });
  const blocked = await call('/api/admin/volunteering/versions/9999/restore', 'POST');
  assert.equal(blocked.status, 409, 'a restore cannot delete a level still in use');
  assert.deepEqual((await call('/api/volunteering')).data.content.opportunities, [], 'a blocked restore changes nothing');
  await db.collection('volunteerVersions').doc('v009999').delete();
  assert.equal((await call('/api/admin/volunteering/versions/6/restore', 'POST')).status, 200);
  assert.equal((await call('/api/volunteer-benefits')).data.tiers.length, 3);
  assert.equal((await call('/api/lists', 'POST', { name: 'Unknown Level', email: `unknown-${email}`, listType: 'Volunteer Sign-ups', tier: extraLevel.id, items: ['Coaching'] })).status, 400);
  assert.equal((await member.get()).data().volunteer.years[year].hours, 40, 'member records keep the level hours for labels');
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
  await pendingSignup.delete();
  const repeatedRenewals = await Promise.all([
    call(`/api/volunteers/renew/${token}`, 'POST', { tier: '60' }),
    call(`/api/volunteers/renew/${token}`, 'POST', { tier: '60' })
  ]);
  assert.ok(repeatedRenewals.every((result) => result.status === 200));
  const renewedSignups = await db.collection('lists').where('memberId', '==', memberId).where('clubYear', '==', year + 1).get();
  assert.equal(renewedSignups.size, 1, 'concurrent renewals create only one signup');
  assert.match(renewedSignups.docs[0].id, /^V\d{5,}$/);
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
  console.log('PASS: live volunteering content, version history and restore, fixed layout/form, induction coordinator notification, membership benefits, deactivation, JustGo statuses and renewal links.');
} finally {
  const lists = await db.collection('lists').where('memberId', '==', memberId).get();
  const links = await db.collection('volunteerRenewals').where('memberId', '==', memberId).get();
  const invites = await db.collection('renewalInvites').where('membershipIds', 'array-contains', memberId).get();
  const submissions = await db.collection('formSubmissions').where('formId', '==', form.id).get();
  await Promise.all([...lists.docs, ...links.docs, ...invites.docs, ...submissions.docs].map((document) => document.ref.delete()));
  await form.delete();
  if (originalSettings.exists) await settings.set(originalSettings.data());
  else await settings.delete();
  if (originalCoordinatorSettings.exists) await coordinatorSettings.set(originalCoordinatorSettings.data());
  else await coordinatorSettings.delete();
  if (originalPageSettings.exists) await pageSettings.set(originalPageSettings.data());
  else await pageSettings.delete();
  await clearVersions();
  await Promise.all(originalVersions.docs.map((document) => document.ref.set(document.data())));
  if (originalVersionCounter.exists) await versionCounter.set(originalVersionCounter.data());
  await member.delete();
  await new Promise((resolve) => server.close(resolve));
  await db.terminate();
}
