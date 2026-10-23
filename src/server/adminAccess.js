import { Timestamp } from 'firebase-admin/firestore';
import { validateAdminChange, adminCandidateProblem, isClubEmail } from '../utils/adminAccess.js';
import { rateLimit } from './rateLimit.js';

/** Lets existing admins approve or remove other admins by setting the Firebase `admin` custom claim. */
export const registerAdminAccessRoutes = (app, { requireAdmin, auth, db, localFirebase = false }) => {
  const summary = (user) => ({
    uid: user.uid, email: user.email || '', name: user.displayName || '',
    lastSignIn: user.metadata?.lastSignInTime ? Date.parse(user.metadata.lastSignInTime) : 0
  });

  app.get('/api/admin/admins', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!auth()) return res.status(503).json({ error: 'Admin accounts are not configured.' });
      const admins = [];
      let pageToken;
      do {
        const page = await auth().listUsers(1000, pageToken);
        for (const user of page.users) if (user.customClaims?.admin === true && isClubEmail(user.email)) admins.push(summary(user));
        pageToken = page.pageToken;
      } while (pageToken);
      res.set('Cache-Control', 'no-store');
      res.json({ admins: admins.sort((a, b) => a.email.localeCompare(b.email)) });
    } catch (error) {
      console.error('Could not list admins:', error.message);
      res.status(500).json({ error: 'Could not load admins.' });
    }
  });

  app.post('/api/admin/admins', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!auth()) return res.status(503).json({ error: 'Admin accounts are not configured.' });
      const { error, value } = validateAdminChange(req.body, admin.email);
      if (error) return res.status(400).json({ error });
      res.set('Cache-Control', 'no-store');

      let user = null;
      try { user = await auth().getUserByEmail(value.email); }
      catch (lookupError) { if (lookupError.code !== 'auth/user-not-found') throw lookupError; }

      if (value.action === 'grant') {
        const problem = adminCandidateProblem(user, { allowPasswordAccounts: localFirebase });
        if (problem) return res.status(user ? 400 : 404).json({ error: problem });
      } else if (user?.customClaims?.admin !== true) {
        return res.status(404).json({ error: 'That account is not an admin.' });
      }

      const { admin: _previous, ...otherClaims } = user.customClaims || {};
      await auth().setCustomUserClaims(user.uid, value.action === 'grant' ? { ...otherClaims, admin: true } : otherClaims);
      // Signs a removed admin out everywhere; requireAdmin checks revocation so their API access ends now.
      if (value.action === 'revoke') await auth().revokeRefreshTokens(user.uid);

      if (db()) {
        await db().collection('adminAccessAudit').add({
          action: value.action, email: value.email, uid: user.uid, by: admin.email || admin.uid, at: Timestamp.now()
        }).catch((auditError) => console.error('Admin access changed but not audited:', auditError.message));
      }
      res.json({ success: true, action: value.action, admin: summary(user) });
    } catch (error) {
      console.error('Could not change admin access:', error.message);
      res.status(500).json({ error: 'Could not change admin access.' });
    }
  });
};
