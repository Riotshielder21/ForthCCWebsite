import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { hasKeyAccess } from '../utils/keyAccess.js';
import { BOATHOUSE_ACCESS_POINTS, boathouseAccessFromSettings } from '../utils/boathouse.js';
import { rateLimit } from './rateLimit.js';

export const registerKeyAccessRoutes = (app, { requireAdmin, db, sendEmail }) => {
  const settleKeyAccess = async (reference, code = null) => {
    const member = (await reference.get()).data();
    if (!hasKeyAccess(member)) return 'not-active';
    const settings = code || (await db().collection('settings').doc('boathouseCode').get()).data() || {};
    if (!settings.version) return 'no-code';
    if (member.keyAccess?.sentVersion === settings.version) return 'up-to-date';
    const household = member.householdId ? (await db().collection('households').doc(member.householdId).get()).data() : null;
    const email = household?.email || member.email || member.guardian?.email;
    if (!email) {
      console.error('Key access codes not sent: member has no contact email:', reference.id);
      return 'not-sent';
    }
    const access = boathouseAccessFromSettings(settings);
    const deliveryId = randomUUID();
    const claimed = await db().runTransaction(async (transaction) => {
      const current = (await transaction.get(reference)).data();
      if (!hasKeyAccess(current)) return 'not-active';
      if (current.keyAccess?.sentVersion >= settings.version) return 'up-to-date';
      if (current.keyAccess?.delivery?.until?.toMillis() > Date.now()) return 'in-progress';
      transaction.update(reference, { 'keyAccess.delivery': { id: deliveryId, until: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000) } });
      return 'claimed';
    });
    if (claimed !== 'claimed') return claimed;
    const finish = async (sent) => db().runTransaction(async (transaction) => {
      const current = (await transaction.get(reference)).data();
      if (current?.keyAccess?.delivery?.id !== deliveryId) return;
      transaction.update(reference, { 'keyAccess.delivery': null,
        ...(sent ? { 'keyAccess.sentVersion': settings.version, 'keyAccess.sentAt': Timestamp.now() } : {}) });
    });
    try {
      const sent = await sendEmail({
        to: email, subject: 'Forth Canoe Club boathouse access codes',
        body: [`Hi ${member.firstName || member.name || 'member'},`, '',
          member.keyAccess?.sentVersion ? 'The boathouse codes have changed. Here are the current codes for your key access:'
            : 'Here are the current boathouse codes for your key access:', '',
          ...BOATHOUSE_ACCESS_POINTS.flatMap(({ key, label }) => [
            `${label} code: ${access[`${key}Code`] || 'Not yet set'}`,
            ...(access[`${key}Note`] ? [access[`${key}Note`]] : []), ''
          ]),
          'Please keep these codes private.',
          'For help, contact secretary@forthcanoeclub.co.uk.'].join('\n'),
        record: { kind: 'boathouse-code', membershipId: reference.id,
          ...(member.volunteer?.signupId ? { signupId: member.volunteer.signupId } : {}), version: settings.version }
      });
      await finish(sent);
      if (!sent) {
        console.error('Key access email delivery was unsuccessful:', reference.id);
        return 'not-sent';
      }
      return 'sent';
    } catch (error) {
      console.error('Could not email key access codes:', reference.id, error.message);
      await finish(false);
      return 'not-sent';
    }
  };

  const notifyKeyAccess = async () => {
    const code = (await db().collection('settings').doc('boathouseCode').get()).data() || {};
    let cursor = null;
    const result = { sent: 0, failed: 0 };
    do {
      let query = db().collection('memberships').orderBy('__name__').limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const document of page.docs) {
        const outcome = await settleKeyAccess(document.ref, code);
        if (outcome === 'sent') result.sent += 1;
        if (outcome === 'not-sent' || outcome === 'in-progress') result.failed += 1;
      }
      cursor = page.size === 200 ? page.docs.at(-1) : null;
    } while (cursor);
    return result;
  };

  app.post('/api/admin/memberships/:id/key-access', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Membership storage is not configured.' });
      const { action, reason } = req.body || {};
      if (!['grant', 'revoke'].includes(action) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000
        || !/^[\w-]{1,128}$/.test(req.params.id)) return res.status(400).json({ error: 'Choose grant or revoke and give a reason (up to 1000 characters).' });
      const reference = db().collection('memberships').doc(req.params.id);
      await db().runTransaction(async (transaction) => {
        const document = await transaction.get(reference);
        if (!document.exists) throw Object.assign(new Error('Member not found.'), { status: 404 });
        const at = Timestamp.now();
        const by = admin.email || admin.uid;
        transaction.update(reference, { keyAccess: { ...document.data().keyAccess,
          ...(action === 'grant' ? { grantedAt: at, source: 'admin', revokedAt: null, sentVersion: 0 }
            : { revokedAt: at }), reason: reason.trim(), by } });
        transaction.set(db().collection('adminItemAudit').doc(), { action: `key-access-${action}`,
          membershipId: document.id, reason: reason.trim(), by, at });
      });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, delivery: action === 'grant' ? await settleKeyAccess(reference) : 'revoked' });
    } catch (error) {
      if (error.status === 404) return res.status(404).json({ error: error.message });
      console.error('Could not change key access:', error.message);
      res.status(500).json({ error: 'Could not change key access.' });
    }
  });
  return { settleKeyAccess, notifyKeyAccess };
};
