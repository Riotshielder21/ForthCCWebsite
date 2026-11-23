import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './rateLimit.js';
import { createPaymentLink, resolvePaymentLink } from './paymentLinks.js';
import { suppressesNormalEmail } from './emailSuppression.js';
import { auditEntry } from '../utils/auditLog.js';
import { clubYearDates, clubYearOf, holdsSubscriptionFrom } from '../utils/clubYear.js';
import { loadEntitlements } from './membershipTerms.js';
import { renewalEmail } from '../utils/renewals.js';
import { activeSubscriptionItems, itemPrice } from '../utils/subscriptions.js';
import { continuationAnswer, continuationOpen, continuationResult, needsContinuation, renewalPrice } from '../utils/subscriptionContinuation.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normaliseEmail = (value) => String(value || '').trim().toLowerCase();
const ANSWERS = { confirm: 'confirmed', cancel: 'cancelled' };

/**
 * Whether each subscription carries on into the next club year. In each renewal round its payer is asked in their
 * renewal email (`forPayer`, see renewals.js), or in an email of its own when they have nothing to renew (`send`):
 * Confirm keeps it at the new club year's price (see renewalPrice), Cancel stops it at the end of February. The links
 * are stored hashed in `paymentLinks` (kind `continuation`); `subscriptions/{id}.continuation` holds the renewal year, the
 * answer (`confirmed`, `cancelled` or `unconfirmed`), when it was emailed and reminded, and the link token's hash.
 * Cancelling sets Stripe's `cancel_at` (and `metadata.cutoff_at`) to 1 March, so the subscription ends as expected there.
 */
export const registerContinuationRoutes = (app, { db, stripeRequest, sendEmail, siteUrl, requestNow, contact, loadCatalogue, loadVolunteerBenefits }) => {
  const subscriptions = () => db().collection('subscriptions');
  const memberRecords = async (ids) => new Map(ids.length ? (await db().getAll(...ids.map((id) => db().collection('memberships').doc(id))))
    .filter((document) => document.exists).map((document) => [document.id, { ...document.data(), id: document.id }]) : []);
  const pricing = async (now) => {
    const [catalogue, tiers] = await Promise.all([loadCatalogue(now), loadVolunteerBenefits()]);
    return { catalogue, tiers };
  };

  /** Each item with its price now and from 1 March of `renewalYear`, and the volunteer price if lapsing volunteers sign up again. */
  const pricedLines = async (record, renewalYear, now, context = null) => {
    const { catalogue, tiers } = context || await pricing(now);
    const items = activeSubscriptionItems(record);
    const members = await memberRecords([...new Set(items.flatMap((item) => item.membershipIds || []))]);
    return items.map((item) => {
      const product = catalogue.find((entry) => entry.id === item.productId);
      const next = product ? renewalPrice({ item, product, members, tiers, renewalYear, now }) : null;
      const text = (amount) => amount === 0 ? 'free' : itemPrice({ ...item, [item.interval === 'year' ? 'yearlyAmount' : 'monthlyAmount']: amount });
      return { name: item.name || '', names: item.names || [], price: itemPrice(item), nextPrice: next ? text(next.price) : itemPrice(item),
        ...(next?.ifVolunteering !== undefined ? { ifVolunteering: text(next.ifVolunteering), volunteers: next.volunteers } : {}) };
    });
  };

  /** Marks a subscription as emailed this round in a transaction, so overlapping runs never email it twice. */
  const claim = (reference, renewalYear, now, reminder) => db().runTransaction(async (transaction) => {
    const record = (await transaction.get(reference)).data();
    if (!needsContinuation(record, renewalYear) || suppressesNormalEmail(record)) return null;
    const previous = record.continuation?.renewalYear === renewalYear ? record.continuation : null;
    if (reminder ? continuationAnswer(record, renewalYear) !== 'unconfirmed' || previous?.remindedAt : previous?.emailedAt) return null;
    const at = Timestamp.fromDate(now);
    const next = { renewalYear, status: continuationAnswer(record, renewalYear), tokenHash: previous?.tokenHash || hash(crypto.randomBytes(32).toString('hex')),
      emailedAt: previous?.emailedAt || at, remindedAt: reminder ? at : previous?.remindedAt || null, answeredAt: previous?.answeredAt || null };
    transaction.update(reference, { continuation: next });
    return { record, previous, next };
  });

  /**
   * Claims those of the subscriptions that are due an email this round (the first, or the 15 February reminder to anyone
   * who has not answered), with what the email says about each and its links. `undo` releases a claim if sending fails.
   */
  const claimParts = async (references, now, { reminder = false, context = null } = {}) => {
    const renewalYear = clubYearOf(now) + 1;
    const parts = [];
    try {
      for (const reference of references) {
        const claimed = await claim(reference, renewalYear, now, reminder);
        if (!claimed) continue;
        const undo = () => reference.update({ continuation: claimed.previous || FieldValue.delete() });
        parts.push({ id: reference.id, undo });
        const key = await createPaymentLink(db(), 'continuation', reference.id, claimed.next.tokenHash);
        const base = `${siteUrl()}/subscription?key=${encodeURIComponent(key)}`;
        Object.assign(parts.at(-1), { lines: await pricedLines(claimed.record, renewalYear, now, context),
          confirmUrl: `${base}&answer=confirm`, cancelUrl: `${base}&answer=cancel` });
      }
    } catch (error) {
      await Promise.all(parts.map((part) => part.undo().catch((undoError) => console.error('Could not undo a continue/cancel email mark:', undoError.message))));
      throw error;
    }
    return parts;
  };

  /** The subscriptions `email` pays for that their renewal email this round should ask about. */
  const forPayer = async (email, now, options = {}) => {
    if (!continuationOpen(clubYearOf(now) + 1, now)) return [];
    const owned = await subscriptions().where('email', '==', email).where('status', '==', 'active').get();
    return claimParts(owned.docs.map((document) => document.ref), now, options);
  };

  /**
   * After the renewal emails, asks every payer not already asked this round about their subscriptions, in one email per
   * payer: they had nothing to renew, or their renewal email went to another address. `confirmAll(email, ids)` makes
   * the Confirm all link for a payer with more than one (see renewals.js).
   */
  const send = async (now, { reminder = false, confirmAll = null } = {}) => {
    const renewalYear = clubYearOf(now) + 1;
    if (!continuationOpen(renewalYear, now)) return { emails: 0, failures: 0 };
    const byPayer = new Map();
    for (const document of (await subscriptions().where('status', '==', 'active').get()).docs) {
      if (!needsContinuation(document.data(), renewalYear)) continue;
      const email = normaliseEmail(document.data().email);
      byPayer.set(email, [...(byPayer.get(email) || []), document.ref]);
    }
    const context = byPayer.size ? await pricing(now) : null;
    let emails = 0;
    let failures = 0;
    for (const [email, references] of byPayer) {
      let parts = [];
      let all = null;
      try {
        parts = await claimParts(references, now, { reminder, context });
        if (!parts.length) continue;
        all = parts.length > 1 && confirmAll ? await confirmAll(email, parts.map((part) => part.id)) : null;
        const mail = renewalEmail({ renewalYear, reminder, contact, subscriptions: parts, confirmAllUrl: all?.url || '' });
        if (!await sendEmail({ to: email, ...mail, record: { kind: 'subscription-continuation', renewalYear, reminder,
          subscriptionIds: parts.map((part) => part.id), ...(parts.length === 1 ? { subscriptionId: parts[0].id } : {}) } })) {
          throw new Error('Email is not configured.');
        }
        emails += 1;
      } catch (error) {
        failures += 1;
        console.error('Could not send a continue/cancel email:', error.message);
        await Promise.all([...(all ? [all.remove()] : []),
          ...parts.map((part) => part.undo().catch((undoError) => console.error('Could not undo a continue/cancel email mark:', undoError.message)))]);
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

  /** What the member sees for a subscription they are asked about: its answer, whether answers are open, and its prices. */
  const viewOf = async (record, now) => {
    const { renewalYear } = record.continuation;
    const status = continuationAnswer(record, renewalYear);
    return { renewalYear, status, message: continuationResult(status, renewalYear),
      open: record.status === 'active' && continuationOpen(renewalYear, now), stopped: record.status !== 'active',
      interval: record.interval || 'month', items: await pricedLines(record, renewalYear, now) };
  };

  /** The subscription an emailed link is for, with what the member sees, or a refusal. */
  const linked = async (key, now) => {
    const parts = await resolvePaymentLink(db(), key, 'continuation');
    const document = parts ? await subscriptions().doc(parts.id).get() : null;
    const record = document?.data();
    if (!record?.continuation || record.continuation.tokenHash !== parts.tokenHash || suppressesNormalEmail(record)) {
      return { refusal: { status: 404, error: 'This link is not valid. Use the link in your latest email.' } };
    }
    return { document, record, view: await viewOf(record, now) };
  };

  /**
   * Records a payer's answer: Cancel ends the subscription at 1 March in Stripe; confirming afterwards undoes that.
   * Returns the HTTP status and what to show.
   */
  const answer = async ({ document, record, view }, wanted, now) => {
    if (!view.open) {
      return [409, { code: 'continuation_closed', ...view, error: view.stopped ? 'These payments have already stopped.'
        : `Answers closed when the club year started on 1 March. To stop your subscription now, use My details or email ${contact}.` }];
    }
    if (view.status === wanted) return [200, view];
    const end = Math.floor(clubYearDates(view.renewalYear).start.getTime() / 1000);
    // Items a volunteer benefit already removed keep their own end; only what is still charged changes.
    const current = activeSubscriptionItems(record);
    const changing = new Set(current.map((item) => `${item.orderRef || record.orderRef}/${item.lineId}`));
    const members = (record.membershipIds || []).length ? await db().getAll(...record.membershipIds.map((id) => db().collection('memberships').doc(id))) : [];
    if (wanted === 'confirmed' && record.cancelAt) {
      // Undoing a cancellation would charge twice for anything bought again for next club year since, on another
      // subscription or as a one-off (a staff credit, or a free volunteer price).
      const entitlements = await loadEntitlements(db(), members.filter((member) => member.exists).map((member) => member.id));
      const rebought = current.find((item) => members.some((member) => (item.membershipIds || []).includes(member.id)
        && holdsSubscriptionFrom({ entitlements: entitlements.get(member.id) || [],
          subscriptionItems: (member.data()?.subscriptionItems || []).filter((other) => other.subscriptionId !== document.id) }, item.productId, view.renewalYear)));
      if (rebought) {
        return [409, { code: 'continuation_replaced', ...view, error: `${rebought.name} has been bought again since this subscription was cancelled, so it stays cancelled. Please email ${contact} if that is not right.` }];
      }
    }
    const live = await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
    // A schedule (a volunteer's pending change) or an end set by staff would be overwritten, so those go to the treasurer.
    if (live.schedule || (live.cancel_at && live.cancel_at !== end) || (wanted === 'confirmed' && !live.cancel_at && record.cancelAt)) {
      return [409, { code: 'continuation_review', ...view, error: `This subscription has another change waiting. Please email ${contact} to ${wanted === 'cancelled' ? 'cancel' : 'keep'} it.` }];
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
      items: (record.items || []).map((item) => changing.has(`${item.orderRef || record.orderRef}/${item.lineId}`) ? { ...item, endsAt } : item) });
    const latest = members.length ? await db().getAll(...members.map((member) => member.ref)) : [];
    for (const member of latest.filter((entry) => entry.exists)) {
      batch.update(member.ref, { subscriptionItems: (member.data().subscriptionItems || []).map((item) => item.subscriptionId === document.id && item.status === 'active'
        && changing.has(`${item.orderRef}/${item.lineId}`) ? { ...item, endsAt } : item) });
    }
    batch.set(db().collection('auditLog').doc(), auditEntry({ kind: 'subscription', action: wanted === 'cancelled' ? 'member-cancel-at-year-end' : 'member-continue',
      reason: wanted === 'cancelled' ? 'The payer cancelled from the renewal email' : 'The payer confirmed from the renewal email',
      actor: record.email, at, stripeSubscriptionId: document.id, renewalYear: view.renewalYear }));
    await batch.commit();
    if (wanted === 'cancelled') {
      await sendEmail({ to: record.email, subject: 'Your Forth Canoe Club subscription stops at the end of February',
        body: [continuationResult(wanted, view.renewalYear), '', ...view.items.map((item) => `- ${item.name}${item.names.length ? ` (${item.names.join(', ')})` : ''}: ${item.price}`), '',
          `Changed your mind? Use the Confirm button in your email before 1 March, or email ${contact}.`, '', 'Forth Canoe Club'].join('\n'),
        record: { kind: 'subscription-continuation-answer', subscriptionId: document.id, renewalYear: view.renewalYear } })
        .catch((error) => console.error('Could not confirm the cancellation by email:', error.message));
    }
    return [200, { ...view, status: wanted, message: continuationResult(wanted, view.renewalYear) }];
  };

  /**
   * Confirms a subscription for Confirm all in a renewal email. One the payer cancelled stays cancelled: only its own
   * Confirm button undoes that. A refusal (closed, another change waiting) is returned, not thrown.
   */
  const confirm = async (id, now) => {
    const document = await subscriptions().doc(id).get();
    const record = document.data();
    if (!record?.continuation || suppressesNormalEmail(record)) return [404, { error: 'This subscription could not be found.' }];
    const shown = await viewOf(record, now);
    if (shown.status === 'cancelled') return [200, shown];
    return answer({ document, record, view: shown }, 'confirmed', now);
  };

  /** What Confirm all shows for a subscription, or null. */
  const view = async (id, now) => {
    const record = (await subscriptions().doc(id).get()).data();
    return record?.continuation && !suppressesNormalEmail(record) ? viewOf(record, now) : null;
  };

  app.get('/api/subscription-continuation/:key', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const { refusal, view: shown } = await linked(String(req.params.key), requestNow(req));
      if (refusal) return res.status(refusal.status).json(refusal);
      res.json(shown);
    } catch (error) {
      console.error('Could not load a continue/cancel link:', error.message);
      res.status(500).json({ error: 'Could not load your subscription. Please try again.' });
    }
  });

  app.post('/api/subscription-continuation/:key', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const wanted = ANSWERS[req.body?.answer];
      if (!wanted) return res.status(400).json({ error: 'Choose confirm or cancel.' });
      const now = requestNow(req);
      const loaded = await linked(String(req.params.key), now);
      if (loaded.refusal) return res.status(loaded.refusal.status).json(loaded.refusal);
      const [status, body] = await answer(loaded, wanted, now);
      res.status(status).json(body);
    } catch (error) {
      console.error('Could not record a continue/cancel answer:', error.message);
      res.status(500).json({ error: `Could not save your answer. Please try again or email ${contact}.` });
    }
  });

  return { send, summary, forPayer, confirm, view };
};
