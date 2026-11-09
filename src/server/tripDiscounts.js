import { Timestamp } from 'firebase-admin/firestore';
import { TRIP_DISCOUNT_CATEGORIES, lockedProductIds, tripDiscountRules, validateTripDiscounts } from '../utils/tripDiscount.js';
import { rateLimit } from './rateLimit.js';

/**
 * Admin-set discounts on single-day trips for holders of qualifying products, kept in a private settings document. The
 * public route gives the browser the same rules checkout charges with, so the basket shows the price Stripe collects.
 */
export const registerTripDiscountRoutes = (app, { requireAdmin, db, loadCatalogue }) => {
  const reference = () => db().collection('settings').doc('tripDiscounts');
  const loadTripDiscounts = async () => tripDiscountRules((await reference().get()).data());

  app.get('/api/trip-discounts', rateLimit(60, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Trip discounts are not configured.' });
      res.set('Cache-Control', 'no-store');
      res.json({ rules: await loadTripDiscounts() });
    } catch (error) {
      console.error('Could not load trip discounts:', error.message);
      res.status(500).json({ error: 'Could not load trip discounts.' });
    }
  });

  const adminView = async (data) => ({
    rules: tripDiscountRules(data),
    products: (await loadCatalogue()).filter((product) => TRIP_DISCOUNT_CATEGORIES.includes(product.category))
      .map(({ id, name, category }) => ({ id, name, category })),
    updatedAt: data?.updatedAt?.toMillis?.() || 0, updatedBy: data?.updatedBy || ''
  });

  app.get('/api/admin/trip-discounts', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Settings storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      res.json(await adminView((await reference().get()).data()));
    } catch (error) {
      console.error('Could not load trip discount settings:', error.message);
      res.status(500).json({ error: 'Could not load trip discounts.' });
    }
  });

  app.put('/api/admin/trip-discounts', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Settings storage is not configured.' });
      const { error, value } = validateTripDiscounts(req.body?.rules, await loadCatalogue());
      if (error) return res.status(400).json({ error });
      // productIds is what firestore.rules reads to stop these products being removed from the shop.
      const next = { rules: value, productIds: lockedProductIds(value), updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid };
      await reference().set(next);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, ...await adminView(next) });
    } catch (error) {
      console.error('Could not save trip discounts:', error.message);
      res.status(500).json({ error: 'Could not save trip discounts.' });
    }
  });

  return { loadTripDiscounts };
};
