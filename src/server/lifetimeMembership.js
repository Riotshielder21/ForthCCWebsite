import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { auditEntry, REASON_REQUIRED, requiredReason } from '../utils/auditLog.js';
import { rateLimit } from './rateLimit.js';

/**
 * Turns a membership into a lifetime membership (no expiry, never renewed or expired by the JustGo sync), or back.
 * The previous expiry and status are kept so a mistaken grant can be undone exactly.
 */
export const registerLifetimeMembershipRoutes = (app, { requireAdmin, db }) => {
  app.post('/api/admin/memberships/:id/lifetime', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Membership storage is not configured.' });
      const { action, confirmation } = req.body || {};
      const reason = requiredReason(req.body);
      if (!/^[\w-]{1,128}$/.test(req.params.id) || !['grant', 'remove'].includes(action)) return res.status(400).json({ error: 'Choose to grant or remove lifetime membership.' });
      if (!reason) return res.status(400).json({ error: REASON_REQUIRED });
      if (confirmation !== req.params.id) return res.status(400).json({ error: `Type the member ID ${req.params.id} to confirm.` });
      const reference = db().collection('memberships').doc(req.params.id);
      await db().runTransaction(async (transaction) => {
        const document = await transaction.get(reference);
        if (!document.exists) throw Object.assign(new Error('Member not found.'), { status: 404 });
        const member = document.data();
        const at = Timestamp.now();
        if (action === 'grant') {
          if (member.lifetimeMembership) throw Object.assign(new Error('This is already a lifetime membership.'), { status: 409 });
          if (member.contactOnly) throw Object.assign(new Error('This is a contact record, not a membership.'), { status: 409 });
          transaction.update(reference, { status: 'active', validUntil: FieldValue.delete(), updatedAt: at,
            lifetimeMembership: { grantedAt: at, grantedBy: admin.email || admin.uid, reason,
              previousValidUntil: member.validUntil || null, previousStatus: member.status || '' } });
        } else {
          const lifetime = member.lifetimeMembership;
          if (!lifetime) throw Object.assign(new Error('This is not a lifetime membership.'), { status: 409 });
          transaction.update(reference, { lifetimeMembership: FieldValue.delete(), updatedAt: at,
            status: lifetime.previousStatus || 'active', validUntil: lifetime.previousValidUntil || FieldValue.delete() });
        }
        transaction.set(db().collection('auditLog').doc(), auditEntry({ kind: 'item', action: `lifetime-membership-${action}`, reason, actor: admin, at,
          membershipId: document.id }));
      });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      console.error('Could not change lifetime membership:', error.message);
      res.status(500).json({ error: 'Could not change lifetime membership.' });
    }
  });
};
