import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './rateLimit.js';

// What each kind of problem means for staff, and whether the website can safely redo it.
export const ATTENTION_KINDS = {
  'order-unrecorded': { title: 'Paid order not recorded', retry: true },
  'subscription-setup': { title: 'Monthly payments not set up', retry: true },
  'receipt-email': { title: 'Receipt email not sent', retry: true },
  'payment-failed': { title: 'Payment did not clear', retry: false },
  'invoice-failed': { title: 'Monthly debits failed and Stripe stopped retrying', retry: false },
  'subscription-ended': { title: 'Monthly payments ended unexpectedly', retry: false },
  'cancel-request': { title: 'Member asked to cancel monthly payments', retry: false },
  'discount-reused': { title: 'Single-use code used twice', retry: false }
};

const safeId = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);

/**
 * One open entry per problem: raising the same problem again updates it rather than adding another, and the club is
 * emailed only when the entry is first opened. A successful retry (or the problem clearing itself) settles it.
 */
export const createAttention = ({ db, sendEmail, alertEmail }) => {
  const collection = () => db().collection('attention');

  const raise = async (kind, key, { detail = '', orderRef = '', subscriptionId = '', email = '', alert = true, data = {} } = {}) => {
    if (!db() || !ATTENTION_KINDS[kind]) return;
    const reference = collection().doc(safeId(`${kind}-${key}`));
    const now = Timestamp.now();
    const opened = await db().runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (current.exists && current.data().open) {
        transaction.update(reference, { detail: String(detail).slice(0, 1000), lastSeenAt: now, occurrences: FieldValue.increment(1) });
        return false;
      }
      transaction.set(reference, { kind, key: String(key), title: ATTENTION_KINDS[kind].title, detail: String(detail).slice(0, 1000),
        orderRef, subscriptionId, email, data, open: true, createdAt: now, lastSeenAt: now, occurrences: 1,
        resolvedAt: null, resolvedBy: '', resolutionNote: '' });
      return true;
    });
    if (opened && alert && alertEmail) {
      const lines = [ATTENTION_KINDS[kind].title, '', detail, '',
        ...(orderRef ? [`Order: ${orderRef}`] : []), ...(subscriptionId ? [`Stripe subscription: ${subscriptionId}`] : []), ...(email ? [`Customer: ${email}`] : []),
        '', 'Review it under Reports & records → Needs attention.'];
      await sendEmail({ to: alertEmail, subject: `Website needs attention: ${ATTENTION_KINDS[kind].title}`, body: lines.join('\n'),
        record: { kind: 'staff-alert', attentionId: reference.id } }).catch((error) => console.error('Could not email staff alert:', error.message));
    }
  };

  const settle = async (kind, key, by = 'website', note = 'Resolved automatically.') => {
    if (!db()) return;
    const reference = collection().doc(safeId(`${kind}-${key}`));
    const current = await reference.get();
    if (current.exists && current.data().open) {
      await reference.update({ open: false, resolvedAt: Timestamp.now(), resolvedBy: by, resolutionNote: note });
    }
  };

  return { raise, settle };
};

export const registerAttentionRoutes = (app, { requireAdmin, db, retry }) => {
  const view = (document) => {
    const data = document.data();
    const time = (value) => value?.toDate ? value.toDate().toISOString() : null;
    return { id: document.id, ...data, retry: Boolean(ATTENTION_KINDS[data.kind]?.retry),
      createdAt: time(data.createdAt), lastSeenAt: time(data.lastSeenAt), resolvedAt: time(data.resolvedAt) };
  };

  app.get('/api/admin/attention', rateLimit(60, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Record storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      const snapshot = await db().collection('attention').where('open', '==', true).limit(200).get();
      const entries = snapshot.docs.map(view).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      res.json({ entries, count: entries.length });
    } catch (error) {
      console.error('Could not load the needs-attention list:', error.message);
      res.status(500).json({ error: 'Could not load the needs-attention list.' });
    }
  });

  const load = async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return null;
    if (!db()) { res.status(503).json({ error: 'Record storage is not configured.' }); return null; }
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(req.params.id)) { res.status(400).json({ error: 'Choose an entry.' }); return null; }
    const reference = db().collection('attention').doc(req.params.id);
    const document = await reference.get();
    if (!document.exists) { res.status(404).json({ error: 'Entry not found.' }); return null; }
    if (!document.data().open) { res.status(409).json({ error: 'This entry is already resolved.' }); return null; }
    return { admin, reference, entry: document.data() };
  };

  app.post('/api/admin/attention/:id/resolve', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      const loaded = await load(req, res);
      if (!loaded) return;
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
      await loaded.reference.update({ open: false, resolvedAt: Timestamp.now(), resolvedBy: loaded.admin.email || loaded.admin.uid, resolutionNote: note });
      res.json({ success: true });
    } catch (error) {
      console.error('Could not resolve needs-attention entry:', error.message);
      res.status(500).json({ error: 'Could not mark the entry resolved.' });
    }
  });

  app.post('/api/admin/attention/:id/retry', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const loaded = await load(req, res);
      if (!loaded) return;
      const handler = ATTENTION_KINDS[loaded.entry.kind]?.retry && retry[loaded.entry.kind];
      if (!handler) return res.status(400).json({ error: 'This entry cannot be retried from the website.' });
      const message = await handler(loaded.entry, loaded.admin);
      await loaded.reference.update({ open: false, resolvedAt: Timestamp.now(), resolvedBy: loaded.admin.email || loaded.admin.uid,
        resolutionNote: message || 'Retried successfully.' });
      res.json({ success: true, message: message || 'Retried successfully.' });
    } catch (error) {
      console.error('Needs-attention retry failed:', error.message);
      await db().collection('attention').doc(req.params.id).update({ detail: `Retry failed: ${error.message}`.slice(0, 1000), lastSeenAt: Timestamp.now() })
        .catch(() => {});
      res.status(error.status || 502).json({ error: `Retry did not complete: ${error.message}` });
    }
  });
};
