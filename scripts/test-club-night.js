import assert from 'node:assert/strict';
import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { registerEmailCodeRoutes } from '../src/server/emailCodes.js';
import { registerMyDetailsRoutes } from '../src/server/myDetails.js';
import { registerClubNightRoutes } from '../src/server/clubNight.js';
import { registerGdprRoutes } from '../src/server/gdpr.js';
import { registerEventRosterRoutes } from '../src/server/eventRosters.js';
import crypto from 'node:crypto';
import { clubYearOf, clubYearDates } from '../src/utils/clubYear.js';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { VOLUNTEER_LIST } from '../src/utils/lists.js';
import { allocateRecordIds } from '../src/utils/recordIds.js';

const PROJECT = 'demo-fcc-club-night-tests';
assertLocalFirebase({ ...process.env, GCLOUD_PROJECT: PROJECT });
const db = getFirestore(initializeApp({ projectId: PROJECT }, 'club-night-tests'));
const COLLECTIONS = ['households', 'memberships', 'lists', 'clubNightCheckins', 'clubNightAccessLog', 'emailCodes', 'emailSessions', 'selfServiceChanges', 'settings', 'counters', 'orders', 'auditLog', 'formSubmissions', 'discountCodes', 'renewalInvites', 'volunteerRenewals', 'membershipTerms', 'selfAssessmentLog', 'eventRosterAccess', 'eventRosterAccessLog', 'eventRosters'];
const clear = async () => {
  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
};

const app = express();
app.set('trust proxy', true);
app.use(express.json());
const sent = [];
const sendEmail = async (message) => { sent.push(message); return true; };
const requireAdmin = async (req, res) => {
  if (req.headers.authorization !== 'Bearer admin') { res.status(401).json({ error: 'Admin required.' }); return null; }
  return { uid: 'admin', email: 'admin@forthcanoeclub.co.uk' };
};
const requestNow = (req) => req.headers['x-test-now'] ? new Date(req.headers['x-test-now']) : new Date();
const emailCodes = registerEmailCodeRoutes(app, { db: () => db, sendEmail });
const eventProducts = [];
registerMyDetailsRoutes(app, { db: () => db, sendEmail, emailCodes });
const loadCatalogue = async () => [{ id: 'gold-sub', name: 'Gold subscription', category: 'SUBSCRIPTIONS' }, { id: 'boat-hire', name: 'Boat hire', category: 'ADDONS' }, ...eventProducts];
const { canViewEventRosters } = registerEventRosterRoutes(app, { requireAdmin, db: () => db, sendEmail, loadCatalogue, emailCodes, requestNow });
registerClubNightRoutes(app, { requireAdmin, db: () => db, emailCodes, requestNow, loadCatalogue, canViewEventRosters });
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
process.env.STRIPE_SUBSCRIPTION_ADMIN_KEY = 'rk_test_club_night_fixture';
registerGdprRoutes(app, { requireAdmin, db: () => db, localFirebase: true, normalizeEmail, isValidEmail: (value) => /^[^@\s]+@[^@\s]+$/.test(value),
  customerId: (email) => crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex'),
  stripeReportRequest: (key) => async (path) => {
    assert.equal(key, 'rk_test_club_night_fixture');
    assert.ok(path.startsWith('customers?'), `Unexpected Stripe request: ${path}`);
    return { data: [], has_more: false };
  } });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.on('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let ip = 0;
const call = async (path, { method = 'GET', body, at, admin = false, session } = {}) => {
  ip += 1;
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.${Math.floor(ip / 250)}.${ip % 250}`,
    ...(admin ? { Authorization: 'Bearer admin' } : {}), ...(at ? { 'X-Test-Now': at } : {}), ...(session ? { 'X-Email-Session': session } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
};
const lastCode = (to) => {
  const message = sent.filter((candidate) => candidate.to === to && candidate.record.kind === 'email-code').at(-1);
  return message && /(\d{6})/.exec(message.subject)[1];
};
const signIn = async (email, purpose, dob, at) => {
  const before = sent.length;
  assert.equal((await call('/api/email-codes', { method: 'POST', body: { email, purpose, dob }, at })).status, 200);
  assert.equal(sent.length, before + 1, `${purpose} code emailed to ${email}`);
  const verified = await call('/api/email-codes/verify', { method: 'POST', body: { email, purpose, dob, code: lastCode(email) }, at });
  assert.equal(verified.status, 200);
  return verified.data.token;
};

const year = clubYearOf();
const clubNight = new Date(`${year}-03-12T19:00:00Z`);
const tonight = clubNight.toISOString();
const nextWeek = new Date(clubNight.getTime() + 7 * 86400000).toISOString();
const afterHours = new Date(clubNight.getTime() + 3 * 3600000).toISOString();
const member = { firstName: 'Casey', lastName: 'Member', email: 'casey@example.test', dob: '1988-02-03' };
const guest = { firstName: 'Gale', lastName: 'Guest', email: 'gale@example.test', dob: '1995-06-07' };
const volunteer = 'vol@example.test';

await clear();
try {
  await db.collection('households').doc('HH-MEMBER').set({ contactName: 'Casey Member', contactRelationship: 'Member', email: member.email, phone: '0700 000001',
    address: '1 Quay', postcode: 'EH1 1AA', emergencyContact: { name: 'Robin Member', relationship: 'Partner', phone: '0700 000002' } });
  await db.collection('memberships').doc('M0001').set({ firstName: member.firstName, lastName: member.lastName, dob: member.dob, householdId: 'HH-MEMBER',
    status: 'active', renewalMethod: 'website', validUntil: Timestamp.fromDate(clubYearDates(year).end) });
  await db.collection('membershipTerms').doc(`M0001_${year}`).set({ membershipId: 'M0001', clubYear: year, items: [{ productId: 'boat-hire' }] });
  await db.collection('households').doc('HH-JUSTGO').set({ contactName: 'Jo Go', email: 'jo@example.test', phone: '1', address: 'a', postcode: 'b', emergencyContact: null });
  await db.collection('memberships').doc('M0002').set({ firstName: 'Jo', lastName: 'Go', dob: '1970-01-01', householdId: 'HH-JUSTGO', status: 'active', justgoSyncStatus: 'synced' });
  await db.collection('counters').doc('memberships').set({ next: 3 });
  await db.collection('lists').add({ listType: VOLUNTEER_LIST, email: volunteer, inducted: true, active: true, clubYear: year });

  // Schedule
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: member, at: tonight })).status, 403, 'closed until scheduled');
  assert.equal((await call('/api/admin/club-night', { method: 'PUT', body: { weekday: 1, start: '18:00', end: '21:00' } })).status, 401);
  assert.equal((await call('/api/admin/club-night', { method: 'PUT', admin: true, body: { sessions: [{ name: 'Club night', weekday: 1, start: '21:00', end: '18:00' }] } })).status, 400);
  const weekday = clubNight.getUTCDay();
  const clubNightOnly = { sessions: [{ name: 'Club night', weekday, start: '18:00', end: '21:00', boatHire: true }] };
  assert.equal((await call('/api/admin/club-night', { method: 'PUT', admin: true, body: clubNightOnly })).status, 200);
  assert.equal((await call('/api/club-night', { at: tonight })).data.open, true);
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: member, at: `${year}-03-12T00:00:00Z` })).status, 200, 'public check-in opens at midnight before the session');
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: member, at: afterHours })).status, 200, 'public check-in remains open after the session');
  const midnight = new Date(clubNight.getTime()); midnight.setUTCHours(24, 0, 0, 0);
  assert.equal((await call('/api/club-night', { at: tonight })).data.dayEndsAt, midnight.getTime());
  const endOfDay = new Date(midnight.getTime() - 1).toISOString();
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: member, at: endOfDay })).status, 200, 'public check-in stays open until midnight');
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: member, at: midnight.toISOString() })).status, 403, 'public check-in closes at next midnight');

  // Member check-in
  const wrongName = await call('/api/club-night/checkins', { method: 'POST', body: { ...member, firstName: 'Kasey' }, at: tonight });
  assert.equal(wrongName.data.needsDetails, true, 'name must match too');
  const checkedIn = await call('/api/club-night/checkins', { method: 'POST', body: member, at: tonight });
  assert.equal(checkedIn.status, 200);
  assert.match(checkedIn.data.message, /Enjoy Club night/);

  // Guest check-in
  const unknown = await call('/api/club-night/checkins', { method: 'POST', body: guest, at: tonight });
  assert.equal(unknown.data.needsDetails, true);
  const details = { phone: '0700 000003', address: '3 Shore', postcode: 'EH3 3CC', swimming: 'basic', disclaimerAccepted: true, photoConsent: false,
    emergencyContact: { name: 'Sky Guest', relationship: 'Sibling', phone: '0700 000004' } };
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: { ...guest, details: { ...details, emergencyContact: {} } }, at: tonight })).status, 400);
  const guestIn = await call('/api/club-night/checkins', { method: 'POST', body: { ...guest, details }, at: tonight });
  assert.equal(guestIn.status, 200);
  assert.match(guestIn.data.message, /see the volunteer/);
  const guestRecord = (await db.collection('memberships').where('searchName', '==', 'gale guest').get()).docs[0];
  assert.equal(guestRecord.id, 'M0003', 'guest gets a permanent member ID');
  assert.equal(guestRecord.data().contactOnly, true);
  assert.match(guestRecord.data().householdId, /^H\d{5,}$/);
  assert.equal(guestRecord.data().swimming, 'basic');
  assert.equal(guestRecord.data().email, undefined, 'contact details live on the household');
  const guestHousehold = (await db.collection('households').doc(guestRecord.data().householdId).get()).data();
  assert.equal(guestHousehold.email, guest.email);
  assert.equal(guestHousehold.emergencyContact.name, 'Sky Guest');

  // Volunteer access
  const before = sent.length;
  assert.equal((await call('/api/email-codes', { method: 'POST', body: { email: 'stranger@example.test', purpose: 'volunteer' } })).status, 200);
  assert.equal(sent.length, before, 'no code for non-volunteers, same reply');
  assert.equal((await call('/api/email-codes', { method: 'POST', body: { email: volunteer, purpose: 'email-change' } })).status, 400, 'internal purposes cannot be requested');
  assert.equal((await call('/api/email-codes', { method: 'POST', body: { email: volunteer, purpose: 'volunteer' } })).status, 200);
  const volunteerCode = lastCode(volunteer);
  assert.equal((await call('/api/email-codes', { method: 'POST', body: { email: volunteer, purpose: 'volunteer' } })).status, 200);
  assert.equal(lastCode(volunteer), volunteerCode, 'resend is throttled');
  const wrong = String((Number(volunteerCode) + 1) % 1000000).padStart(6, '0');
  assert.equal((await call('/api/email-codes/verify', { method: 'POST', body: { email: volunteer, purpose: 'volunteer', code: wrong } })).status, 400);
  const verified = await call('/api/email-codes/verify', { method: 'POST', body: { email: volunteer, purpose: 'volunteer', code: volunteerCode } });
  assert.equal(verified.status, 200);
  assert.equal((await call('/api/email-codes/verify', { method: 'POST', body: { email: volunteer, purpose: 'volunteer', code: volunteerCode } })).status, 400, 'codes are single use');
  const volunteerSession = verified.data.token;
  assert.equal((await call('/api/club-night/checkins', { at: tonight })).status, 401);
  const list = await call('/api/club-night/checkins', { at: tonight, session: volunteerSession });
  assert.equal(list.status, 200);
  assert.ok(Number.isFinite(list.data.accessEndsAt));
  assert.equal(list.data.accessEndsAt, Math.min(verified.data.expiresAt, midnight.getTime()));
  assert.equal((await call('/api/club-night/checkins', { at: endOfDay, session: volunteerSession })).status, 200, 'volunteer access lasts until midnight');
  assert.equal(list.data.checkins.length, 2);
  const casey = list.data.checkins.find((entry) => entry.name === 'Casey Member');
  assert.deepEqual([casey.membershipActive, casey.hasBoatHire, casey.previouslyAttended], [true, true, false]);
  const gale = list.data.checkins.find((entry) => entry.name === 'Gale Guest');
  assert.deepEqual([gale.membershipActive, gale.memberStatus, gale.needsBoatHire], [false, 'No', false]);
  assert.equal(gale.nonMemberVisits.label, '1 of 3 this club year', 'non-members see their visits this club year');
  assert.equal(casey.nonMemberVisits, undefined, 'members have no visit count');
  assert.equal(casey.selfAssessment, undefined, 'self-assessment is only shown on sessions that use it');
  assert.equal(JSON.stringify(list.data).includes('Robin'), false, 'emergency contacts are not in the list');
  assert.equal((await call('/api/club-night/checkins', { at: afterHours, session: volunteerSession })).status, 200, 'volunteers retain access after the session');
  assert.equal((await call('/api/club-night/checkins', { at: `${year}-03-12T00:00:00Z`, session: volunteerSession })).status, 200, 'volunteers have access before the session');
  assert.equal((await call('/api/club-night/checkins', { at: midnight.toISOString(), session: volunteerSession })).status, 403, 'volunteer access closes at next midnight');
  const contact = await call(`/api/club-night/checkins/${casey.id}/emergency-contact`, { method: 'POST', at: afterHours, session: volunteerSession });
  assert.deepEqual(contact.data.contact, { name: 'Robin Member', relationship: 'Partner', phone: '0700 000002' });
  const log = (await db.collection('clubNightAccessLog').get()).docs.map((document) => document.data());
  assert.deepEqual([log.length, log[0].memberId, log[0].volunteerEmail], [1, 'M0001', volunteer]);
  assert.equal((await call(`/api/club-night/checkins/${casey.id}/emergency-contact`, { method: 'POST', at: midnight.toISOString(), session: volunteerSession })).status, 403, 'emergency contact is unavailable after midnight');

  // Signed-in admins use their admin session instead of a volunteer email code, still only on the day
  const adminList = await call('/api/club-night/checkins', { at: tonight, admin: true });
  assert.equal((await db.collection('lists').where('email', '==', 'admin@forthcanoeclub.co.uk').get()).empty, true,
    'admin access does not require volunteer registration');
  for (const session of [null, volunteerSession]) {
    for (const path of ['/api/club-night/checkins', `/api/club-night/checkins/${casey.id}/emergency-contact`]) {
      const denied = await fetch(`${base}${path}`, {
        method: path.endsWith('/emergency-contact') ? 'POST' : 'GET',
        headers: {
          Authorization: 'Bearer invalid-admin',
          'X-Test-Now': tonight,
          ...(session ? { 'X-Email-Session': session } : {})
        }
      });
      assert.equal(denied.status, 401, 'invalid admin tokens are rejected, without falling back to volunteer access');
    }
  }
  assert.deepEqual([adminList.status, adminList.data.checkins.length, adminList.data.volunteer, adminList.data.accessEndsAt],
    [200, 2, 'admin@forthcanoeclub.co.uk', midnight.getTime()]);
  assert.equal((await call('/api/club-night/checkins', { at: midnight.toISOString(), admin: true })).status, 403, 'admin access also closes at midnight');
  assert.equal((await call(`/api/club-night/checkins/${casey.id}/emergency-contact`, {
    method: 'POST', at: midnight.toISOString(), admin: true
  })).status, 403, 'admin emergency-contact access also closes at midnight');
  assert.equal((await call(`/api/club-night/checkins/${casey.id}/emergency-contact`, { method: 'POST', at: tonight, admin: true })).status, 200);
  const adminLog = (await db.collection('clubNightAccessLog').where('volunteerEmail', '==', 'admin@forthcanoeclub.co.uk').get()).docs.map((document) => document.data());
  assert.deepEqual([adminLog.length, adminLog[0].viaAdmin], [1, true], 'admin emergency-contact views are logged');
  assert.equal((await call(`/api/club-night/checkins/${casey.id}/emergency-contact`, { method: 'POST', at: nextWeek, session: volunteerSession })).status, 404, 'last week is not available');

  // Next week: guests are recognised; earlier weeks are hidden
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: guest, at: nextWeek })).data.success, true);
  await call('/api/club-night/checkins', { method: 'POST', body: member, at: nextWeek });
  const week2 = await call('/api/club-night/checkins', { at: nextWeek, session: volunteerSession });
  assert.equal(week2.data.checkins.length, 2);
  assert.ok(week2.data.checkins.every((entry) => entry.previouslyAttended));
  assert.equal(week2.data.checkins.find((entry) => entry.name === 'Gale Guest').nonMemberVisits.label, '2 of 3 this club year');
  assert.equal((await db.collection('memberships').where('searchName', '==', 'gale guest').get()).size, 1, 'no duplicate guest record');
  assert.equal((await call('/api/my-details', { session: volunteerSession })).status, 401, 'sessions are purpose-bound');

  // Several sessions on one day, each with its own checks
  const week3 = new Date(clubNight.getTime() + 14 * 86400000).toISOString();
  const twoSessions = { sessions: [...clubNightOnly.sessions, { name: 'Gold sub session', weekday, start: '19:00', end: '20:00', subscriptions: true, selfAssessment: true }] };
  const savedSessions = await call('/api/admin/club-night', { method: 'PUT', admin: true, body: twoSessions });
  assert.deepEqual([savedSessions.data.sessions[1].subscriptions, savedSessions.data.sessions[1].selfAssessment], [true, true]);
  assert.deepEqual((await call('/api/club-night', { at: week3 })).data.sessions.map((entry) => entry.id), ['club-night', 'gold-sub-session']);
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: member, at: week3 })).status, 400, 'attendees choose a session when there are several');
  const noSub = await call('/api/club-night/checkins', { method: 'POST', body: { ...member, sessionId: 'gold-sub-session' }, at: week3 });
  assert.match(noSub.data.message, /see the volunteer/, 'no Gold subscription');
  await db.collection('membershipTerms').doc(`M0001_${year}`).update({ items: [{ productId: 'boat-hire' }, { productId: 'gold-sub' }] });
  const withSub = await call('/api/club-night/checkins', { method: 'POST', body: { ...member, sessionId: 'gold-sub-session' }, at: week3 });
  assert.match(withSub.data.message, /Enjoy Gold sub session/);
  const goldList = await call('/api/club-night/checkins?sessionId=gold-sub-session', { at: week3, session: volunteerSession });
  assert.deepEqual(goldList.data.session, { id: 'gold-sub-session', name: 'Gold sub session', boatHire: false, subscriptions: true, selfAssessment: true });
  assert.deepEqual(goldList.data.checkins.map((entry) => [entry.name, entry.subscription, entry.memberStatus]), [['Casey Member', 'Gold subscription', 'Active']]);
  const firstList = await call('/api/club-night/checkins', { at: week3, session: volunteerSession });
  assert.deepEqual([firstList.data.session.id, firstList.data.checkins.length, firstList.data.sessions.length], ['club-night', 0, 2], 'sessions keep separate lists');

  // Self-assessment: ticked by a volunteer, kept on the person, unticked only with a note
  const caseyGold = goldList.data.checkins[0];
  assert.deepEqual(caseyGold.selfAssessment, { passed: false, updatedAt: 0, note: '' });
  const assess = (id, body, options = {}) => call(`/api/club-night/checkins/${id}/self-assessment`, { method: 'POST', at: week3, session: volunteerSession, body, ...options });
  assert.equal((await assess(caseyGold.id, { passed: true }, { session: null })).status, 401);
  assert.equal((await assess(caseyGold.id, { passed: 'yes' })).status, 400);
  assert.equal((await assess(caseyGold.id, { passed: true })).status, 200);
  assert.equal((await db.collection('memberships').doc('M0001').get()).data().selfAssessment.passed, true);
  assert.equal((await assess(caseyGold.id, { passed: false })).status, 400, 'unticking needs a note');
  const unticked = await assess(caseyGold.id, { passed: false, note: 'Needs a capsize refresher' }, { admin: true, session: null });
  assert.deepEqual([unticked.status, unticked.data.selfAssessment.passed, unticked.data.selfAssessment.note], [200, false, 'Needs a capsize refresher']);
  assert.equal((await assess(caseyGold.id, { passed: true })).status, 200);
  const assessmentLog = (await db.collection('selfAssessmentLog').orderBy('at').get()).docs.map((document) => document.data());
  assert.deepEqual(assessmentLog.map((entry) => [entry.memberId, entry.passed, entry.updatedBy]),
    [['M0001', true, volunteer], ['M0001', false, 'admin@forthcanoeclub.co.uk'], ['M0001', true, volunteer]]);
  assert.equal((await assess(caseyGold.id, { passed: true }, { at: nextWeek })).status, 404, 'only today\'s check-ins');
  const nextGold = new Date(clubNight.getTime() + 21 * 86400000).toISOString();
  await call('/api/club-night/checkins', { method: 'POST', body: { ...member, sessionId: 'gold-sub-session' }, at: nextGold });
  assert.equal((await call('/api/club-night/checkins?sessionId=gold-sub-session', { at: nextGold, admin: true })).data.checkins[0].selfAssessment.passed, true,
    'the tick carries forward to later sessions');
  await call('/api/club-night/checkins', { method: 'POST', body: { ...member, sessionId: 'club-night' }, at: nextGold });
  const caseyClubNight = (await call('/api/club-night/checkins?sessionId=club-night', { at: nextGold, admin: true })).data.checkins[0];
  assert.equal((await assess(caseyClubNight.id, { passed: true }, { at: nextGold })).status, 400, 'sessions without the checklist cannot change it');
  assert.equal((await call('/api/admin/club-night', { method: 'PUT', admin: true, body: clubNightOnly })).status, 200);

  const recurringSessions = { sessions: [{ name: 'Course practice', recurrence: {
    frequency: 'weekly', startDate: `${year}-03-12`, endDate: `${year}-03-26`
  }, start: '18:00', end: '20:00' }] };
  const recurringSaved = await call('/api/admin/club-night', { method: 'PUT', admin: true, body: recurringSessions });
  assert.deepEqual(recurringSaved.data.sessions[0].recurrence, recurringSessions.sessions[0].recurrence);
  assert.deepEqual((await call('/api/club-night', { at: `${year}-03-12T12:00:00Z` })).data.sessions.map((entry) => entry.id), ['course-practice']);
  assert.equal((await call('/api/club-night', { at: `${year}-03-13T12:00:00Z` })).data.open, false, 'weekly repeats do not open on intervening days');
  assert.deepEqual((await call('/api/club-night', { at: `${year}-03-19T12:00:00Z` })).data.sessions.map((entry) => entry.id), ['course-practice']);
  assert.equal((await call('/api/club-night', { at: `${year}-03-27T12:00:00Z` })).data.open, false, 'recurrence stops after the inclusive end date');
  assert.equal((await call('/api/admin/club-night', { method: 'PUT', admin: true, body: clubNightOnly })).status, 200);

  // Purchased events are not check-in sessions; leaders and named viewers see their attendee lists instead
  const leader = 'leader@example.test';
  const helper = 'helper@example.test';
  eventProducts.push({ id: 'P00001', name: 'Taster day', category: 'EVENTS', active: true, membershipRequired: false, leaderEmail: leader,
    eventSchedule: { mode: 'consecutive', startDate: `${year}-03-27`, days: 2, startTime: '10:00', endTime: '16:00', timeZone: 'Europe/London' } });
  assert.equal((await call('/api/club-night', { at: `${year}-03-27T12:00:00Z` })).data.open, false, 'events do not open check-in');
  await db.collection('orders').doc('FCC-TASTER').set({ schemaVersion: 2, email: guest.email, status: 'paid', totalPence: 2000,
    items: [{ id: 'P00001', lineId: 'taster', name: 'Taster day', category: 'EVENTS', pricePence: 2000 }],
    people: [{ membershipId: guestRecord.id, householdId: guestRecord.data().householdId, lineIds: ['taster'] }], membershipIds: [guestRecord.id],
    createdAt: Timestamp.fromDate(new Date(`${year}-03-13T12:00Z`)) });
  const beforeEvent = `${year}-03-20T12:00:00Z`;
  const lastDay = `${year}-03-28T12:00:00Z`;
  const afterEvent = `${year}-03-29T12:00:00Z`;
  const unauthorised = sent.length;
  assert.equal((await call('/api/email-codes', { method: 'POST', body: { email: helper, purpose: 'volunteer' }, at: beforeEvent })).status, 200);
  assert.equal(sent.length, unauthorised, 'no code before an admin names them');
  assert.equal((await call('/api/admin/events/P00001/roster-viewers', { method: 'PUT', admin: true, body: { viewers: ['bad'] } })).status, 400);
  assert.equal((await call('/api/admin/events/P00001/roster-viewers', { method: 'PUT', body: { viewers: [helper] } })).status, 401);
  assert.deepEqual((await call('/api/admin/events/P00001/roster-viewers', { method: 'PUT', admin: true, body: { viewers: [' Helper@Example.test '] } })).data.viewers, [helper]);
  assert.deepEqual((await call('/api/admin/events/P00001/roster-viewers', { admin: true })).data.viewers, [helper]);
  const leaderSession = await signIn(leader, 'volunteer', undefined, beforeEvent);
  const helperSession = await signIn(helper, 'volunteer', undefined, beforeEvent);
  assert.equal((await call('/api/club-night/checkins', { at: nextGold, session: leaderSession })).status, 403, 'event leaders do not see club-night check-ins');
  assert.equal((await call('/api/event-rosters', { at: beforeEvent })).status, 401);
  for (const session of [leaderSession, helperSession]) {
    assert.deepEqual((await call('/api/event-rosters', { at: beforeEvent, session })).data.events.map((entry) => entry.id), ['P00001']);
    const roster = await call('/api/event-rosters/P00001', { at: lastDay, session });
    assert.equal(roster.status, 200);
    assert.deepEqual(roster.data.attendees.map((row) => [row.name, row.membership, row.nonMemberVisits, row.emergencyContact]),
      [['Gale Guest', 'No', '3 of 3 this club year', 'Sky Guest, Sibling, 0700 000004']], 'two check-ins plus the event');
    assert.equal(roster.data.attendees[0].firstClubNight, false, 'Gale has checked in at club night before');
    assert.equal(JSON.stringify(roster.data).includes(guest.email), false, 'the on-screen list leaves out contact details');
    assert.deepEqual((await call('/api/event-rosters', { at: afterEvent, session })).data.events, [], 'closed after the last day');
    assert.equal((await call('/api/event-rosters/P00001', { at: afterEvent, session })).status, 404);
  }
  assert.equal((await call('/api/event-rosters/P00001', { at: beforeEvent, session: volunteerSession })).status, 404, 'other volunteers cannot see it');
  assert.equal((await call('/api/event-rosters/P00001', { at: afterEvent, admin: true })).status, 200, 'admins can view at any time');
  const views = (await db.collection('eventRosterAccessLog').get()).docs.map((document) => document.data());
  assert.deepEqual([...new Set(views.map((entry) => entry.email))].sort(), ['admin@forthcanoeclub.co.uk', helper, leader]);
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: { ...guest, sessionId: 'club-night' }, at: nextGold })).status, 200);
  const overLimit = (await call('/api/club-night/checkins?sessionId=club-night', { at: nextGold, admin: true })).data.checkins.find((entry) => entry.name === 'Gale Guest');
  assert.deepEqual(overLimit.nonMemberVisits, { count: 4, overLimit: true, label: '4 of 3 this club year – membership needed' }, 'volunteers are warned, check-in is not blocked');
  eventProducts.length = 0;

  // My details
  const sentBefore = sent.length;
  const mismatch = await call('/api/email-codes', { method: 'POST', body: { email: member.email, purpose: 'details', dob: '1999-09-09' } });
  assert.equal(mismatch.status, 404);
  assert.match(mismatch.data.error, /do not match a membership or purchase record/);
  assert.equal((await call('/api/email-codes', { method: 'POST', body: { email: 'nobody@example.test', purpose: 'details', dob: member.dob } })).status, 404);
  assert.equal(sent.length, sentBefore, 'a date of birth outside the household sends no code');
  const lastYear = Timestamp.fromDate(new Date(clubYearDates(year - 1).start.getTime() + 86400000));
  await db.collection('orders').doc('FCC-OLD').set({ schemaVersion: 2, email: member.email, status: 'paid', totalPence: 1000, items: [{ name: 'Old item', pricePence: 1000 }], people: [], createdAt: lastYear });
  await db.collection('orders').doc('FCC-NOW').set({ schemaVersion: 2, email: member.email, status: 'paid', totalPence: 4500,
    items: [{ lineId: 'now', name: 'Adult membership', category: 'MEMBERSHIP', pricePence: 4500 }],
    people: [{ membershipId: 'M0001', householdId: 'HH-MEMBER', lineIds: ['now'] }], membershipIds: ['M0001'], createdAt: Timestamp.fromDate(new Date(`${year}-03-05T12:00Z`)) });
  await db.collection('orders').doc('FCC-OPEN').set({ schemaVersion: 2, email: member.email, status: 'pending', totalPence: 500, items: [], people: [], createdAt: Timestamp.fromDate(new Date(`${year}-03-06T12:00Z`)) });
  const detailsSession = await signIn(member.email, 'details', member.dob);
  const mine = await call('/api/my-details', { session: detailsSession });
  assert.equal(mine.data.households.length, 1);
  assert.equal(mine.data.households[0].people[0].membership, 'Active member');
  assert.deepEqual(mine.data.purchases.map((order) => order.orderRef), ['FCC-NOW'], 'only paid orders since renewals opened');
  assert.deepEqual(mine.data.purchases[0].items[0].personNames, ['Casey Member'], 'order people resolve from the member record');
  assert.equal(mine.data.purchases[0].items[0].price, 45);
  for (const detail of ['0700 000001', member.dob]) assert.equal(JSON.stringify(mine.data.purchases).includes(detail), false, 'receipts hold no personal details');
  const update = { phone: '0700 999999', address: '9 New Street', postcode: 'EH9 9ZZ', emergencyContact: { name: 'Robin Member', relationship: 'Partner', phone: '0700 888888' } };
  const saved = await call('/api/my-details/HH-MEMBER', { method: 'PATCH', session: detailsSession, body: update });
  assert.deepEqual(saved.data.changed.sort(), ['address', 'emergencyContact', 'phone', 'postcode']);
  assert.equal((await db.collection('households').doc('HH-MEMBER').get()).data().phone, '0700 999999');
  assert.equal((await db.collection('selfServiceChanges').get()).size, 1);
  assert.equal((await call('/api/my-details/HH-JUSTGO', { method: 'PATCH', session: detailsSession, body: update })).status, 404, 'other households are not reachable');
  const justgoSession = await signIn('jo@example.test', 'details', '1970-01-01');
  assert.equal((await call('/api/my-details', { session: justgoSession })).data.households[0].justgo, true);
  assert.equal((await call('/api/my-details/HH-JUSTGO', { method: 'PATCH', session: justgoSession, body: update })).status, 409);

  const newEmail = 'casey.new@example.test';
  assert.equal((await call('/api/my-details/HH-MEMBER/email', { method: 'POST', session: detailsSession, body: { newEmail } })).status, 200);
  assert.equal((await call('/api/my-details/HH-MEMBER/email/confirm', { method: 'POST', session: detailsSession, body: { newEmail, code: '000000' === lastCode(newEmail) ? '000001' : '000000' } })).status, 400);
  const changed = await call('/api/my-details/HH-MEMBER/email/confirm', { method: 'POST', session: detailsSession, body: { newEmail, code: lastCode(newEmail) } });
  assert.equal(changed.status, 200);
  assert.equal((await db.collection('households').doc('HH-MEMBER').get()).data().email, newEmail);
  assert.ok(sent.some((message) => message.to === member.email && message.record.kind === 'email-changed'), 'old address is told');
  assert.equal((await call('/api/my-details', { session: detailsSession })).data.households.length, 0, 'old email no longer reaches the household');
  assert.equal((await call('/api/club-night/checkins', { method: 'POST', body: { ...member, email: newEmail }, at: nextWeek })).data.success, true, 'check-in uses the new email');

  // GDPR erasure removes club-night and email-code records
  const guestId = guestRecord.id;
  await signIn(guest.email, 'details', guest.dob);
  assert.ok((await db.collection('clubNightCheckins').where('memberId', '==', guestId).get()).size >= 2);
  const erased = await call('/api/admin/gdpr/erase', { method: 'POST', admin: true, body: { ...guest, scope: 'person', confirm: 'ERASE', reason: 'Guest asked to be forgotten' } });
  assert.equal(erased.status, 200, JSON.stringify(erased.data));
  assert.equal((await db.collection('clubNightCheckins').where('memberId', '==', guestId).get()).size, 0, 'check-ins erased');
  assert.equal((await db.collection('emailSessions').where('email', '==', guest.email).get()).size, 0, 'email sessions erased');
  assert.equal((await db.collection('memberships').doc(guestId).get()).exists, false);
  const memberId = (await db.collection('memberships').where('householdId', '==', 'HH-MEMBER').get()).docs[0].id;
  assert.ok((await db.collection('clubNightAccessLog').where('memberId', '==', memberId).get()).size >= 1);
  const memberErased = await call('/api/admin/gdpr/erase', { method: 'POST', admin: true, body: { ...member, email: newEmail, scope: 'person', confirm: 'ERASE', reason: 'Member asked to be forgotten' } });
  assert.equal(memberErased.status, 200, JSON.stringify(memberErased.data));
  assert.equal((await db.collection('clubNightAccessLog').where('memberId', '==', memberId).get()).size, 0, 'emergency-contact access log erased');
  assert.equal((await db.collection('selfAssessmentLog').where('memberId', '==', memberId).get()).size, 0, 'self-assessment log erased');
  assert.equal((await db.collection('selfServiceChanges').where('householdId', '==', 'HH-MEMBER').get()).size, 0, 'self-service log erased');

  const reservations = await Promise.all(Array.from({ length: 4 }, () => allocateRecordIds(db, 'households', 3)));
  const ids = reservations.flat();
  assert.equal(new Set(ids).size, 12, 'concurrent reservations never reuse household IDs');
  assert.ok(ids.every((id) => /^H\d{5,}$/.test(id)));
  console.log('PASS: club-night full-day access and midnight cut-off, event attendee lists for leaders and named viewers, non-member visit counts, self-assessment ticks, member and guest check-in, contact-only guest records, volunteer email codes, today-only attendance, audited emergency contacts, purpose-bound sessions, self-service details and current receipts with confirmed email change, GDPR erasure and concurrent short household IDs.');
} finally {
  await clear();
  await new Promise((resolve) => server.close(resolve));
  await db.terminate();
}
