import { Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './rateLimit.js';
import { DEFAULT_REGULAR_SESSIONS, sortRegularSessions, validateRegularSessions } from '../utils/regularSessions.js';

export const registerRegularSessionRoutes = (app, { requireAdmin, db }) => {
  const reference = () => db().collection('settings').doc('regularSessions');
  const loadSessions = async () => {
    const snapshot = await reference().get();
    if (!snapshot.exists) return DEFAULT_REGULAR_SESSIONS;
    const result = validateRegularSessions({ sessions: snapshot.data().sessions });
    if (result.error) throw new Error(`Saved regular-session schedule is invalid: ${result.error}`);
    return result.value;
  };

  app.get('/api/regular-sessions', rateLimit(60, 60 * 1000), async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!db()) return res.status(503).json({ error: 'The regular-session timetable is not available right now.' });
      res.json({ sessions: sortRegularSessions((await loadSessions()).filter((session) => session.active)) });
    } catch (error) {
      console.error('Could not load regular-session timetable:', error.message);
      res.status(500).json({ error: 'Could not load the regular-session timetable.' });
    }
  });

  app.get('/api/admin/regular-sessions', rateLimit(30, 60 * 1000), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'The regular-session timetable is not available right now.' });
      res.json({ sessions: sortRegularSessions(await loadSessions()) });
    } catch (error) {
      console.error('Could not load regular-session settings:', error.message);
      res.status(500).json({ error: 'Could not load regular-session settings.' });
    }
  });

  app.put('/api/admin/regular-sessions', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'The regular-session timetable is not available right now.' });
      const result = validateRegularSessions(req.body);
      if (result.error) return res.status(400).json({ error: result.error });
      const sessions = sortRegularSessions(result.value);
      await reference().set({ sessions, updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid });
      res.json({ sessions });
    } catch (error) {
      console.error('Could not save regular-session settings:', error.message);
      res.status(500).json({ error: 'Could not save regular-session settings.' });
    }
  });
};
