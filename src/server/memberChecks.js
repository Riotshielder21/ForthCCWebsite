import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { validateCheckUpdate, checkSummary } from '../utils/safeguarding.js';
import { rateLimit } from './rateLimit.js';

/** Admins record when a member's PVG and safeguarding training expire; the status is worked out from the date when read. */
export const registerMemberCheckRoutes = (app, { requireAdmin, db }) => {
  app.patch('/api/admin/memberships/:id/checks', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Member storage is not configured.' });
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.id)) return res.status(400).json({ error: 'Choose a membership.' });
      const { error, value } = validateCheckUpdate(req.body);
      if (error) return res.status(400).json({ error });
      const reference = db().collection('memberships').doc(req.params.id);
      if (!(await reference.get()).exists) return res.status(404).json({ error: 'Membership not found.' });
      const updatedBy = admin.email || admin.uid;
      await reference.update(Object.fromEntries(Object.entries(value).map(([type, expiresOn]) => [`checks.${type}`,
        expiresOn ? { expiresOn, updatedAt: Timestamp.now(), updatedBy } : FieldValue.delete()])));
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, checks: checkSummary((await reference.get()).data().checks) });
    } catch (saveError) {
      console.error('Could not save member checks:', saveError.message);
      res.status(500).json({ error: 'Could not save the PVG or safeguarding date.' });
    }
  });
};
