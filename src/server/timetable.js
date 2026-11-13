import { Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_TIMETABLE, publicTimetable, validateTimetable } from '../utils/timetable.js';
import { rateLimit } from './rateLimit.js';

/**
 * The club's regular weekly sessions, kept in a private settings document separate from check-in sessions
 * (settings/clubNight), so editing the public timetable never changes who can check in.
 */
export const registerTimetableRoutes = (app, { requireAdmin, db }) => {
  const reference = () => db().collection('settings').doc('timetable');
  const adminView = (data = {}) => ({ sessions: Array.isArray(data.sessions) ? data.sessions : DEFAULT_TIMETABLE,
    updatedAt: data.updatedAt?.toMillis?.() || 0, updatedBy: data.updatedBy || '' });

  app.get('/api/timetable', rateLimit(60, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'The timetable is not available.' });
      res.set('Cache-Control', 'no-cache');
      res.json({ days: publicTimetable(adminView((await reference().get()).data()).sessions) });
    } catch (error) {
      console.error('Could not load the timetable:', error.message);
      res.status(500).json({ error: 'Could not load the timetable.' });
    }
  });

  app.get('/api/admin/timetable', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Settings storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      res.json(adminView((await reference().get()).data()));
    } catch (error) {
      console.error('Could not load timetable settings:', error.message);
      res.status(500).json({ error: 'Could not load the timetable.' });
    }
  });

  app.put('/api/admin/timetable', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Settings storage is not configured.' });
      const { error, value } = validateTimetable(req.body?.sessions);
      if (error) return res.status(400).json({ error });
      const next = { sessions: value, updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid };
      await reference().set(next);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, ...adminView(next) });
    } catch (error) {
      console.error('Could not save the timetable:', error.message);
      res.status(500).json({ error: 'Could not save the timetable.' });
    }
  });
};
