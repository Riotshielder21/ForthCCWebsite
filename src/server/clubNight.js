import crypto from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './rateLimit.js';
import { currentCheckoutPolicies } from './policies.js';
import { clubYearOf, holdsForClubYear } from '../utils/clubYear.js';
import { membershipStatus } from '../utils/adminReports.js';
import { readJustgoSync } from './justgoSync.js';
import { householdForPerson, memberIsJunior, HOUSEHOLD_MEMBER_FIELDS } from '../utils/households.js';
import { allocateMemberIds } from '../utils/memberIds.js';
import { allocateRecordIds } from '../utils/recordIds.js';
import { normaliseName } from '../utils/checkout.js';
import { VOLUNTEER_LIST } from '../utils/lists.js';
import { CURRENT_MEMBERSHIP_VERSION } from '../utils/schema.js';
import { clubNightStatus, clubNightDescription, sessionDescription, validateCheckinSessions, validateCheckinIdentity, validateGuestDetails, matchingCheckinRecords } from '../utils/clubNight.js';

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ID = /^[A-Za-z0-9_-]{1,160}$/;

/**
 * Weekly check-in sessions (club night, subscriber sessions…). Attendees give name, date of birth and email; non-members give membership-style details once
 * and are kept as contact-only records. Active volunteers sign in with an email code and only see that day's check-ins
 * on the scheduled day (London time). Emergency contacts are shown one person at a time, on request, and each view is logged.
 */
export const registerClubNightRoutes = (app, { requireAdmin, db, emailCodes, requestNow = () => new Date(), live = () => false, loadCatalogue = async () => [] }) => {
  const settingsReference = () => db().collection('settings').doc('clubNight');
  const checkins = () => db().collection('clubNightCheckins');
  const status = async (req) => clubNightStatus((await settingsReference().get()).data(), requestNow(req));
  const closedMessage = (current) => current.configured
    ? `There is no check-in session today. Check-in is open all day on session days (UK time): ${current.sessions.map((session) => `${session.name}, ${sessionDescription(session)}`).join('; ')}.`
    : 'Check-in has not been scheduled yet.';
  /** The requested session if it is on today; with no request, today's only session (or the first, if `firstByDefault`). */
  const sessionFor = (current, requested, firstByDefault = false) => requested
    ? current.openSessions.find((session) => session.id === requested) || null
    : current.openSessions.length === 1 || firstByDefault ? current.openSessions[0] : null;
  const briefSessions = (current) => current.openSessions.map(({ id, name, start, end }) => ({ id, name, start, end }));
  const subscriptionProducts = async () => (await loadCatalogue()).filter((product) => product.category === 'SUBSCRIPTIONS')
    .map((product) => ({ id: product.id, name: product.name || product.id }));

  const isActiveVolunteer = async (email, req) => {
    const year = clubYearOf(requestNow(req));
    const signups = await db().collection('lists').where('email', '==', email).limit(20).get();
    return signups.docs.some((document) => {
      const signup = document.data();
      const signupYear = Number.isInteger(signup.clubYear) ? signup.clubYear : clubYearOf(signup.createdAt?.toDate() || new Date());
      return signup.listType === VOLUNTEER_LIST && signup.inducted === true && signup.active === true && signupYear === year;
    });
  };
  emailCodes.allowPurpose('volunteer', isActiveVolunteer);

  /** Approved admins use their existing sign-in; volunteers use an email code. Both are limited to today. */
  const requireVolunteerToday = async (req, res) => {
    let email, expiresAt = Infinity, admin = false;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      const decoded = await requireAdmin(req, res);
      if (!decoded) return null;
      ({ email } = decoded);
      admin = true;
    } else {
      const session = await emailCodes.requireEmailSession(req, res, 'volunteer');
      if (!session) return null;
      if (!await isActiveVolunteer(session.email, req)) {
        res.status(403).json({ error: 'Club-night check-in is available to inducted, active volunteers for this club year.' });
        return null;
      }
      ({ email, expiresAt } = session);
    }
    const current = await status(req);
    if (!current.open) {
      res.status(403).json({ error: `${closedMessage(current)} Previous weeks are not shown.`, closed: true });
      return null;
    }
    return { email, admin, current, date: current.date, accessEndsAt: Math.min(expiresAt, current.dayEndsAt) };
  };

  const candidatesFor = async (email) => {
    const memberships = db().collection('memberships');
    const [byEmail, byGuardianEmail, households] = await Promise.all([
      memberships.where('email', '==', email).limit(50).get(),
      memberships.where('guardian.email', '==', email).limit(50).get(),
      db().collection('households').where('email', '==', email).limit(20).get()
    ]);
    const householdMembers = (await Promise.all(households.docs.map((household) =>
      memberships.where('householdId', '==', household.id).limit(50).get()))).flatMap((snapshot) => snapshot.docs);
    return [...new Map([...byEmail.docs, ...byGuardianEmail.docs, ...householdMembers].map((document) => [document.id, document])).values()];
  };

  const createGuest = async (person, now) => {
    const at = Timestamp.fromDate(now);
    const [householdId] = await allocateRecordIds(db(), 'households');
    const [memberId] = await allocateMemberIds(db(), 1);
    const policies = await currentCheckoutPolicies(db(), live());
    const { id: _householdKey, ...household } = householdForPerson(person, householdId, at);
    const { id: _id, lineIds: _lines, ownKitLineIds: _kit, returning: _returning, photoConsent, disclaimerAccepted: _accepted, ...details } = person;
    for (const key of HOUSEHOLD_MEMBER_FIELDS) delete details[key];
    const by = person.junior ? 'guardian' : 'self';
    const batch = db().batch();
    batch.set(db().collection('households').doc(householdId), household);
    batch.set(db().collection('memberships').doc(memberId), {
      ...details, householdId, contactOnly: true, source: 'club-night', createdAt: at, updatedAt: at,
      searchName: normaliseName(`${person.firstName} ${person.lastName}`), schemaVersion: CURRENT_MEMBERSHIP_VERSION,
      consents: { disclaimer: { ...policies.disclaimer, acceptedAt: at, by }, photoVideo: { ...policies.photoVideo, accepted: photoConsent === true, recordedAt: at, by } }
    });
    await batch.commit();
    return (await db().collection('memberships').doc(memberId).get());
  };

  app.get('/api/club-night', rateLimit(60, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Club-night check-in is not available right now.' });
      const current = await status(req);
      res.set('Cache-Control', 'no-store');
      res.json({ configured: current.configured, open: current.open, date: current.date, dayEndsAt: current.dayEndsAt, schedule: clubNightDescription(current),
        sessions: current.open ? briefSessions(current) : [], message: current.open ? '' : closedMessage(current) });
    } catch (error) {
      console.error('Could not load club-night status:', error.message);
      res.status(500).json({ error: 'Could not load club-night check-in.' });
    }
  });

  app.get('/api/admin/club-night', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Club-night settings are not available.' });
      const current = clubNightStatus((await settingsReference().get()).data(), requestNow(req));
      res.json({ sessions: current.sessions || [], subscriptionProducts: await subscriptionProducts() });
    } catch (error) {
      console.error('Could not load club-night settings:', error.message);
      res.status(500).json({ error: 'Could not load club-night settings.' });
    }
  });

  app.put('/api/admin/club-night', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Club-night settings are not available.' });
      const { error, value } = validateCheckinSessions(req.body);
      if (error) return res.status(400).json({ error });
      const products = new Map((await subscriptionProducts()).map((product) => [product.id, product]));
      const unknown = value.flatMap((session) => session.subscriptions).find((subscription) => !products.has(subscription.id));
      if (unknown) return res.status(400).json({ error: `${unknown.name} is not a subscription in the shop.` });
      const sessions = value.map((session) => ({ ...session, subscriptions: session.subscriptions.map((subscription) => products.get(subscription.id)) }));
      await settingsReference().set({ sessions, updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid });
      res.json({ success: true, sessions });
    } catch (error) {
      console.error('Could not save club-night settings:', error.message);
      res.status(500).json({ error: 'Could not save club-night settings.' });
    }
  });

  app.post('/api/club-night/checkins', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Club-night check-in is not available right now.' });
      res.set('Cache-Control', 'no-store');
      const now = requestNow(req);
      const current = await status(req);
      if (!current.open) return res.status(403).json({ error: closedMessage(current), closed: true });
      const session = sessionFor(current, typeof req.body?.sessionId === 'string' ? req.body.sessionId : '');
      if (!session) return res.status(400).json({ error: 'Choose which session you are checking in to.', sessions: briefSessions(current) });
      const { error, value: identity } = validateCheckinIdentity(req.body, now);
      if (error) return res.status(400).json({ error });
      let matches = matchingCheckinRecords((await candidatesFor(identity.email)).map((document) => ({ ...document.data(), document })), identity)
        .map((record) => record.document);
      if (!matches.length) {
        if (!req.body?.details) {
          return res.json({ needsDetails: true, message: 'We could not find you with those details. If you are new, add your details below. You do not need to become a member to come along.' });
        }
        const guest = validateGuestDetails(identity, req.body.details, now);
        if (guest.error) return res.status(400).json({ error: guest.error });
        matches = [await createGuest(guest.value, now)];
      }
      const memberDocument = matches.length === 1 ? matches[0] : null;
      const member = memberDocument?.data();
      const memberStatus = member ? membershipStatus(member, now, await readJustgoSync(db(), now)) : matches.length > 1 ? 'Needs review' : 'No';
      const membershipActive = memberStatus.startsWith('Active');
      const clubYear = clubYearOf(now);
      const hasBoatHire = Boolean(member && holdsForClubYear(member, 'boat-hire', clubYear));
      const subscription = session.subscriptions.length
        ? session.subscriptions.find((product) => member && holdsForClubYear(member, product.id, clubYear))?.name || 'No' : null;
      const attendeeId = memberDocument ? memberDocument.id : `review-${sha(`${identity.email}|${identity.dob}`)}`;
      const reference = checkins().doc(`${current.date}-${session.id}-${sha(attendeeId).slice(0, 32)}`);
      const previous = memberDocument
        ? await checkins().where('memberId', '==', memberDocument.id).where('sessionId', '==', session.id).limit(1).get() : null;
      const latest = { subscription, memberStatus, membershipActive, hasBoatHire, needsBoatHire: membershipActive && !hasBoatHire };
      await db().runTransaction(async (transaction) => {
        // Checking in again (e.g. after paying at the card reader) refreshes the status but keeps the first check-in time.
        if ((await transaction.get(reference)).exists) return transaction.update(reference, latest);
        transaction.create(reference, {
          date: current.date, sessionId: session.id, sessionName: session.name, attendeeId, name: `${identity.firstName} ${identity.lastName}`,
          ...(memberDocument ? { memberId: memberDocument.id } : {}), ...latest, junior: Boolean(member && memberIsJunior(member, now)),
          previouslyAttended: Boolean(previous?.size), checkedInAt: Timestamp.fromDate(now)
        });
      });
      res.json({ success: true, session: session.name, message: membershipActive && subscription !== 'No'
        ? `You are checked in. Enjoy ${session.name}!`
        : 'You are checked in. Please see the volunteer before getting on the water.' });
    } catch (error) {
      console.error('Could not record club-night check-in:', error.message);
      res.status(500).json({ error: 'Could not record your check-in. Please ask the club-night volunteer for help.' });
    }
  });

  app.get('/api/club-night/checkins', rateLimit(60, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Club-night check-in is not available right now.' });
      const volunteer = await requireVolunteerToday(req, res);
      if (!volunteer) return;
      const session = sessionFor(volunteer.current, typeof req.query.sessionId === 'string' ? req.query.sessionId : '', true);
      if (!session) return res.status(404).json({ error: 'That session is not on today.', sessions: briefSessions(volunteer.current) });
      const snapshot = await checkins().where('date', '==', volunteer.date).where('sessionId', '==', session.id).limit(500).get();
      const list = snapshot.docs.map((document) => {
        const data = document.data();
        return { id: document.id, name: data.name || '', memberStatus: data.memberStatus, membershipActive: data.membershipActive === true,
          hasBoatHire: data.hasBoatHire === true, needsBoatHire: data.needsBoatHire === true, previouslyAttended: data.previouslyAttended === true,
          junior: data.junior === true, subscription: typeof data.subscription === 'string' ? data.subscription : null, canShowEmergencyContact: Boolean(data.memberId), checkedInAt: data.checkedInAt?.toMillis() || 0 };
      }).sort((left, right) => right.checkedInAt - left.checkedInAt);
      res.set('Cache-Control', 'no-store');
      res.json({ date: volunteer.date, checkins: list, volunteer: volunteer.email, accessEndsAt: volunteer.accessEndsAt, sessions: briefSessions(volunteer.current),
        session: { id: session.id, name: session.name, boatHire: session.boatHire, subscriptions: session.subscriptions.map((product) => product.name) } });
    } catch (error) {
      console.error('Could not load club-night check-ins:', error.message);
      res.status(500).json({ error: 'Could not load club-night check-ins.' });
    }
  });

  app.post('/api/club-night/checkins/:id/emergency-contact', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Club-night check-in is not available right now.' });
      const volunteer = await requireVolunteerToday(req, res);
      if (!volunteer) return;
      if (!ID.test(req.params.id)) return res.status(400).json({ error: 'Choose a check-in.' });
      const checkin = (await checkins().doc(req.params.id).get()).data();
      if (!checkin || checkin.date !== volunteer.date || !checkin.memberId) return res.status(404).json({ error: 'Check-in not found for today.' });
      const member = (await db().collection('memberships').doc(checkin.memberId).get()).data();
      const household = member?.householdId ? (await db().collection('households').doc(member.householdId).get()).data() : null;
      const junior = memberIsJunior(member || {});
      const contact = junior || !household?.emergencyContact?.phone
        ? { name: household?.contactName || '', relationship: household?.contactRelationship || 'Parent/Guardian', phone: household?.phone || '' }
        : household.emergencyContact;
      await db().collection('clubNightAccessLog').add({ kind: 'emergency-contact', checkinId: req.params.id, memberId: checkin.memberId,
        volunteerEmail: volunteer.email, viaAdmin: volunteer.admin, date: volunteer.date, at: Timestamp.now() });
      res.set('Cache-Control', 'no-store');
      res.json({ name: checkin.name, contact: contact.phone ? contact : null });
    } catch (error) {
      console.error('Could not load emergency contact:', error.message);
      res.status(500).json({ error: 'Could not load the emergency contact. Use the club emergency procedure.' });
    }
  });
};
