import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_WELCOME_EMAIL, renderWelcomeEmail, sampleWelcomeValues, validateWelcomeDoc, validateWelcomeSubject, welcomeValuesFor } from '../utils/welcomeEmail.js';
import { rateLimit } from './rateLimit.js';

const MAX_FAILURES = 3;
const SENDING_MS = 5 * 60 * 1000;
// JustGo can record a website purchase days later with its own expiry date; that is not a new term to welcome.
const RECENT_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The welcome email sent once per membership term to new and renewing members. Website checkout and the JustGo sync
 * both set `welcomeEmailDue` on the membership; checkout sends straight away and the scheduled job picks up the rest.
 * `welcomeEmail.sentFor` holds the term (validUntil) last welcomed, so retries and repeat syncs never send twice.
 */
export const registerWelcomeEmailRoutes = (app, { requireAdmin, db, sendEmail, attention }) => {
  const reference = () => db().collection('settings').doc('welcomeEmail');
  const memberships = () => db().collection('memberships');

  const loadTemplate = async () => {
    const data = (await reference().get()).data();
    return data ? { enabled: data.enabled === true, subject: data.subject, doc: data.doc } : { ...DEFAULT_WELCOME_EMAIL };
  };
  const adminView = async () => {
    const data = (await reference().get()).data() || {};
    const template = data.doc ? data : DEFAULT_WELCOME_EMAIL;
    return { enabled: template.enabled === true, subject: template.subject, doc: template.doc,
      updatedAt: data.updatedAt?.toMillis?.() || 0, updatedBy: data.updatedBy || '' };
  };
  const validated = (body = {}) => {
    const subject = validateWelcomeSubject(body.subject);
    if (subject instanceof Error) return subject;
    const doc = validateWelcomeDoc(body.doc);
    if (doc instanceof Error) return doc;
    return { subject, doc };
  };

  const recipientFor = async (member) => {
    if (member.email) return member.email;
    if (!member.householdId) return '';
    return (await db().collection('households').doc(member.householdId).get()).data()?.email || '';
  };

  /** Claims, sends and records one member's welcome email. Never throws. */
  const sendOne = async (memberReference, template) => {
    const now = Timestamp.now();
    let claimed = null;
    try {
      claimed = await db().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(memberReference);
        const member = snapshot.data();
        if (!member?.welcomeEmailDue) return null;
        const term = member.validUntil?.toMillis?.() || 0;
        const done = (reason) => {
          transaction.update(memberReference, { welcomeEmailDue: false, 'welcomeEmail.skippedAt': now, 'welcomeEmail.skippedReason': reason });
          return null;
        };
        if (!template.enabled) return done('The welcome email was switched off.');
        if (String(member.status).toLowerCase() !== 'active' || !term) return done('The membership was not active.');
        if (member.welcomeEmail?.sentFor === term) return done('Already welcomed for this membership term.');
        if (Date.now() - (member.welcomeEmail?.sentAt?.toMillis() || 0) < RECENT_MS) return done('Welcomed recently.');
        if (member.welcomeEmail?.sendingUntil?.toMillis() > Date.now()) return null;
        transaction.update(memberReference, { 'welcomeEmail.sendingUntil': Timestamp.fromMillis(Date.now() + SENDING_MS) });
        return { member, term };
      });
      if (!claimed) return false;
      const to = await recipientFor(claimed.member);
      if (!to) throw new Error('The member has no contact email address.');
      const email = renderWelcomeEmail(template, welcomeValuesFor(claimed.member));
      if (!await sendEmail({ to, ...email, record: { kind: 'welcome-email', membershipId: memberReference.id } })) throw new Error('Email sending is not configured.');
      await memberReference.update({ welcomeEmailDue: false, 'welcomeEmail.sentFor': claimed.term, 'welcomeEmail.sentAt': Timestamp.now(),
        'welcomeEmail.sentTo': to, 'welcomeEmail.sendingUntil': null, 'welcomeEmail.failures': 0 });
      await attention.settle('welcome-email', memberReference.id);
      return true;
    } catch (error) {
      console.error('Could not send the welcome email to %s: %s', memberReference.id, error.message);
      if (!claimed) return false;
      const failures = (claimed.member.welcomeEmail?.failures || 0) + 1;
      // Left due so the next run retries, until it has failed too often to keep trying.
      await memberReference.update({ 'welcomeEmail.sendingUntil': null, 'welcomeEmail.failures': FieldValue.increment(1),
        ...(failures >= MAX_FAILURES ? { welcomeEmailDue: false } : {}) }).catch(() => {});
      await attention.raise('welcome-email', memberReference.id, { alert: failures >= MAX_FAILURES,
        detail: `The welcome email for membership ${memberReference.id} could not be sent (attempt ${failures}): ${error.message}${failures >= MAX_FAILURES ? ' The website has stopped retrying.' : ' It will be retried.'}` });
      return false;
    }
  };

  /** Sends every due welcome email, or only those for `membershipIds` (straight after a checkout). */
  const sendDueWelcomeEmails = async ({ membershipIds } = {}) => {
    if (!db()) return { sent: 0 };
    const template = await loadTemplate();
    const references = membershipIds
      ? [...new Set(membershipIds)].filter(Boolean).map((id) => memberships().doc(id))
      : (await memberships().where('welcomeEmailDue', '==', true).limit(200).get()).docs.map((document) => document.ref);
    let sent = 0;
    for (const memberReference of references) if (await sendOne(memberReference, template)) sent += 1;
    return { sent, checked: references.length };
  };

  app.get('/api/admin/welcome-email', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Settings storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      res.json(await adminView());
    } catch (error) {
      console.error('Could not load welcome email settings:', error.message);
      res.status(500).json({ error: 'Could not load the welcome email.' });
    }
  });

  app.post('/api/admin/welcome-email', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Settings storage is not configured.' });
      const template = validated(req.body);
      if (template instanceof Error) return res.status(400).json({ error: template.message });
      await reference().set({ ...template, enabled: req.body.enabled === true, updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, ...await adminView() });
    } catch (error) {
      console.error('Could not save welcome email settings:', error.message);
      res.status(500).json({ error: 'Could not save the welcome email.' });
    }
  });

  // Sends the unsaved draft to the signed-in admin with sample details, so it can be checked before saving.
  app.post('/api/admin/welcome-email/test', rateLimit(5, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!admin.email) return res.status(400).json({ error: 'Your admin account has no email address.' });
      const template = validated(req.body);
      if (template instanceof Error) return res.status(400).json({ error: template.message });
      const email = renderWelcomeEmail(template, sampleWelcomeValues());
      if (!await sendEmail({ to: admin.email, ...email, subject: `[Test] ${email.subject}`, record: { kind: 'welcome-email-test' } })) {
        return res.status(503).json({ error: 'Email sending is not configured.' });
      }
      res.json({ success: true, sentTo: admin.email });
    } catch (error) {
      console.error('Could not send a test welcome email:', error.message);
      res.status(500).json({ error: 'Could not send the test email.' });
    }
  });

  /** Scheduled job (fcc-welcome-emails, after the daily JustGo sync), authorised by RENEWAL_JOB_TOKEN like the renewals job. */
  app.post('/api/jobs/welcome-emails', rateLimit(5, 60 * 1000), async (req, res) => {
    try {
      const expected = process.env.RENEWAL_JOB_TOKEN || '';
      const given = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      if (expected.length < 32 || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
        return res.status(401).json({ error: 'Job authentication required.' });
      }
      res.json(await sendDueWelcomeEmails());
    } catch (error) {
      console.error('Welcome email job failed:', error.message);
      res.status(500).json({ error: 'Welcome email job failed.' });
    }
  });

  return { sendDueWelcomeEmails };
};
