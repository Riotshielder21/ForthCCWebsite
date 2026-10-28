import { Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './rateLimit.js';
import { membershipActivity } from '../utils/membership.js';
import { memberIsJunior } from '../utils/households.js';
import { isCodeEmail, normaliseCodeEmail } from '../utils/emailCodes.js';
import { validateDetailsUpdate, changedFields, managedByJustgo } from '../utils/myDetails.js';
import { buildLinkedReceipt } from '../utils/receipt.js';
import { clubYearDates, clubYearOf } from '../utils/clubYear.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Members verify their email with a code, then view and update their household's contact details. */
export const registerMyDetailsRoutes = (app, { db, sendEmail, emailCodes }) => {
  const households = () => db().collection('households');
  const householdsFor = async (email) => (await households().where('email', '==', email).limit(10).get()).docs;
  const peopleIn = async (householdId) => (await db().collection('memberships').where('householdId', '==', householdId).limit(20).get()).docs;
  // A code is only sent when the date of birth matches someone in a household that uses this email.
  emailCodes.allowPurpose('details', async (email, req) => {
    const dob = typeof req.body?.dob === 'string' ? req.body.dob : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
    for (const household of await householdsFor(email)) {
      if ((await peopleIn(household.id)).some((person) => person.data().dob === dob)) return true;
    }
    return false;
  }, 'The email address and/or date of birth do not match a membership or purchase record. Use the email you joined or bought with, and your date of birth or the attendee’s (for example your child’s).');
  /** Paid orders with this email since renewals opened for the current club year, as the same limited receipt the emailed link shows. */
  const purchasesFor = async (email) => {
    const start = clubYearDates(clubYearOf() - 1).renewalOpens;
    const orders = (await db().collection('orders').where('email', '==', email).limit(100).get()).docs
      .filter((order) => order.data().status === 'paid' && order.data().createdAt?.toDate?.() >= start)
      .sort((a, b) => b.data().createdAt.toMillis() - a.data().createdAt.toMillis());
    return orders.map((order) => ({ ...buildLinkedReceipt(order.id, order.data()), createdAt: order.data().createdAt.toDate() }));
  };
  const describe = async (household) => {
    const people = await peopleIn(household.id);
    const data = household.data();
    return {
      id: household.id, contactName: data.contactName || '', contactRelationship: data.contactRelationship || '', email: data.email || '',
      phone: data.phone || '', address: data.address || '', postcode: data.postcode || '', emergencyContact: data.emergencyContact || null,
      justgo: people.some((person) => managedByJustgo(person.data())),
      people: people.map((person) => {
        const member = person.data();
        return { memberId: person.id, firstName: member.firstName || '', lastName: member.lastName || '', dob: member.dob || '',
          junior: memberIsJunior(member), swimming: member.swimming || '',
          membership: member.contactOnly ? 'Not a member' : membershipActivity(member) === 'active' ? 'Active member' : 'Membership not active' };
      })
    };
  };
  /** The household, if the verified email is its contact address and it may be edited here. */
  const ownedHousehold = async (req, res, email) => {
    if (!ID.test(req.params.householdId)) { res.status(400).json({ error: 'Choose a household.' }); return null; }
    const reference = households().doc(req.params.householdId);
    const household = await reference.get();
    if (!household.exists || household.data().email !== email) { res.status(404).json({ error: 'Household not found.' }); return null; }
    if ((await peopleIn(household.id)).some((person) => managedByJustgo(person.data()))) {
      res.status(409).json({ error: 'Your membership is managed in JustGo. Please update your details in JustGo.' });
      return null;
    }
    return { reference, household };
  };

  app.get('/api/my-details', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Member details are not available right now.' });
      const session = await emailCodes.requireEmailSession(req, res, 'details');
      if (!session) return;
      res.set('Cache-Control', 'no-store');
      res.json({ email: session.email, expiresAt: session.expiresAt, households: await Promise.all((await householdsFor(session.email)).map(describe)),
        purchases: await purchasesFor(session.email) });
    } catch (error) {
      console.error('Could not load member details:', error.message);
      res.status(500).json({ error: 'Could not load your details.' });
    }
  });

  app.patch('/api/my-details/:householdId', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Member details are not available right now.' });
      const session = await emailCodes.requireEmailSession(req, res, 'details');
      if (!session) return;
      const owned = await ownedHousehold(req, res, session.email);
      if (!owned) return;
      const { error, value } = validateDetailsUpdate(req.body, owned.household.data());
      if (error) return res.status(400).json({ error });
      const fields = changedFields(owned.household.data(), value);
      if (fields.length) {
        await owned.reference.update({ ...value, updatedAt: Timestamp.now(), updatedBy: 'self-service' });
        await db().collection('selfServiceChanges').add({ householdId: owned.household.id, fields, at: Timestamp.now() });
      }
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, changed: fields, household: await describe(await owned.reference.get()) });
    } catch (error) {
      console.error('Could not update member details:', error.message);
      res.status(500).json({ error: 'Could not save your details.' });
    }
  });

  app.post('/api/my-details/:householdId/email', rateLimit(5, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Member details are not available right now.' });
      const session = await emailCodes.requireEmailSession(req, res, 'details');
      if (!session) return;
      const owned = await ownedHousehold(req, res, session.email);
      if (!owned) return;
      const newEmail = normaliseCodeEmail(req.body?.newEmail);
      if (!isCodeEmail(newEmail) || newEmail === session.email) return res.status(400).json({ error: 'Enter a different, valid email address.' });
      const sent = await emailCodes.sendCode('email-change', newEmail, { householdId: owned.household.id, fromEmail: session.email });
      if (!sent) return res.status(429).json({ error: 'A code was sent to that address recently. Wait a minute and try again.' });
      res.json({ success: true, message: `We have sent a 6-digit code to ${newEmail}. Enter it to confirm the change.` });
    } catch (error) {
      console.error('Could not start email change:', error.message);
      res.status(500).json({ error: 'Could not send the confirmation code.' });
    }
  });

  app.post('/api/my-details/:householdId/email/confirm', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Member details are not available right now.' });
      const session = await emailCodes.requireEmailSession(req, res, 'details');
      if (!session) return;
      const owned = await ownedHousehold(req, res, session.email);
      if (!owned) return;
      const newEmail = normaliseCodeEmail(req.body?.newEmail);
      const record = isCodeEmail(newEmail) ? await emailCodes.consumeCode('email-change', newEmail, String(req.body?.code || '').trim()) : null;
      if (!record || record.householdId !== owned.household.id || record.fromEmail !== session.email) {
        return res.status(400).json({ error: 'That code is wrong or has expired. Request a new code if needed.' });
      }
      await owned.reference.update({ email: newEmail, updatedAt: Timestamp.now(), updatedBy: 'self-service' });
      // Older member records may still carry their own copy of the contact email.
      const people = await peopleIn(owned.household.id);
      await Promise.all(people.filter((person) => person.data().email === session.email).map((person) => person.ref.update({ email: newEmail })));
      await db().collection('selfServiceChanges').add({ householdId: owned.household.id, fields: ['email'], at: Timestamp.now() });
      await sendEmail({ to: session.email, subject: 'Your Forth Canoe Club contact email has changed',
        body: `The contact email for your Forth Canoe Club membership has been changed to ${newEmail}.\n\nIf you did not make this change, contact secretary@forthcanoeclub.co.uk straight away.`,
        record: { kind: 'email-changed', householdId: owned.household.id } }).catch((error) => console.error('Could not send email-change notice:', error.message));
      res.json({ success: true, email: newEmail, message: 'Your contact email has been changed. Sign in again with the new address to make further changes.' });
    } catch (error) {
      console.error('Could not confirm email change:', error.message);
      res.status(500).json({ error: 'Could not change your email address.' });
    }
  });
};
