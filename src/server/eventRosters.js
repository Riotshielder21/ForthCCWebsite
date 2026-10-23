import { Timestamp } from 'firebase-admin/firestore';
import { buildRoster, rosterEmail, rosterDue } from '../utils/eventRoster.js';
import { rateLimit } from './rateLimit.js';

/**
 * Emails each event leader the attendee list once bookings close (checked hourly), and lets an admin send it at any time.
 * Sends are recorded in the private `eventRosters` collection, keyed by product id, so the automatic send happens once.
 */
export const registerEventRosterRoutes = (app, { requireAdmin, db, sendEmail, loadCatalogue }) => {
  const rosters = () => db().collection('eventRosters');

  const loadMembers = async (orders) => {
    const ids = [...new Set(orders.flatMap((order) => (order.people || []).map((person) => person.membershipId)).filter(Boolean))];
    if (!ids.length) return new Map();
    const members = (await db().getAll(...ids.map((id) => db().collection('memberships').doc(id)))).filter((document) => document.exists)
      .map((document) => [document.id, document.data()]);
    const householdIds = [...new Set(members.map(([, member]) => member.householdId).filter(Boolean))];
    const households = new Map(householdIds.length
      ? (await db().getAll(...householdIds.map((id) => db().collection('households').doc(id)))).filter((document) => document.exists).map((document) => [document.id, document.data()])
      : []);
    return new Map(members.map(([id, member]) => [id, { ...member, household: households.get(member.householdId) || {} }]));
  };

  const paidOrders = async () => (await db().collection('orders').where('status', '==', 'paid').get()).docs.map((document) => ({ id: document.id, ...document.data() }));

  const sendRoster = async (product, orders, record) => {
    const relevant = orders.filter((order) => (order.items || []).some((item) => item.id === product.id));
    const roster = buildRoster(product.id, relevant, await loadMembers(relevant));
    const { subject, body } = rosterEmail(product, roster);
    const sent = await sendEmail({ to: product.leaderEmail, subject, body, record: { type: 'event-roster', productId: product.id, attendees: roster.length } });
    if (!sent) throw new Error('The email service is not configured.');
    await rosters().doc(product.id).set({ ...record, sentAt: Timestamp.now(), sentTo: product.leaderEmail, attendees: roster.length, status: 'sent' });
    return { attendees: roster.length, sentTo: product.leaderEmail };
  };

  // A roster is claimed before sending so two servers never both send it; a failed send releases it for the next hour.
  const sendDueRosters = async (now = new Date()) => {
    if (!db()) return { sent: 0 };
    const due = (await loadCatalogue()).filter((product) => rosterDue(product, now));
    if (!due.length) return { sent: 0 };
    const sentIds = new Set((await db().getAll(...due.map((product) => rosters().doc(product.id)))).filter((document) => document.exists).map((document) => document.id));
    const pending = due.filter((product) => !sentIds.has(product.id));
    if (!pending.length) return { sent: 0 };
    const orders = await paidOrders();
    let sent = 0;
    for (const product of pending) {
      try { await rosters().doc(product.id).create({ status: 'sending', claimedAt: Timestamp.now() }); }
      catch { continue; }
      try {
        await sendRoster(product, orders, { trigger: 'automatic' });
        sent += 1;
      } catch (error) {
        console.error(`Event roster for ${product.id} not sent:`, error.message);
        await rosters().doc(product.id).delete().catch(() => {});
      }
    }
    return { sent };
  };

  const productId = (req) => (typeof req.params.id === 'string' && /^[\w-]{1,100}$/.test(req.params.id) ? req.params.id : '');
  const adminRosterStatusRateLimit = rateLimit(60, 60 * 1000);

  app.get('/api/admin/events/:id/roster', adminRosterStatusRateLimit, async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Event storage is not configured.' });
      const id = productId(req);
      if (!id) return res.status(400).json({ error: 'Choose an event.' });
      const data = (await rosters().doc(id).get()).data();
      res.set('Cache-Control', 'no-store');
      res.json(data?.status === 'sent' ? { sentAt: data.sentAt.toMillis(), sentTo: data.sentTo, attendees: data.attendees, trigger: data.trigger } : { sentAt: 0 });
    } catch (error) {
      console.error('Could not load the event roster status:', error.message);
      res.status(500).json({ error: 'Could not load the attendee list status.' });
    }
  });

  app.post('/api/admin/events/:id/roster', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Event storage is not configured.' });
      const product = (await loadCatalogue()).find((candidate) => candidate.id === productId(req) && candidate.category === 'EVENTS');
      if (!product) return res.status(404).json({ error: 'Event not found. Save the event first.' });
      if (!product.leaderEmail) return res.status(400).json({ error: 'Add the event leader\'s email and save the event first.' });
      const result = await sendRoster(product, await paidOrders(), { trigger: 'admin', by: admin.email || admin.uid });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Could not send the event roster:', error.message);
      res.status(500).json({ error: 'Could not send the attendee list.' });
    }
  });

  return { sendDueRosters };
};
