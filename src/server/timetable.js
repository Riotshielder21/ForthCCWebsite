import { Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_TIMETABLE, publicTimetable, validateTimetable } from '../utils/timetable.js';
import { timetableCalendar } from '../utils/timetableCalendar.js';
import { rateLimit } from './rateLimit.js';

/**
 * The club's regular weekly sessions, kept in a private settings document separate from check-in sessions
 * (settings/clubNight), so editing the public timetable never changes who can check in.
 */
export const registerTimetableRoutes = (app, { requireAdmin, db }) => {
  const reference = () => db().collection('settings').doc('timetable');
  const adminView = (data = {}) => {
    const result = validateTimetable(data.sessions === undefined ? DEFAULT_TIMETABLE : data.sessions);
    if (result.error) throw new Error(`Saved timetable is invalid: ${result.error}`);
    return {
      sessions: result.value,
      updatedAt: data.updatedAt?.toMillis?.() || 0,
      updatedBy: data.updatedBy || ''
    };
  };

  const calendarExport = (single) => async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'The timetable is not available.' });
      const { sessions, updatedAt } = adminView((await reference().get()).data());
      const session = sessions.find((item) => item.id === req.params.id && item.active);
      if (!session) return res.status(404).json({ error: 'This timetable session is not available.' });
      res.set('Cache-Control', 'no-cache, max-age=0, must-revalidate');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Content-Type', 'text/calendar; charset=utf-8');
      res.set('Content-Disposition', `inline; filename="forth-canoe-club-${session.id}${single ? '-next' : ''}.ics"`);
      res.send(timetableCalendar(session, { single, updatedAt }));
    } catch (error) {
      console.error(`Could not create ${single ? 'next-session' : 'subscription'} calendar:`, error.message);
      res.status(500).json({ error: 'Could not create this calendar export.' });
    }
  };

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

  app.get('/api/timetable/:id/next.ics', rateLimit(60, 60 * 1000), calendarExport(true));
  app.get('/api/timetable/:id.ics', rateLimit(60, 60 * 1000), calendarExport(false));

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
