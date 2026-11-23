import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './rateLimit.js';
import { createPaymentLink, resolvePaymentLink } from './paymentLinks.js';
import { suppressesNormalEmail } from './emailSuppression.js';
import { auditEntry } from '../utils/auditLog.js';
import { clubYearDates, clubYearOf } from '../utils/clubYear.js';
import { activeSubscriptionItems, itemPrice } from '../utils/subscriptions.js';
import { continuationAnswer, continuationEmail, continuationOpen, continuationResult, needsContinuation } from '../utils/subscriptionContinuation.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ANSWERS = { confirm: 'confirmed', cancel: 'cancelled' };

/**
 * The continue/cancel email sent with each renewal round, its links (stored hashed in `paymentLinks`, kind
 * `continuation`) and the member's answer. `subscriptions/{id}.continuation` holds the renewal year, the answer
 * (`confirmed`, `cancelled` or `unconfirmed`), when it was emailed and reminded, and the link token's hash. Cancelling
 * sets Stripe's `cancel_at` (and `metadata.cutoff_at`) to 1 March, so the subscription ends as expected there.
 */
export const registerContinuationRoutes = (app, { db, stripeRequest, sendEmail, siteUrl, requestNow, contact }) => {
  const subscriptions = () => db().collection('subscriptions');
  const lines = (record) => activeSubscriptionItems(record).map((item) => ({ name: item.name || '', names: item.names || [], price: itemPrice(item) }));

  /**
   * Emails everyone who has not been asked about next club year; `reminder` (the 15 February round) asks again anyone
   * who has not answered, and counts as the first email for anyone missed. Each subscription is marked in a
   * transaction before sending, so overlapping runs never email twice; a failed send undoes its mark.
   */
  const send = async (now, { reminder = false } = {}) => {
    const renewalYear = clubYearOf(now) + 1;
    if (!continuationOpen(renewalYear, now)) return { emails: 0, failures: 0 };
    const snapshot = await subscriptions().where('status', '==', 'active').get();
    let emails = 0;
    let failures = 0;
    for (const document of snapshot.docs.filter((entry) => needsContinuation(entry.data(), renewalYear))) {
      const claimed = await db().runTransaction(async (transaction) => {
        const record = (await transaction.get(document.ref)).data();
        if (!needsContinuation(record, renewalYear) || suppressesNormalEmail(record)) return null;
        const previous = record.continuation?.renewalYear === renewalYear ? record.continuation : null;
        if (reminder ? continuationAnswer(record, renewalYear) !== 'unconfirmed' || previous?.remindedAt : previous?.emailedAt) return null;
        const at = Timestamp.fromDate(now);
        const next = { renewalYear, status: continuationAnswer(record, renewalYear), tokenHash: previous?.tokenHash || hash(crypto.randomBytes(32).toString('hex')),
          emailedAt: previous?.emailedAt || at, remindedAt: reminder ? at : previous?.remindedAt || null, answeredAt: previous?.answeredAt || null };
        transaction.update(document.ref, { continuation: next });
        return { record, previous, next };
      });
      if (!claimed) continue;
      try {
        const key = await createPaymentLink(db(), 'continuation', document.id, claimed.next.tokenHash);
        const base = `${siteUrl()}/subscription?key=${encodeURIComponent(key)}`;
        const mail = continuationEmail({ renewalYear, reminder, contact, lines: lines(claimed.record), confirmUrl: `${base}&answer=confirm`, cancelUrl: `${base}&answer=cancel` });
        if (!await sendEmail({ to: claimed.record.email, ...mail, record: { kind: 'subscription-continuation', subscriptionId: document.id, renewalYear, reminder } })) {
          throw new Error('Email is not configured.');
        }
        emails += 1;
      } catch (error) {
        failures += 1;
        console.error('Could not send a continue/cancel email:', error.message);
        await document.ref.update({ continuation: claimed.previous || FieldValue.delete() })
          .catch((undoError) => console.error('Could not undo the continue/cancel email mark:', undoError.message));
      }
    }
    return { emails, failures };
  };

  /** Counts for staff: how payers answered about next club year, and how many have not been emailed yet. */
  const summary = async (now) => {
    const renewalYear = clubYearOf(now) + 1;
    const counts = { renewalYear, confirmed: 0, unconfirmed: 0, cancelled: 0, notEmailed: 0 };
    for (const document of (await subscriptions().where('status', '==', 'active').get()).docs) {
      const record = document.data();
      const answer = continuationAnswer(record, renewalYear);
      if (answer === 'cancelled' && record.continuation?.renewalYear === renewalYear) counts.cancelled += 1;
      else if (!needsContinuation(record, renewalYear)) continue;
      else {
        counts[answer] += 1;
        if (record.continuation?.renewalYear !== renewalYear || !record.continuation.emailedAt) counts.notEmailed += 1;
      }
    }
    return counts;
  };

  /** The subscription an emailed link is for, with what the member sees, or a refusal. */
  const linked = async (key, now) => {
    const parts = await resolvePaymentLink(db(), key, 'continuation');
    const document = parts ? await subscriptions().doc(parts.id).get() : null;
    const record = document?.data();
    if (!record?.continuation || record.continuation.tokenHash !== parts.tokenHash || suppressesNormalEmail(record)) {
      return { refusal: { status: 404, error: 'This link is not valid. Use the link in your latest email.' } };
    }
    const { renewalYear } = record.continuation;
    const status = continuationAnswer(record, renewalYear);
    return { document, record, summary: { renewalYear, status, message: continuationResult(status, renewalYear),
      open: record.status === 'active' && continuationOpen(renewalYear, now), stopped: record.status !== 'active',
      interval: record.interval || 'month', items: lines(record) } };
  };

  app.get('/api/subscription-continuation/:key', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const { refusal, summary: view } = await linked(String(req.params.key), requestNow(req));
      if (refusal) return res.status(refusal.status).json(refusal);
      res.json(view);
    } catch (error) {
      console.error('Could not load a continue/cancel link:', error.message);
      res.status(500).json({ error: 'Could not load your subscription. Please try again.' });
    }
  });

  /** Records the member's answer. Cancel ends the subscription at 1 March in Stripe; confirming afterwards undoes that. */
  app.post('/api/subscription-continuation/:key', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const wanted = ANSWERS[req.body?.answer];
      if (!wanted) return res.status(400).json({ error: 'Choose confirm or cancel.' });
      const now = requestNow(req);
      const { refusal, document, record, summary: view } = await linked(String(req.params.key), now);
      if (refusal) return res.status(refusal.status).json(refusal);
      if (!view.open) {
        return res.status(409).json({ code: 'continuation_closed', ...view, error: view.stopped ? 'These payments have already stopped.'
          : `Answers closed when the club year started on 1 March. To stop your subscription now, use My details or email ${contact}.` });
      }
      if (view.status === wanted) return res.json(view);
      const end = Math.floor(clubYearDates(view.renewalYear).start.getTime() / 1000);
      const live = await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
      // A schedule (a volunteer's pending change) or an end set by staff would be overwritten, so those go to the treasurer.
      if (live.schedule || (live.cancel_at && live.cancel_at !== end) || (wanted === 'confirmed' && !live.cancel_at && record.cancelAt)) {
        return res.status(409).json({ code: 'continuation_review', ...view, error: `This subscription has another change waiting. Please email ${contact} to ${wanted === 'cancelled' ? 'cancel' : 'keep'} it.` });
      }
      if (wanted === 'cancelled') {
        await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, [['cancel_at', String(end)], ['proration_behavior', 'none'], ['metadata[cutoff_at]', String(end)]], 'POST');
      } else if (live.cancel_at === end) {
        await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, [['cancel_at', ''], ['metadata[cutoff_at]', '']], 'POST');
      }
      const at = Timestamp.fromDate(now);
      const endsAt = wanted === 'cancelled' ? Timestamp.fromMillis(end * 1000) : null;
      const batch = db().batch();
      batch.update(document.ref, { cancelAt: endsAt, 'continuation.status': wanted, 'continuation.answeredAt': at, updatedAt: at,
        items: (record.items || []).map((item) => item.status === 'active' ? { ...item, endsAt } : item) });
      const members = (record.membershipIds || []).length ? await db().getAll(...record.membershipIds.map((id) => db().collection('memberships').doc(id))) : [];
      for (const member of members.filter((entry) => entry.exists)) {
        batch.update(member.ref, { subscriptionItems: (member.data().subscriptionItems || []).map((item) => item.subscriptionId === document.id && item.status === 'active'
          ? { ...item, endsAt } : item) });
      }
      batch.set(db().collection('auditLog').doc(), auditEntry({ kind: 'subscription', action: wanted === 'cancelled' ? 'member-cancel-at-year-end' : 'member-continue',
        reason: wanted === 'cancelled' ? 'The payer cancelled from the continue/cancel email' : 'The payer confirmed from the continue/cancel email',
        actor: record.email, at, stripeSubscriptionId: document.id, renewalYear: view.renewalYear }));
      await batch.commit();
      if (wanted === 'cancelled') {
        await sendEmail({ to: record.email, subject: 'Your Forth Canoe Club subscription stops at the end of February',
          body: [continuationResult(wanted, view.renewalYear), '', ...view.items.map((item) => `- ${item.name}${item.names.length ? ` (${item.names.join(', ')})` : ''}: ${item.price}`), '',
            `Changed your mind? Use the Confirm link in your email before 1 March, or email ${contact}.`, '', 'Forth Canoe Club'].join('\n'),
          record: { kind: 'subscription-continuation-answer', subscriptionId: document.id, renewalYear: view.renewalYear } })
          .catch((error) => console.error('Could not confirm the cancellation by email:', error.message));
      }
      res.json({ ...view, status: wanted, message: continuationResult(wanted, view.renewalYear) });
    } catch (error) {
      console.error('Could not record a continue/cancel answer:', error.message);
      res.status(500).json({ error: `Could not save your answer. Please try again or email ${contact}.` });
    }
  });

  return { send, summary };
};
