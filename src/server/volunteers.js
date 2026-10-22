import crypto from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { validateListSubmission, sheetCell, matchesVolunteer, volunteerCodeDecision, boathouseCodeDecision, VOLUNTEER_LIST } from '../utils/lists.js';
import { membershipActivity } from '../utils/membership.js';

const VOLUNTEER_DISCOUNT = 0.25;
const CODE_DAYS = 365;

/**
 * Public list submissions and the volunteer reward. A sign-up is only linked to a membership when the name and a contact
 * email both match; nothing is revealed to the submitter. An admin ticks "inducted", and the code is emailed once the
 * volunteer is both inducted and an active member (re-checked after every paid order for that email). Volunteers an admin
 * also ticks "Active" are emailed the boathouse code once they are checked in (inducted) as active members, and again
 * whenever it changes.
 */
export const registerVolunteerRoutes = (app, { rateLimit, requireAdmin, db, sheets, toMembershipRecord, stripeSubscriptionIsActive, sendEmail }) => {
  const lists = () => db().collection('lists');

  const findVolunteerMember = async ({ name, email }) => {
    const adminDb = db();
    const [byEmail, households] = await Promise.all([
      adminDb.collection('memberships').where('email', '==', email).limit(20).get(),
      adminDb.collection('households').where('email', '==', email).limit(20).get()
    ]);
    const householdMembers = (await Promise.all(households.docs.map((household) =>
      adminDb.collection('memberships').where('householdId', '==', household.id).limit(50).get()))).flatMap((snapshot) => snapshot.docs);
    const householdEmails = new Map(households.docs.map((household) => [household.id, household.data().email]));
    const candidates = [...new Map([...byEmail.docs, ...householdMembers].map((document) => [document.id, document])).values()];
    return candidates.find((document) => {
      const data = document.data();
      return matchesVolunteer({ ...data, contactEmails: [data.email, householdEmails.get(data.householdId)].filter(Boolean) }, { name, email });
    }) || null;
  };

  const memberIsActive = async (memberDocument) => {
    if (!memberDocument?.exists) return false;
    const member = toMembershipRecord(memberDocument);
    if (membershipActivity(member) !== 'active') return false;
    try {
      return await stripeSubscriptionIsActive(member);
    } catch (error) {
      console.error('Volunteer membership check failed:', error.message);
      return false;
    }
  };

  const emailCode = async (signupReference, signup, code) => {
    try {
      const emailSent = await sendEmail({
        to: signup.email, subject: 'Thank you for volunteering with Forth Canoe Club',
        body: [`Hi ${signup.name},`, '', 'Thank you for volunteering with Forth Canoe Club. Now that your induction is complete, here is your thank-you code:', '',
          code, '', `It gives ${VOLUNTEER_DISCOUNT * 100}% off one shop purchase (not memberships) and lasts for a year.`, '',
          'For help, contact secretary@forthcanoeclub.co.uk.'].join('\n'),
        record: { kind: 'volunteer-code', signupId: signupReference.id, code }
      });
      await signupReference.update({ codeEmailed: emailSent, ...(emailSent ? { codeEmailedAt: Timestamp.now() } : {}) });
    } catch (error) {
      console.error('Volunteer code issued but not emailed:', error.message);
      await signupReference.update({ codeEmailed: false });
    }
  };

  /** The sign-up's membership, linking one by name and contact email if it was not known yet. */
  const linkVolunteerMember = async (signupReference, signup) => {
    const memberDocument = signup.memberId ? await db().collection('memberships').doc(signup.memberId).get() : null;
    if (memberDocument?.exists) return memberDocument;
    const found = await findVolunteerMember(signup);
    if (found) await signupReference.update({ memberId: found.id });
    return found;
  };

  const boathouseCode = async () => (await db().collection('settings').doc('boathouseCode').get()).data() || {};

  /** Emails the current boathouse code to an active volunteer who has not had this version yet. */
  const settleBoathouseCode = async (signupReference, current = null) => {
    const signup = (await signupReference.get()).data();
    if (!signup || signup.listType !== VOLUNTEER_LIST) return 'not-volunteer';
    const code = current || await boathouseCode();
    const ready = { inducted: signup.inducted === true, active: signup.active === true, codeVersion: code.version || 0, sentVersion: signup.boathouseCodeVersion || 0 };
    // Membership is checked last because it can call Stripe.
    const withoutMembership = boathouseCodeDecision({ ...ready, memberActive: true });
    if (withoutMembership !== 'send') return withoutMembership;
    const memberActive = await memberIsActive(await linkVolunteerMember(signupReference, signup));
    const decision = boathouseCodeDecision({ ...ready, memberActive });
    if (decision !== 'send') return decision;
    try {
      const emailSent = await sendEmail({
        to: signup.email, subject: 'Forth Canoe Club boathouse code',
        body: [`Hi ${signup.name},`, '',
          ready.sentVersion ? 'The boathouse code has changed. As an active volunteer, here is the new code:' : 'As an active volunteer, here is the current boathouse code:', '',
          code.code, ...(code.note ? ['', code.note] : []), '',
          'Please keep it to yourself and do not write it down where others can see it.', '',
          'For help, contact secretary@forthcanoeclub.co.uk.'].join('\n'),
        record: { kind: 'boathouse-code', signupId: signupReference.id, version: code.version }
      });
      if (!emailSent) return 'not-sent';
      await signupReference.update({ boathouseCodeVersion: code.version, boathouseCodeSentAt: Timestamp.now() });
      return 'sent';
    } catch (error) {
      console.error('Boathouse code not emailed to a volunteer:', error.message);
      return 'not-sent';
    }
  };

  /** After the code changes: every active volunteer who has not had this version is emailed it. */
  const notifyBoathouseCode = async () => {
    if (!db()) return { sent: 0, failed: 0 };
    const code = await boathouseCode();
    const snapshot = await lists().where('listType', '==', VOLUNTEER_LIST).where('active', '==', true).limit(500).get();
    const outcomes = [];
    for (const document of snapshot.docs) outcomes.push(await settleBoathouseCode(document.ref, code));
    return { sent: outcomes.filter((outcome) => outcome === 'sent').length, failed: outcomes.filter((outcome) => outcome === 'not-sent').length };
  };

  /** Links the sign-up to a membership if one now exists, and issues the code once everything is in place. */
  const settleVolunteer = async (signupReference) => {
    const adminDb = db();
    let signup = (await signupReference.get()).data();
    if (!signup || signup.listType !== VOLUNTEER_LIST) return 'not-volunteer';
    const memberDocument = await linkVolunteerMember(signupReference, signup);
    if (memberDocument) signup = { ...signup, memberId: memberDocument.id };
    if (memberDocument?.exists) {
      await memberDocument.ref.set({ volunteer: { signupId: signupReference.id, inducted: signup.inducted === true } }, { merge: true });
    }
    const decision = volunteerCodeDecision({
      inducted: signup.inducted === true, codeIssued: Boolean(signup.discountCode),
      memberActive: signup.inducted === true && !signup.discountCode ? await memberIsActive(memberDocument) : false
    });
    if (decision === 'issued' && signup.codeEmailed !== true) await emailCode(signupReference, signup, signup.discountCode);
    if (decision !== 'issue') return decision;

    const code = `VOL-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const issued = await adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(signupReference);
      if (current.data()?.discountCode) return false;
      transaction.create(adminDb.collection('discountCodes').doc(code), {
        code, label: `Volunteer thank-you (${signup.name})`, discountType: 'multiplier', discountValue: VOLUNTEER_DISCOUNT,
        productIds: [], singleUse: true, used: false, active: true, allowsAnnualStacking: false, excludedCategories: ['MEMBERSHIP'],
        email: signup.email, name: signup.name, volunteerSignupId: signupReference.id, createdBy: 'volunteer-induction',
        createdAt: Timestamp.now(), expiresAt: Timestamp.fromDate(new Date(Date.now() + CODE_DAYS * 24 * 60 * 60 * 1000))
      });
      transaction.update(signupReference, { discountCode: code, codeIssuedAt: Timestamp.now(), status: 'rewarded' });
      return true;
    });
    if (!issued) return 'issued';
    await emailCode(signupReference, signup, code);
    return 'issued';
  };

  app.post('/api/lists', rateLimit(5, 60 * 1000), async (req, res) => {
    const { error, value } = validateListSubmission(req.body);
    if (error) return res.status(400).json({ error });
    if (!db()) return res.status(503).json({ error: 'Submissions are not available right now.' });
    try {
      const volunteer = value.listType === VOLUNTEER_LIST;
      const member = volunteer ? await findVolunteerMember(value) : null;
      const reference = await lists().add({
        ...value, status: 'pending', createdAt: Timestamp.now(),
        ...(volunteer ? { memberId: member?.id || null, inducted: false, active: false, discountCode: null } : {})
      });
      if (member) await member.ref.set({ volunteer: { signupId: reference.id, inducted: false } }, { merge: true });

      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      if (sheets() && spreadsheetId) {
        try {
          await sheets().spreadsheets.values.append({
            spreadsheetId, range: 'Lists!A:G', valueInputOption: 'RAW',
            requestBody: { values: [[new Date().toISOString(), value.name, value.email, value.listType, value.items.join('; '), value.notes, reference.id].map(sheetCell)] }
          });
        } catch (sheetError) {
          console.error('List saved but not copied to Sheets:', sheetError.message);
        }
      }
      // The same answer whether or not a membership matched, so the form cannot be used to look people up.
      res.json({ success: true });
    } catch (submitError) {
      console.error('Could not save list submission:', submitError.message);
      res.status(500).json({ error: 'Could not submit the form. Please try again.' });
    }
  });

  app.get('/api/admin/volunteers', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Volunteer storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      const snapshot = await lists().where('listType', '==', VOLUNTEER_LIST).limit(500).get();
      const codeVersion = (await boathouseCode()).version || 0;
      const memberIds = [...new Set(snapshot.docs.map((document) => document.data().memberId).filter(Boolean))];
      const members = memberIds.length
        ? new Map((await db().getAll(...memberIds.map((id) => db().collection('memberships').doc(id)))).filter((document) => document.exists).map((document) => [document.id, toMembershipRecord(document)]))
        : new Map();
      const volunteers = snapshot.docs.map((document) => {
        const data = document.data();
        const member = members.get(data.memberId);
        return {
          id: document.id, name: data.name, email: data.email, items: data.items || [], notes: data.notes || '',
          memberId: member ? data.memberId : '', memberStatus: member ? membershipActivity(member) : 'not a member',
          inducted: data.inducted === true, codeIssued: Boolean(data.discountCode), codeEmailed: data.codeEmailed === true,
          active: data.active === true, boathouseCodeCurrent: Boolean(codeVersion) && data.boathouseCodeVersion === codeVersion,
          createdAt: data.createdAt?.toMillis() || 0
        };
      }).sort((a, b) => b.createdAt - a.createdAt);
      res.json({ volunteers, boathouseCodeSet: Boolean(codeVersion) });
    } catch (error) {
      console.error('Could not list volunteers:', error.message);
      res.status(500).json({ error: 'Could not load volunteers.' });
    }
  });

  app.patch('/api/admin/volunteers/:id', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Volunteer storage is not configured.' });
      const { inducted, active } = req.body;
      const changes = Object.keys(req.body);
      if (changes.length !== 1 || !(typeof inducted === 'boolean' || typeof active === 'boolean') || !/^[A-Za-z0-9_-]{1,128}$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Choose whether the volunteer is inducted or active.' });
      }
      const reference = lists().doc(req.params.id);
      const document = await reference.get();
      if (!document.exists || document.data().listType !== VOLUNTEER_LIST) return res.status(404).json({ error: 'Volunteer not found.' });
      if (typeof active === 'boolean') {
        await reference.update({ active, activeChangedBy: admin.uid, activeChangedAt: Timestamp.now() });
        return res.json({ success: true, boathouseCode: active ? await settleBoathouseCode(reference) : 'not-active' });
      }
      if (!inducted && document.data().discountCode) return res.status(409).json({ error: 'A code has already been issued to this volunteer.' });
      await reference.update({ inducted, inductedBy: inducted ? admin.uid : null, inductedAt: inducted ? Timestamp.now() : null });
      const outcome = await settleVolunteer(reference);
      // Checking a volunteer in also gives an active volunteer the boathouse code.
      res.json({ success: true, outcome, boathouseCode: inducted ? await settleBoathouseCode(reference) : 'not-active' });
    } catch (error) {
      console.error('Could not update volunteer:', error.message);
      res.status(500).json({ error: 'Could not update the volunteer.' });
    }
  });

  /** Called after a paid order with the payer's and each person's contact email: inducted volunteers who have just become members get their codes. */
  const settleVolunteersFor = async (emails) => {
    if (!db()) return;
    for (const email of [...new Set(emails.filter(Boolean))].slice(0, 20)) {
      const snapshot = await lists().where('email', '==', email).limit(20).get();
      for (const document of snapshot.docs) {
        const data = document.data();
        if (data.listType !== VOLUNTEER_LIST || data.inducted !== true) continue;
        if (!data.discountCode) await settleVolunteer(document.ref);
        if (data.active === true) await settleBoathouseCode(document.ref);
      }
    }
  };

  return { settleVolunteersFor, notifyBoathouseCode };
};
