import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './rateLimit.js';
import { membershipActivity } from '../utils/membership.js';
import { memberIsJunior } from '../utils/households.js';
import { isCodeEmail, normaliseCodeEmail } from '../utils/emailCodes.js';
import { validateDetailsUpdate, changedFields, managedByJustgo } from '../utils/myDetails.js';
import { buildLinkedReceipt } from '../utils/receipt.js';
import { clubYearDates, clubYearOf } from '../utils/clubYear.js';
import { activeSubscriptionItems } from '../utils/subscriptions.js';
import { resolveOrderPeople } from './orderPeople.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CUSTOMER_ID = /^cus_[A-Za-z0-9_-]+$/;

export const updateStripeCustomerEmails = async (request, subscriptions, email) => {
  const customerIds = new Set();
  for (const document of subscriptions) {
    const subscription = await request(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    if (!CUSTOMER_ID.test(customerId || '')) throw new Error(`Stripe subscription ${document.id} has no valid customer.`);
    customerIds.add(customerId);
  }
  for (const customerId of customerIds) {
    await request(`customers/${encodeURIComponent(customerId)}`, [['email', email]], 'POST');
  }
  return [...customerIds];
};

/** Members verify their email with a code, then view and update their household's contact details. */
export const registerMyDetailsRoutes = (app, { db, sendEmail, emailCodes, stripeRequest, raiseAttention = async () => {} }) => {
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
    const resolved = await resolveOrderPeople(db(), orders.map((order) => order.data()));
    return orders.map((order, index) => ({ ...buildLinkedReceipt(order.id, resolved[index]), createdAt: order.data().createdAt.toDate() }));
  };
  /**
   * Active monthly payments this email pays for, and any that pay for people in its households. Another payer's
   * email is not shown; the member can still ask the club to stop items they receive.
   */
  const monthlyPaymentsFor = async (email, householdDocs) => {
    const memberIds = new Set((await Promise.all(householdDocs.map((household) => peopleIn(household.id)))).flat().map((person) => person.id));
    const subscriptions = db().collection('subscriptions');
    const found = new Map((await subscriptions.where('email', '==', email).limit(30).get()).docs.map((document) => [document.id, document]));
    for (const ids of [...memberIds].reduce((chunks, id, index) => { if (index % 30 === 0) chunks.push([]); chunks.at(-1).push(id); return chunks; }, [])) {
      (await subscriptions.where('membershipIds', 'array-contains-any', ids).limit(30).get()).docs.forEach((document) => found.set(document.id, document));
    }
    return [...found.values()].filter((document) => document.data().status === 'active').map((document) => {
      const data = document.data();
      const pays = data.email === email;
      const items = activeSubscriptionItems(data).filter((item) => (pays || (item.membershipIds || []).some((id) => memberIds.has(id))));
      const requested = new Set((data.cancelRequests || []).flatMap((request) => request.lineKeys || []));
      return { subscriptionId: document.id, paidByYou: pays,
        items: items.map((item) => ({ key: `${item.orderRef || data.orderRef || ''}/${item.lineId}`, name: item.name || '', names: item.names || [],
          monthlyAmount: Number(item.monthlyAmount || 0), clubYear: item.clubYear || data.clubYear || null })).map((item) => ({ ...item, cancelRequested: requested.has(item.key) })) };
    }).filter((subscription) => subscription.items.length);
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
      const householdDocs = await householdsFor(session.email);
      res.json({ email: session.email, expiresAt: session.expiresAt, households: await Promise.all(householdDocs.map(describe)),
        purchases: await purchasesFor(session.email), monthlyPayments: await monthlyPaymentsFor(session.email, householdDocs) });
    } catch (error) {
      console.error('Could not load member details:', error.message);
      res.status(500).json({ error: 'Could not load your details.' });
    }
  });

  // Members ask the club to stop monthly payments; staff make the change, so nothing is cancelled by mistake.
  app.post('/api/my-details/monthly/:subscriptionId/cancel-request', rateLimit(5, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Member details are not available right now.' });
      const session = await emailCodes.requireEmailSession(req, res, 'details');
      if (!session) return;
      const subscription = (await monthlyPaymentsFor(session.email, await householdsFor(session.email)))
        .find((candidate) => candidate.subscriptionId === req.params.subscriptionId);
      if (!subscription) return res.status(404).json({ error: 'Those monthly payments were not found.' });
      const keys = Array.isArray(req.body?.itemKeys) ? req.body.itemKeys.filter((key) => typeof key === 'string').slice(0, 20) : [];
      const items = subscription.items.filter((item) => keys.includes(item.key) && !item.cancelRequested);
      if (!items.length) return res.status(400).json({ error: 'Choose what you would like to stop.' });
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
      const at = Timestamp.now();
      await db().collection('subscriptions').doc(subscription.subscriptionId).update({
        cancelRequests: FieldValue.arrayUnion({ at, by: session.email, lineKeys: items.map((item) => item.key), reason }) });
      const summary = items.map((item) => `${item.name}${item.names.length ? ` for ${item.names.join(', ')}` : ''} (£${item.monthlyAmount.toFixed(2)} a month)`);
      await raiseAttention('cancel-request', `${subscription.subscriptionId}-${at.toMillis()}`, { subscriptionId: subscription.subscriptionId, email: session.email,
        data: { itemKeys: items.map((item) => item.key) },
        detail: `${session.email} asked to stop: ${summary.join('; ')}.${subscription.paidByYou ? '' : ' They receive these items but someone else pays.'}${reason ? ` Reason: ${reason}` : ''} Cancel them under the member's Monthly payments, then resolve this with a note.` });
      await sendEmail({ to: session.email, subject: 'We have your request to stop monthly payments',
        body: ['We have received your request to stop these monthly payments:', '', ...summary.map((line) => `- ${line}`), '',
          'The club will make the change and email you to confirm. Payments continue until then; anything taken after your request will be refunded.', '',
          'For help, contact secretary@forthcanoeclub.co.uk.'].join('\n'), record: { kind: 'cancel-request', subscriptionId: subscription.subscriptionId } })
        .catch((error) => console.error('Could not confirm the cancellation request by email:', error.message));
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, message: 'Your request has been sent to the club. We will email you when the payments are stopped.' });
    } catch (error) {
      console.error('Could not record the cancellation request:', error.message);
      res.status(500).json({ error: 'Could not send your request. Please email secretary@forthcanoeclub.co.uk.' });
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
      const payerSubscriptions = (await db().collection('subscriptions').where('email', '==', session.email).limit(100).get()).docs
        .filter((document) => document.data().status === 'active');
      if (payerSubscriptions.length) {
        try {
          if (!stripeRequest) throw new Error('Stripe is not configured.');
          await updateStripeCustomerEmails(stripeRequest, payerSubscriptions, newEmail);
        } catch (stripeError) {
          await raiseAttention('stripe-email-update', `${owned.household.id}-${Date.now()}`, { email: session.email,
            detail: `Stripe could not change the billing email from ${session.email} to ${newEmail}: ${stripeError.message}. Confirm the Stripe customer email, then resolve this item.` })
            .catch((attentionError) => console.error('Could not flag the Stripe email-change failure:', attentionError.message));
          throw Object.assign(new Error(`Could not update the Stripe customer email: ${stripeError.message}`),
            { publicMessage: 'Could not update the billing email. Request a new code and try again, or contact the club.' });
        }
      }
      // Keep the club record and its active billing mirrors consistent after Stripe accepts the new email.
      const people = await peopleIn(owned.household.id);
      const at = Timestamp.now();
      const batch = db().batch();
      batch.update(owned.reference, { email: newEmail, updatedAt: at, updatedBy: 'self-service' });
      people.filter((person) => person.data().email === session.email).forEach((person) => batch.update(person.ref, { email: newEmail }));
      payerSubscriptions.forEach((document) => batch.update(document.ref, { email: newEmail, updatedAt: at }));
      batch.set(db().collection('selfServiceChanges').doc(), { householdId: owned.household.id, fields: ['email'], at });
      await batch.commit();
      await sendEmail({ to: session.email, subject: 'Your Forth Canoe Club contact email has changed',
        body: `The contact email for your Forth Canoe Club membership has been changed to ${newEmail}.\n\nIf you did not make this change, contact secretary@forthcanoeclub.co.uk straight away.`,
        record: { kind: 'email-changed', householdId: owned.household.id } }).catch((error) => console.error('Could not send email-change notice:', error.message));
      res.json({ success: true, email: newEmail, message: 'Your contact email has been changed. Sign in again with the new address to make further changes.' });
    } catch (error) {
      console.error('Could not confirm email change:', error.message);
      res.status(500).json({ error: error.publicMessage || 'Could not change your email address.' });
    }
  });
};
