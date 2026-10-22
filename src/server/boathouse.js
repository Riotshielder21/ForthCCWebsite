import { Timestamp } from 'firebase-admin/firestore';
import { validateBoathouseCode } from '../utils/boathouse.js';

/**
 * The boathouse access code is kept in a private settings document (the Firestore rules deny browsers) and is only
 * read and changed through these admin routes. `version` goes up whenever the code itself changes.
 */
export const registerBoathouseRoutes = (app, { rateLimit, requireAdmin, db, onCodeChanged = async () => ({ sent: 0, failed: 0 }) }) => {
  const reference = () => db().collection('settings').doc('boathouseCode');
  const publicView = (data = {}) => ({
    code: data.code || '', note: data.note || '', version: data.version || 0,
    updatedAt: data.updatedAt?.toMillis() || 0, updatedBy: data.updatedBy || ''
  });

  app.get('/api/admin/boathouse-code', rateLimit(30, 60 * 1000), async (req, res) => {
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

  app.post('/api/admin/boathouse-code', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Boathouse code storage is not configured.' });
      const { error, value } = validateBoathouseCode(req.body);
      if (error) return res.status(400).json({ error });
      res.set('Cache-Control', 'no-store');
      const saved = await db().runTransaction(async (transaction) => {
        const current = (await transaction.get(reference())).data() || {};
        const changed = current.code !== value.code;
        const next = { ...value, version: (current.version || 0) + (changed ? 1 : 0), updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid };
        transaction.set(reference(), next);
        return { ...next, changed };
      });
      // A changed code goes straight to every active volunteer; a failed email is retried on the next save or "Active" tick.
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
