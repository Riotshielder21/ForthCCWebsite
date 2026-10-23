import { Timestamp } from 'firebase-admin/firestore';
import { normalizeReceiptPersonFields } from '../utils/receipt.js';
import { rateLimit } from './rateLimit.js';

/**
 * Which submitted person details confirmation emails include. Kept in a private settings document (the Firestore
 * rules deny browsers) and changed only by admins; the default is none.
 */
export const registerReceiptEmailRoutes = (app, { requireAdmin, db }) => {
  const reference = () => db().collection('settings').doc('receiptEmail');
  const publicView = (data = {}) => ({
    personFields: normalizeReceiptPersonFields(data.personFields),
    updatedAt: data.updatedAt?.toMillis?.() || 0, updatedBy: data.updatedBy || ''
  });

  /** Falls back to no extra details if the setting cannot be read, so a receipt is never blocked by it. */
  const loadReceiptPersonFields = async () => {
    if (!db()) return [];
    try { return publicView((await reference().get()).data()).personFields; }
    catch (error) {
      console.error('Could not load receipt email fields:', error.message);
      return [];
    }
  };

  app.get('/api/admin/receipt-email', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Settings storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      res.json(publicView((await reference().get()).data()));
    } catch (error) {
      console.error('Could not load receipt email settings:', error.message);
      res.status(500).json({ error: 'Could not load receipt email settings.' });
    }
  });

  app.post('/api/admin/receipt-email', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Settings storage is not configured.' });
      if (!Array.isArray(req.body?.personFields)) return res.status(400).json({ error: 'Choose which details to include.' });
      const next = { personFields: normalizeReceiptPersonFields(req.body.personFields), updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid };
      await reference().set(next);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, ...publicView(next) });
    } catch (error) {
      console.error('Could not save receipt email settings:', error.message);
      res.status(500).json({ error: 'Could not save receipt email settings.' });
    }
  });

  return { loadReceiptPersonFields };
};
