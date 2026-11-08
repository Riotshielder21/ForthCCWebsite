import { Timestamp } from 'firebase-admin/firestore';
import { buildRoster, rosterEmail, rosterDue, rosterViewable, cleanRosterViewers } from '../utils/eventRoster.js';
import { eventScheduleLabel } from '../utils/catalogue.js';
import { clubYearOf } from '../utils/clubYear.js';
import { loadVisitHistory } from './nonMemberVisits.js';
import { readJustgoSync } from './justgoSync.js';
import { rateLimit } from './rateLimit.js';
import { loadEntitlements } from './membershipTerms.js';
import { resolveOrderPeople } from './orderPeople.js';

/**
 * Emails each event leader the attendee list once bookings close (checked hourly), and lets an admin send it at any time.
 * Sends are recorded in the private `eventRosters` collection, keyed by product id, so the automatic send happens once.
 *
 * The leader and up to ten extra viewers (kept in the private `eventRosterAccess` collection, because products are public)
 * can also open the list on the check-in page while the event is in the shop, until the end of its last day. Admins can
 * open it at any time. Each view is recorded in `eventRosterAccessLog`.
 */
export const registerEventRosterRoutes = (app, { requireAdmin, db, sendEmail, loadCatalogue, emailCodes, requestNow = () => new Date() }) => {
  const rosters = () => db().collection('eventRosters');
  const access = () => db().collection('eventRosterAccess');
  const events = async () => (await loadCatalogue()).filter((product) => product.category === 'EVENTS');

  /** The events this email may open now: as the event leader or a named viewer. */
  const viewableEvents = async (email, now) => {
    const open = (await events()).filter((product) => rosterViewable(product, now));
    if (!open.length || !email) return [];
    const viewers = new Map((await db().getAll(...open.map((product) => access().doc(product.id))))
      .map((document) => [document.id, document.data()?.viewers || []]));
    const address = email.toLowerCase();
    return open.filter((product) => product.leaderEmail?.toLowerCase() === address || viewers.get(product.id)?.includes(address));
  };
  const canViewEventRosters = async (email, req) => Boolean(db()) && (await viewableEvents(email, requestNow(req))).length > 0;

  const loadMembers = async (orders) => {
    const ids = [...new Set(orders.flatMap((order) => (order.people || []).map((person) => person.membershipId)).filter(Boolean))];
    if (!ids.length) return new Map();
    const members = (await db().getAll(...ids.map((id) => db().collection('memberships').doc(id)))).filter((document) => document.exists)
      .map((document) => [document.id, document.data()]);
    const householdIds = [...new Set(members.map(([, member]) => member.householdId).filter(Boolean))];
    const households = new Map(householdIds.length
      ? (await db().getAll(...householdIds.map((id) => db().collection('households').doc(id)))).filter((document) => document.exists).map((document) => [document.id, document.data()])
      : []);
    const entitlements = await loadEntitlements(db(), members.map(([id]) => id));
    return new Map(members.map(([id, member]) => [id, { ...member, household: households.get(member.householdId) || {}, entitlements: entitlements.get(id) || [] }]));
  };

  const paidOrders = async () => (await db().collection('orders').where('status', '==', 'paid').get()).docs.map((document) => ({ id: document.id, ...document.data() }));

  const rosterFor = async (product, orders, now = new Date()) => {
    const relevant = await resolveOrderPeople(db(), orders.filter((order) => (order.items || []).some((item) => item.id === product.id)));
    const members = await loadMembers(relevant);
    const clubYear = clubYearOf(product.eventSchedule?.startDate ? new Date(`${product.eventSchedule.startDate}T12:00:00Z`) : now);
    const { visits, checkedIn } = await loadVisitHistory(db(), [...members.keys()], await loadCatalogue(), clubYear);
    return buildRoster(product.id, relevant, members, now, await readJustgoSync(db(), now), visits, checkedIn);
  };

  const sendRoster = async (product, orders, record) => {
    const roster = await rosterFor(product, orders);
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

  const viewerRateLimit = rateLimit(30, 60 * 1000);

  app.get('/api/admin/events/:id/roster-viewers', viewerRateLimit, async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Event storage is not configured.' });
      const id = productId(req);
      if (!id) return res.status(400).json({ error: 'Choose an event.' });
      res.set('Cache-Control', 'no-store');
      res.json({ viewers: (await access().doc(id).get()).data()?.viewers || [] });
    } catch (error) {
      console.error('Could not load event roster viewers:', error.message);
      res.status(500).json({ error: 'Could not load who can view the attendee list.' });
    }
  });

  app.put('/api/admin/events/:id/roster-viewers', viewerRateLimit, async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Event storage is not configured.' });
      const id = productId(req);
      if (!id) return res.status(400).json({ error: 'Choose an event.' });
      let viewers;
      try { viewers = cleanRosterViewers(req.body?.viewers); } catch (error) { return res.status(400).json({ error: error.message }); }
      await access().doc(id).set({ viewers, updatedAt: Timestamp.now(), updatedBy: admin.email || admin.uid });
      res.json({ success: true, viewers });
    } catch (error) {
      console.error('Could not save event roster viewers:', error.message);
      res.status(500).json({ error: 'Could not save who can view the attendee list.' });
    }
  });

  /** Admins use their Google sign-in; leaders and viewers use the volunteer email code. */
  const requireViewer = async (req, res) => {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      const admin = await requireAdmin(req, res);
      return admin ? { email: admin.email || admin.uid, admin: true } : null;
    }
    const session = await emailCodes.requireEmailSession(req, res, 'volunteer');
    return session ? { email: session.email, admin: false } : null;
  };

  const summary = (product) => ({ id: product.id, name: product.name || product.id,
    schedule: product.eventSchedule ? eventScheduleLabel(product.eventSchedule) : '' });

  app.get('/api/event-rosters', viewerRateLimit, async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Event storage is not configured.' });
      const viewer = await requireViewer(req, res);
      if (!viewer) return;
      const now = requestNow(req);
      const list = viewer.admin ? (await events()).filter((product) => rosterViewable(product, now)) : await viewableEvents(viewer.email, now);
      res.set('Cache-Control', 'no-store');
      res.json({ events: list.map(summary) });
    } catch (error) {
      console.error('Could not list event rosters:', error.message);
      res.status(500).json({ error: 'Could not load your event attendee lists.' });
    }
  });

  app.get('/api/event-rosters/:id', viewerRateLimit, async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Event storage is not configured.' });
      const viewer = await requireViewer(req, res);
      if (!viewer) return;
      const id = productId(req);
      const now = requestNow(req);
      const product = viewer.admin ? (await events()).find((candidate) => candidate.id === id)
        : (await viewableEvents(viewer.email, now)).find((candidate) => candidate.id === id);
      if (!product) return res.status(404).json({ error: 'That attendee list is not available to you.' });
      const roster = await rosterFor(product, await paidOrders(), now);
      await db().collection('eventRosterAccessLog').add({ productId: product.id, email: viewer.email, viaAdmin: viewer.admin,
        attendees: roster.length, at: Timestamp.now() });
      res.set('Cache-Control', 'no-store');
      res.json({ event: summary(product), attendees: roster.map((row) => ({
        name: row.name, kind: row.kind || '', membership: row.membership || '', nonMemberVisits: row.nonMemberVisits || '',
        ...(row.firstClubNight === undefined ? {} : { firstClubNight: row.firstClubNight }),
        kit: row.kit, swimming: row.swimming || '', medical: row.medical || '', emergencyContact: row.emergencyContact || '',
        // Leaders only need to know who must not be photographed, not anyone's full consent record.
        ...(row.photoConsent === true ? {} : { noPhotos: true })
      })) });
    } catch (error) {
      console.error('Could not load the event roster:', error.message);
      res.status(500).json({ error: 'Could not load the attendee list.' });
    }
  });

  return { sendDueRosters, canViewEventRosters };
};
