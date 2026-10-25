import { Timestamp } from 'firebase-admin/firestore';
import { boathouseAccessFromSettings, validateBoathouseCode } from '../utils/boathouse.js';
import { rateLimit } from './rateLimit.js';

/**
 * Boathouse access codes are kept in a private settings document (the Firestore rules deny browsers) and are only
 * read and changed through these admin routes. `version` goes up whenever any code changes.
 */
export const registerBoathouseRoutes = (app, { requireAdmin, db, onCodeChanged = async () => ({ sent: 0, failed: 0 }) }) => {
  const reference = () => db().collection('settings').doc('boathouseCode');
  const publicView = (data = {}) => ({
    ...boathouseAccessFromSettings(data), version: data.version || 0,
    updatedAt: data.updatedAt?.toMillis() || 0, updatedBy: data.updatedBy || ''
  });
  const boathouseCodeReadLimiter = rateLimit(30, 60 * 1000);
  const boathouseCodeWriteLimiter = rateLimit(10, 60 * 1000);

  app.get('/api/admin/boathouse-code', boathouseCodeReadLimiter, async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Boathouse code storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      res.json(publicView((await reference().get()).data()));
    } catch (error) {
      console.error('Could not load the boathouse code:', error.message);
      res.status(500).json({ error: 'Could not load the boathouse code.' });
    }
  });

  app.post('/api/admin/boathouse-code', boathouseCodeWriteLimiter, async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Boathouse code storage is not configured.' });
      const { error, value } = validateBoathouseCode(req.body);
      if (error) return res.status(400).json({ error });
      res.set('Cache-Control', 'no-store');
      const saved = await db().runTransaction(async (transaction) => {
        const current = (await transaction.get(reference())).data() || {};
        const previous = boathouseAccessFromSettings(current);
        const changed = ['gateCode', 'alarmCode', 'lockboxCode'].some((field) => previous[field] !== value[field]);
        const next = { ...value, version: (current.version || 0) + (changed ? 1 : 0), updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid };
        transaction.set(reference(), next);
        return { ...next, changed };
      });
      // A changed code sends all three codes to active volunteers; failures are retried on the next save or "Active" tick.
      let notified = { sent: 0, failed: 0 };
      if (saved.changed) {
        try { notified = await onCodeChanged(); }
        catch (notifyError) { console.error('Boathouse code saved but volunteers not notified:', notifyError.message); notified = { sent: 0, failed: 0, error: true }; }
      }
      res.json({ success: true, changed: saved.changed, notified, ...publicView(saved) });
    } catch (error) {
      console.error('Could not save the boathouse code:', error.message);
      res.status(500).json({ error: 'Could not save the boathouse code.' });
    }
  });
};
