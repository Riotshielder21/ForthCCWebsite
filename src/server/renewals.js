import crypto from 'crypto';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { clubYearDates } from '../utils/clubYear.js';
import { ageOn } from '../utils/checkout.js';
import { needsRenewal, renewalBasket, renewalChoice, renewalEmail, renewalRound, renewalWindow } from '../utils/renewals.js';
import { rateLimit } from './rateLimit.js';
import { needsVolunteerRenewal } from '../utils/volunteering.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const normaliseEmail = (value) => String(value || '').trim().toLowerCase();
const DAY = 24 * 60 * 60 * 1000;

/**
 * Renewal emails: one per contact address with a link that fills the basket with next year's membership and the
 * services and subscriptions held this year. Staff can send them from 1 January. The scheduled job sends on 1 February
 * to anyone not yet emailed and a reminder on 15 February to anyone not yet reminded; members who have renewed are
 * never emailed. Links are random tokens stored hashed in `renewalInvites` and expire after 31 March.
 */
const SENT = 'renewalInviteSentFor';
const REMINDED = 'renewalReminderSentFor';
export const registerRenewalRoutes = (app, { requireAdmin, db, loadCatalogue, sendEmail, siteUrl, requestNow, volunteerRenewalContent, sendVolunteerRenewals }) => {
  const memberships = () => db().collection('memberships');

  /** Members needing renewal grouped by contact email; `onlyUnsent` leaves out anyone whose `field` already has this year. */
  const renewalGroups = async (now, { onlyUnsent = false, membershipId = '', field = SENT } = {}) => {
    const window = renewalWindow(now);
    const snapshot = await memberships().where('validUntil', '>', Timestamp.fromDate(now))
      .where('validUntil', '<=', Timestamp.fromMillis(window.closes.getTime() + DAY)).get();
    const members = snapshot.docs.map((document) => ({ ...document.data(), id: document.id })).filter((member) => needsRenewal(member, now));
    const householdIds = [...new Set(members.map((member) => member.householdId).filter(Boolean))];
    const households = new Map(householdIds.length
      ? (await db().getAll(...householdIds.map((id) => db().collection('households').doc(id)))).filter((document) => document.exists).map((document) => [document.id, document.data()])
      : []);
    const groups = new Map();
    for (const member of members) {
      const email = normaliseEmail(households.get(member.householdId)?.email || member.email || member.guardian?.email);
      if (!email) continue;
      if (!groups.has(email)) groups.set(email, []);
      groups.get(email).push(member);
    }
    const done = (member) => (member[field] || []).includes(window.renewalYear);
    const sent = (member) => (member[SENT] || []).includes(window.renewalYear);
    return [...groups].map(([email, group]) => ({ email, members: onlyUnsent ? group.filter((member) => !done(member)) : group, sentCount: group.filter(sent).length, total: group.length }))
      .filter((group) => group.members.length && (!membershipId || group.members.some((member) => member.id === membershipId)));
  };

  /**
   * Marks the group's members as sent in a transaction first, so overlapping runs never email anyone twice. A reminder
   * also counts as their first email if they never had one. A failed send undoes only the marks it added.
   */
  const sendGroup = async (group, now, catalog, { resend = false, reminder = false } = {}) => {
    const window = renewalWindow(now);
    const token = crypto.randomBytes(32).toString('hex');
    const invite = db().collection('renewalInvites').doc(hashToken(token));
    const field = reminder ? REMINDED : SENT;
    const has = (member, name) => (member[name] || []).includes(window.renewalYear);
    let added = [];
    const members = await db().runTransaction(async (transaction) => {
      const current = (await transaction.getAll(...group.members.map((member) => memberships().doc(member.id))))
        .filter((document) => document.exists).map((document) => ({ ...document.data(), id: document.id }))
        .filter((member) => needsRenewal(member, now) && (resend || !has(member, field)));
      if (!current.length) return [];
      added = current.map((member) => ({ id: member.id, fields: [...new Set([field, SENT])].filter((name) => !has(member, name)),
        volunteerMark: needsVolunteerRenewal(member, window.renewalYear)
          && !(member.volunteerRenewalSentFor || []).includes(`${window.renewalYear}:${reminder ? 'reminder' : 'first'}`) }));
      current.forEach((member) => transaction.update(memberships().doc(member.id), {
        [SENT]: FieldValue.arrayUnion(window.renewalYear), ...(reminder ? { [REMINDED]: FieldValue.arrayUnion(window.renewalYear) } : {}),
        ...(needsVolunteerRenewal(member, window.renewalYear) ? { volunteerRenewalSentFor: FieldValue.arrayUnion(`${window.renewalYear}:${reminder ? 'reminder' : 'first'}`) } : {}),
        renewalInviteSentAt: Timestamp.fromDate(now) }));
      transaction.create(invite, { email: group.email, renewalYear: window.renewalYear, membershipIds: current.map((member) => member.id),
        expiresAt: Timestamp.fromDate(window.expiresAt), createdAt: Timestamp.now() });
      return current;
    });
    if (!members.length) return 0;
    let index = 0;
    const basket = renewalBasket(members, catalog, window.clubYear, () => `r${++index}`);
    try {
      const volunteering = await volunteerRenewalContent(members, window.renewalYear, siteUrl());
      const email = renewalEmail({ ...basket, catalog, renewalYear: window.renewalYear, link: `${siteUrl()}/membership?renew=${token}`, expiresAt: window.expiresAt, reminder, volunteering });
      if (!await sendEmail({ to: group.email, ...email, record: { kind: 'renewal', membershipIds: members.map((member) => member.id) } })) throw new Error('Email is not configured.');
    } catch (error) {
      await Promise.all([invite.delete(), ...added.filter((entry) => entry.fields.length || entry.volunteerMark).map((entry) => memberships().doc(entry.id)
        .update({ ...Object.fromEntries(entry.fields.map((name) => [name, FieldValue.arrayRemove(window.renewalYear)])),
          ...(entry.volunteerMark ? { volunteerRenewalSentFor: FieldValue.arrayRemove(`${window.renewalYear}:${reminder ? 'reminder' : 'first'}`) } : {}) }))]);
      throw error;
    }
    return members.length;
  };

  const sendAll = async (now, options = {}) => {
    const catalog = await loadCatalogue();
    const reminder = options.round === 'reminder';
    const groups = await renewalGroups(now, { onlyUnsent: !options.membershipId, membershipId: options.membershipId, field: reminder ? REMINDED : SENT });
    let emails = 0, members = 0, failures = 0;
    for (const group of groups) {
      try {
        const count = await sendGroup(group, now, catalog, { resend: Boolean(options.membershipId), reminder });
        if (count) { emails += 1; members += count; }
      } catch (error) {
        failures += 1;
        console.error('Could not send a renewal email:', error.message);
      }
    }
    return { emails, members, failures };
  };

  const adminRenewalsLimiter = rateLimit(30, 60 * 1000);
  const adminRenewalsSendLimiter = rateLimit(5, 60 * 1000);
  app.get('/api/admin/renewals', adminRenewalsLimiter, async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const now = requestNow(req);
      const window = renewalWindow(now);
      const groups = await renewalGroups(now);
      res.set('Cache-Control', 'no-store');
      res.json({ renewalYear: window.renewalYear, opens: window.opens.getTime(), scheduledFrom: window.scheduledFrom.getTime(), reminderFrom: window.reminderFrom.getTime(), closes: window.closes.getTime(),
        open: now >= window.opens, contacts: groups.length, members: groups.reduce((sum, group) => sum + group.total, 0),
        unsentContacts: groups.filter((group) => group.sentCount < group.total).length });
    } catch (error) {
      console.error('Could not load renewals:', error.message);
      res.status(500).json({ error: 'Could not load renewals.' });
    }
  });

  /** Sends to everyone not yet emailed, or with `membershipId` (re)sends the email for that member's contact address. */
  app.post('/api/admin/renewals/send', adminRenewalsSendLimiter, async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const now = requestNow(req);
      if (now < renewalWindow(now).opens) return res.status(400).json({ code: 'renewals_closed', error: 'Renewal emails can be sent from 1 January.' });
      const membershipId = typeof req.body?.membershipId === 'string' ? req.body.membershipId.slice(0, 128) : '';
      res.json(await sendAll(now, { membershipId }));
    } catch (error) {
      console.error('Could not send renewal emails:', error.message);
      res.status(500).json({ error: 'Could not send renewal emails.' });
    }
  });

  /**
   * The scheduled job (config/fcc-renewals.timer, on 1 and 15 February), authorised by RENEWAL_JOB_TOKEN. From 1 February
   * it sends the first email to anyone not yet emailed; from 15 February the reminder to anyone not yet reminded. Running it
   * again in the same round sends nothing new. Outside February it does nothing.
   */
  app.post('/api/jobs/renewals', rateLimit(5, 60 * 1000), async (req, res) => {
    try {
      const expected = process.env.RENEWAL_JOB_TOKEN || '';
      const given = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      if (expected.length < 32 || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
        return res.status(401).json({ error: 'Job authentication required.' });
      }
      const now = requestNow(req);
      const round = renewalRound(now);
      if (!round) return res.json({ emails: 0, members: 0, failures: 0, waiting: true });
      const result = await sendAll(now, { round });
      const volunteers = await sendVolunteerRenewals(now, round, siteUrl());
      res.json({ round, ...result, volunteerEmails: volunteers.emails, volunteerFailures: volunteers.failures });
    } catch (error) {
      console.error('Renewal job failed:', error.message);
      res.status(500).json({ error: 'Renewal job failed.' });
    }
  });

  /** The basket a renewal link fills. Members who have since renewed are left out. */
  app.get('/api/renewals/:token', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const token = String(req.params.token || '');
      if (!/^[a-f0-9]{64}$/.test(token)) return res.status(404).json({ error: 'This renewal link is not valid.' });
      const now = requestNow(req);
      const document = await db().collection('renewalInvites').doc(hashToken(token)).get();
      const invite = document.data();
      if (!invite || invite.expiresAt.toMillis() <= now.getTime()) return res.status(404).json({ code: 'renewal_expired', error: 'This renewal link has expired. Add your membership to the basket instead.' });
      const choice = renewalChoice(invite.renewalYear, now);
      if (!choice) return res.status(404).json({ code: 'renewal_expired', error: 'This renewal link has expired. Add your membership to the basket instead.' });
      const renewedBy = clubYearDates(invite.renewalYear).end.getTime();
      const members = (await db().getAll(...invite.membershipIds.map((id) => memberships().doc(id))))
        .filter((member) => member.exists).map((member) => ({ ...member.data(), id: member.id }))
        .filter((member) => !(member.clubYears || []).includes(invite.renewalYear) && !((member.validUntil?.toMillis() || 0) >= renewedBy));
      if (!members.length) return res.status(410).json({ code: 'renewal_done', error: 'Everyone on this renewal link has already renewed.' });
      let index = 0;
      const basket = renewalBasket(members, await loadCatalogue(), invite.renewalYear - 1, () => `renew-${++index}`);
      res.json({ email: invite.email, renewalYear: invite.renewalYear, clubYearChoice: choice, billingMode: basket.billingMode,
        items: basket.items.map((item) => ({ ...item, clubYearChoice: choice })),
        people: basket.people.map(({ membershipId: _membershipId, ...person }) => ({ ...person, junior: (ageOn(person.dob, now) ?? 18) < 18 })) });
    } catch (error) {
      console.error('Could not load a renewal link:', error.message);
      res.status(500).json({ error: 'Could not load this renewal link.' });
    }
  });
};
