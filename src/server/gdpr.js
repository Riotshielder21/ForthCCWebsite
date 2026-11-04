import crypto from 'node:crypto';
import { Timestamp, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { identityEmails, matchesIdentity, redactOrder, redactSubscription, sharedDetailsErrors, sharedDetailsUpdate, ticketsToReview } from '../utils/erasure.js';
import { lastEventDate, londonDate } from '../utils/eventRoster.js';
import { holdsPlace, wantedQuantities } from '../utils/inventory.js';
import { eraseStripeDetails } from './stripeErasure.js';
import { memberOrders } from './membershipTerms.js';
import { lookupKey, maskEmail, maskMembershipNumber, maskName, personLookupKeys } from '../utils/privacy.js';
import { memberIsJunior } from '../utils/households.js';
import { rateLimit } from './rateLimit.js';
import { REASON_REQUIRED, auditEntry, requiredReason } from '../utils/auditLog.js';
import { EMAIL_CODE_PURPOSES, codeDocumentId } from '../utils/emailCodes.js';

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const subjectFor = (record) => ({ email: identityEmails(record, record.household)[0] || '', firstName: record.firstName || '', lastName: record.lastName || '', dob: record.dob || '', affiliationNumber: record.affiliationNumber || '' });
const fullName = (record) => `${record.firstName || ''} ${record.lastName || ''}`.trim();
const juniorRecord = (record) => memberIsJunior(record);
const leftHouseholdIds = (records, targets) => {
  const targetIds = new Set(targets.map((record) => record.id));
  return [...new Set(targets.filter((record) => record.householdId && !juniorRecord(record)
    && records.some((candidate) => candidate.householdId === record.householdId && !targetIds.has(candidate.id)))
    .map((record) => record.householdId))];
};

/**
 * GDPR erasure. Starts from the member register, follows the person into every other collection, keeps orders for the
 * accounts with identifying details removed, and leaves only a masked audit entry.
 */
export const registerGdprRoutes = (app, { requireAdmin, db, stripeReportRequest, localFirebase, normalizeEmail, isValidEmail, stopSubscriptionItems, loadCatalogue = async () => [] }) => {
  const auditSecret = () => process.env.AUDIT_LOOKUP_SECRET || (localFirebase ? 'local-audit-secret' : '');

  /** Everything an erasure for this request would touch. `scope` is 'person' or 'family'. */
  const loadScope = async (body, scope, secret) => {
    const adminDb = db();
    const memberships = adminDb.collection('memberships');
    const asRecord = (document, household = {}) => ({ id: document.id, ...document.data(), household });
    let matched = [];
    let subjects = [];
    const households = new Map();
    if (typeof body.membershipId === 'string' && body.membershipId && !body.membershipId.includes('/') && body.membershipId.length < 200) {
      const document = await memberships.doc(body.membershipId).get();
      if (!document.exists) return { status: 404, error: 'Member record not found.' };
      matched = [asRecord(document)];
    } else {
      const identity = { email: normalizeEmail(body.email), firstName: text(body.firstName, 80), lastName: text(body.lastName, 80), dob: text(body.dob, 10), affiliationNumber: text(body.affiliationNumber, 40).replace(/^fcc-/i, '') };
      if (!isValidEmail(identity.email) || !identity.firstName || !identity.lastName || !/^\d{4}-\d{2}-\d{2}$/.test(identity.dob)) {
        return { status: 400, error: 'Enter the email, first name, last name and date of birth.' };
      }
      const [byEmail, byNumber, householdsByEmail] = await Promise.all([
        memberships.where('email', '==', identity.email).limit(50).get(),
        identity.affiliationNumber ? memberships.where('affiliationNumber', '==', identity.affiliationNumber).limit(5).get() : null,
        adminDb.collection('households').where('email', '==', identity.email).limit(50).get()
      ]);
      householdsByEmail.docs.forEach((document) => households.set(document.id, document));
      const householdMembers = (await Promise.all(householdsByEmail.docs.map((household) =>
        memberships.where('householdId', '==', household.id).limit(50).get()
      ))).flatMap((snapshot) => snapshot.docs);
      const candidates = [...new Map([...byEmail.docs, ...(byNumber?.docs || []), ...householdMembers]
        .map((document) => [document.id, document])).values()];
      const ids = [...new Set(candidates.map((document) => document.data().householdId).filter((id) => id && !households.has(id)))];
      if (ids.length) (await adminDb.getAll(...ids.map((id) => adminDb.collection('households').doc(id))))
        .filter((document) => document.exists).forEach((document) => households.set(document.id, document));
      matched = candidates.map((document) => asRecord(document, households.get(document.data().householdId)?.data() || {}))
        .filter((record) => matchesIdentity(record, identity, record.household));
      subjects = [identity];
    }

    const family = new Map();
    for (const record of matched.filter((candidate) => candidate.householdId)) {
      if (!households.has(record.householdId)) {
        const household = await adminDb.collection('households').doc(record.householdId).get();
        if (household.exists) households.set(household.id, household);
      }
      (await memberships.where('householdId', '==', record.householdId).limit(50).get()).docs
        .forEach((document) => family.set(document.id, document));
    }
    for (const record of matched.filter((candidate) => candidate.familyGroup)) {
      (await memberships.where('familyGroup', '==', record.familyGroup).limit(20).get()).docs
        .forEach((document) => family.set(document.id, document));
    }
    const familyRecords = [...family.values()].map((document) => asRecord(document, households.get(document.data().householdId)?.data() || {}));
    familyRecords.forEach((record) => family.set(record.id, record));
    matched = matched.map((record) => ({ ...record, household: households.get(record.householdId)?.data() || record.household }));
    const targets = scope === 'family' ? [...new Map([...matched, ...familyRecords].map((record) => [record.id, record])).values()] : matched;
    const targetIds = new Set(targets.map((record) => record.id));
    const remaining = familyRecords.filter((record) => !targetIds.has(record.id));
    const replaceHouseholdIds = leftHouseholdIds(familyRecords, targets);
    subjects = [...subjects, ...targets.map(subjectFor)];

    // An email that still belongs to someone staying on the register is not erased.
    const orders = new Map();
    for (const record of targets) (await memberOrders(adminDb, record.id)).forEach((document) => orders.set(document.id, document.data()));
    const fullyErased = (order) => (order.people || []).length > 0 && order.people.every((person) => targetIds.has(person.membershipId) || person.erased);
    const candidateEmails = new Set([...subjects.map((subject) => normalizeEmail(subject.email)), ...targets.flatMap((record) => identityEmails(record, record.household)),
      ...[...orders.values()].filter(fullyErased).map((order) => normalizeEmail(order.email))].filter((email) => email && email !== '***'));
    const erasedEmails = new Set();
    for (const email of candidateEmails) {
      const [holders, contactHouseholds] = await Promise.all([
        memberships.where('email', '==', email).limit(50).get(),
        adminDb.collection('households').where('email', '==', email).limit(50).get()
      ]);
      const householdHolders = (await Promise.all(contactHouseholds.docs.filter((household) => !replaceHouseholdIds.includes(household.id)).map((household) =>
        memberships.where('householdId', '==', household.id).limit(50).get()
      ))).flatMap((snapshot) => snapshot.docs);
      if ([...holders.docs, ...householdHolders].every((document) => targetIds.has(document.id))) erasedEmails.add(email);
    }

    for (const email of erasedEmails) (await adminDb.collection('orders').where('email', '==', email).limit(200).get()).docs.forEach((document) => orders.set(document.id, document.data()));
    const orderUpdates = [...orders].map(([id, order]) => ({ id, update: redactOrder(order, targetIds, erasedEmails, replaceHouseholdIds) })).filter((entry) => entry.update);

    const emailList = [...erasedEmails];
    const byEmail = async (collection) => (await Promise.all(emailList.map((email) => adminDb.collection(collection).where('email', '==', email).get()))).flatMap((snapshot) => snapshot.docs);
    // The Stripe mirror records which members each payer and subscription covers, not their names or emails.
    const byMembers = async (collection) => {
      const ids = [...targetIds];
      const found = new Map();
      for (let index = 0; index < ids.length; index += 30) {
        (await adminDb.collection(collection).where('membershipIds', 'array-contains-any', ids.slice(index, index + 30)).get()).docs.forEach((document) => found.set(document.id, document));
      }
      return [...found.values()];
    };
    const [discountCodes, lists, mirrorCustomers, mirrorSubscriptions] = await Promise.all([byEmail('discountCodes'), byEmail('lists'), byMembers('stripeCustomers'), byMembers('stripeSubscriptions')]);
    const subscriptions = new Map();
    const warnings = [];
    // Items to stop on subscriptions that keep paying for someone staying: only those held by erased people alone.
    const itemStops = [];
    // Monthly payments are recorded per club year in `subscriptions`, which lists the members each one pays for.
    const candidates = new Map();
    const subscriptionRecords = new Map();
    const modes = new Map(targets.filter((record) => record.stripeMembershipSubscriptionId).map((record) => [record.stripeMembershipSubscriptionId, record.stripeMembershipMode || 'test']));
    for (const id of modes.keys()) candidates.set(id, null);
    for (const document of mirrorSubscriptions) {
      const record = document.data();
      const id = record.id || record.stripeSubscriptionId;
      if (id) {
        candidates.set(id, { people: (record.membershipIds || []).map((membershipId) => ({ membershipId })) });
        modes.set(id, record.stripeMode || 'test');
      }
    }
    for (const order of orders.values()) {
      for (const id of new Set([order.stripeSubscriptionId, ...(Array.isArray(order.stripeSubscriptionIds) ? order.stripeSubscriptionIds : [])].filter(Boolean))) {
        if (!candidates.has(id)) candidates.set(id, order);
      }
    }
    for (const record of targets) for (const id of Array.isArray(record.subscriptionIds) ? record.subscriptionIds : []) if (!candidates.has(id)) candidates.set(id, null);
    for (const record of targets) {
      const linked = await adminDb.collection('subscriptions').where('membershipIds', 'array-contains', record.id).get();
      linked.docs.forEach((document) => { subscriptionRecords.set(document.id, document); candidates.set(document.id, candidates.get(document.id) || null); });
    }
    for (const email of erasedEmails) {
      const linked = await adminDb.collection('subscriptions').where('email', '==', email).get();
      linked.docs.forEach((document) => { subscriptionRecords.set(document.id, document); candidates.set(document.id, candidates.get(document.id) || null); });
    }
    for (const [id, order] of candidates) {
      const stored = await adminDb.collection('subscriptions').doc(id).get();
      if (stored.exists) subscriptionRecords.set(id, stored);
      // An older membership subscription with no record here covers whoever on the register points at it.
      const covered = stored.exists ? stored.data().membershipIds || []
        : order ? (order.people || []).map((person) => person.membershipId)
          : [...new Map([...familyRecords, ...targets].map((record) => [record.id, record])).values()]
            .filter((record) => record.stripeMembershipSubscriptionId === id).map((record) => record.id);
      const payer = normalizeEmail(stored.exists ? stored.data().email : order?.email || '');
      const everyoneErased = covered.length ? covered.every((membershipId) => targetIds.has(membershipId)) : erasedEmails.has(payer);
      const mode = (stored.exists ? stored.data().stripeMode : order?.stripe?.mode) || modes.get(id) || 'test';
      if (everyoneErased) { subscriptions.set(id, mode); continue; }
      const active = stored.exists && stored.data().status === 'active'
        ? (stored.data().items || []).filter((item) => item.status === 'active' && (item.membershipIds || []).some((membershipId) => targetIds.has(membershipId))) : [];
      const own = active.filter((item) => item.membershipIds.every((membershipId) => targetIds.has(membershipId)));
      const sharedItems = active.filter((item) => !own.includes(item));
      if (own.length) itemStops.push({ id, mode, items: own.map((item) => ({ orderRef: item.orderRef || stored.data().orderRef || '', lineId: item.lineId, name: item.name })) });
      if (sharedItems.length) warnings.push(`Subscription ${id} keeps paying for ${sharedItems.map((item) => item.name).join(', ')}, which also covers people who are staying. Review it with the payer.`);
      else if (!stored.exists) warnings.push(`Subscription ${id} also covers people who are staying, so it was not cancelled. Review it in Stripe.`);
    }

    const auditDocs = new Map();
    for (const subject of subjects) {
      const [nameKey] = personLookupKeys(secret, { ...subject, email: '' });
      if (!nameKey) continue;
      const emailKeys = [...new Set([subject.email, ...targets.filter((record) => matchesIdentity(record, subject, record.household)).flatMap((record) => identityEmails(record, record.household))].filter(Boolean))].map((email) => lookupKey(secret, 'email', email));
      (await adminDb.collection('auditLog').where('lookupKeys', 'array-contains', nameKey).limit(50).get()).docs
        .filter((document) => !document.data().personalDataErased && emailKeys.some((key) => document.data().lookupKeys.includes(key)))
        .forEach((document) => auditDocs.set(document.id, document));
    }
    const householdRecords = [...households.values()];
    const erasedHouseholdIds = householdRecords.filter((document) => {
      const id = document.id;
      const members = familyRecords.filter((record) => record.householdId === id);
      return members.length && members.every((record) => targetIds.has(record.id));
    }).map((document) => document.id);
    return { orders, targets, remaining, family: familyRecords, households: householdRecords, erasedHouseholdIds, subjects, erasedEmails, orderUpdates, subscriptions, subscriptionRecords, itemStops, warnings, discountCodes, lists, mirrorCustomers, mirrorSubscriptions, auditDocs };
  };

  /** Tickets to consider refunding before erasure, with the event and attendee names an admin needs to find them. */
  const refundChecks = async (scope, now = new Date()) => {
    const catalogue = await loadCatalogue();
    const names = new Map(scope.targets.map((record) => [record.id, fullName(record)]));
    return ticketsToReview(scope.orders, names.keys(), (item) => lastEventDate(catalogue.find((product) => product.id === item.id) || item), londonDate(now))
      .map((ticket) => ({ ...ticket, attendee: names.get(ticket.membershipId) || '' }));
  };

  const describe = (scope, refunds = []) => ({
    people: scope.targets.map((record) => ({ id: record.id, name: fullName(record), email: identityEmails(record, record.household)[0] || '', tier: record.membershipTier || '', junior: juniorRecord(record), status: record.status || '',
      justgo: record.justgoSyncStatus === 'synced' || record.renewalMethod === 'justgo' || Boolean(record.affiliationNumber) })),
    family: scope.family.map((record) => ({ id: record.id, name: fullName(record), junior: juniorRecord(record), erased: scope.targets.some((target) => target.id === record.id) })),
    remaining: scope.remaining.map((record) => ({ id: record.id, name: fullName(record), junior: juniorRecord(record) })),
    refundChecks: refunds,
    ordersRedacted: scope.orderUpdates.length, subscriptionsToCancel: [...scope.subscriptions.keys()],
    subscriptionItemsToStop: scope.itemStops.map((stop) => ({ id: stop.id, itemNames: stop.items.map((item) => item.name) })), warnings: scope.warnings,
    related: { discountCodes: scope.discountCodes.length, lists: scope.lists.length, stripeRecords: scope.mirrorCustomers.length + scope.mirrorSubscriptions.length },
    deletedRecords: [...scope.auditDocs].map(([id, document]) => ({ id, summary: document.data().summary, deletedAt: document.data().at?.toDate?.() || null }))
  });

  app.post('/api/admin/gdpr/preview', rateLimit(30, 60 * 1000), async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    res.set('Cache-Control', 'no-store');
    try {
      if (!db()) return res.status(503).json({ error: 'Record storage is not configured.' });
      const secret = auditSecret();
      if (!secret) return res.status(503).json({ error: 'Deletion audit is not configured. Set AUDIT_LOOKUP_SECRET.' });
      const scope = await loadScope(req.body || {}, req.body?.scope === 'family' ? 'family' : 'person', secret);
      if (scope.error) return res.status(scope.status).json({ error: scope.error });
      res.json(describe(scope, await refundChecks(scope)));
    } catch (error) {
      console.error('GDPR preview failed:', error.message);
      res.status(500).json({ error: 'Could not look up this person.' });
    }
  });

  app.post('/api/admin/gdpr/erase', rateLimit(10, 60 * 1000), async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.set('Cache-Control', 'no-store');
    try {
      const adminDb = db();
      if (!adminDb) return res.status(503).json({ error: 'Record storage is not configured.' });
      const secret = auditSecret();
      if (!secret) return res.status(503).json({ error: 'Deletion audit is not configured. Set AUDIT_LOOKUP_SECRET.' });
      if (req.body?.confirm !== 'ERASE') return res.status(400).json({ error: 'Type ERASE to confirm.' });
      const reason = requiredReason(req.body);
      if (!reason) return res.status(400).json({ error: REASON_REQUIRED });
      const scopeName = ['family', 'person'].includes(req.body.scope) ? req.body.scope : '';
      const scope = await loadScope(req.body, scopeName || 'person', secret);
      if (scope.error) return res.status(scope.status).json({ error: scope.error });
      if (!scope.targets.length && !scope.auditDocs.size) return res.status(404).json({ error: 'No matching records were found.' });

      const left = scope.remaining;
      if (left.length && !scopeName) return res.status(409).json({ error: 'Choose whether to erase the whole family or only this person.', requiresFamilyChoice: true });
      const shared = req.body.sharedDetails;
      if (left.length && (shared || scope.targets.some((record) => !juniorRecord(record)))) {
        const problems = sharedDetailsErrors(shared);
        if (problems.length) return res.status(400).json({ error: problems[0], details: problems, requiresSharedDetails: true });
      }

      const cancellations = [...scope.subscriptions];
      const stripeIds = new Set([...scope.subscriptionRecords.keys(), ...scope.subscriptions.keys(),
        ...scope.mirrorSubscriptions.map((document) => document.data().id || document.data().stripeSubscriptionId).filter(Boolean)]);
      let stripeErasure = { deleted: 0, retained: 0 };
      const stripeJournal = adminDb.collection('gdprStripeErasure').doc(lookupKey(secret, 'stripe-erasure',
        [...scope.erasedEmails].sort().join('|') || [...scope.targets.map((record) => record.id)].sort().join('|')));
      if (stripeIds.size || scope.erasedEmails.size) {
        const writeKey = process.env.STRIPE_SUBSCRIPTION_ADMIN_KEY || '';
        if (!/^(sk|rk)_(test|live)_/.test(writeKey)) return res.status(503).json({ error: 'Stripe erasure requires STRIPE_SUBSCRIPTION_ADMIN_KEY. Nothing was erased.' });
        const keyMode = writeKey.includes('_live_') ? 'live' : 'test';
        const linkedModes = [...cancellations, ...[...scope.subscriptionRecords].map(([id, document]) => [id, document.data().stripeMode || 'test']),
          ...scope.mirrorSubscriptions.map((document) => [document.data().id || document.data().stripeSubscriptionId, document.data().stripeMode || 'test'])];
        if (linkedModes.some(([id, mode]) => !/^sub_[a-zA-Z0-9_]+$/.test(id) || mode !== keyMode)) {
          return res.status(400).json({ error: 'A linked subscription cannot be cancelled with the configured Stripe key. Nothing was erased.' });
        }
        const request = stripeReportRequest(writeKey);
        for (const [id] of cancellations) {
          let current = null;
          try { current = await request(`subscriptions/${encodeURIComponent(id)}`); }
          catch (error) { if (error.stripeCode !== 'resource_missing') throw error; }
          if (current && !['canceled', 'incomplete_expired'].includes(current.status)) {
            const schedule = typeof current.schedule === 'string' ? current.schedule : current.schedule?.id;
            if (schedule) await request(`subscription_schedules/${encodeURIComponent(schedule)}/cancel`, {
              method: 'POST', body: new URLSearchParams({ invoice_now: 'false', prorate: 'false' })
            });
            else await request(`subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
          }
        }
        // Stop billing before removing either the Stripe customer or the local records needed for a retry.
        for (const stop of scope.itemStops) await stopSubscriptionItems(stop.id, stop.items, admin, request, reason);
        const journal = await stripeJournal.get();
        stripeErasure = await eraseStripeDetails(request, {
          subscriptionIds: stripeIds, emails: scope.erasedEmails, customerIds: journal.data()?.customerIds || [],
          erasedPayerSubscriptionIds: new Set([...scope.subscriptionRecords].filter(([, document]) => document.data().payerErased === true
            || scope.erasedEmails.has(normalizeEmail(document.data().email))).map(([id]) => id)),
          rememberCustomer: (id) => stripeJournal.set({ customerIds: FieldValue.arrayUnion(id), updatedAt: Timestamp.now() }, { merge: true })
        });
      }

      const targetIds = new Set(scope.targets.map((record) => record.id));
      const linkedRecords = [];
      const attentionRecords = new Map();
      const attentionFor = async (field, value) => (await adminDb.collection('attention').where(field, '==', value).get()).docs
        .forEach((document) => attentionRecords.set(document.id, document));
      for (const id of stripeIds) await attentionFor('subscriptionId', id);
      for (const { id } of scope.orderUpdates) await attentionFor('orderRef', id);
      for (const email of scope.erasedEmails) await attentionFor('email', email);
      for (let index = 0; index < scope.targets.length; index += 30) {
        const ids = scope.targets.slice(index, index + 30).map((record) => record.id);
        linkedRecords.push(...(await adminDb.collection('renewalInvites').where('membershipIds', 'array-contains-any', ids).get()).docs);
        linkedRecords.push(...(await adminDb.collection('volunteerRenewals').where('memberId', 'in', ids).get()).docs);
        linkedRecords.push(...(await adminDb.collection('membershipTerms').where('membershipId', 'in', ids).get()).docs);
        linkedRecords.push(...(await adminDb.collection('clubNightCheckins').where('memberId', 'in', ids).get()).docs);
        linkedRecords.push(...(await adminDb.collection('clubNightAccessLog').where('memberId', 'in', ids).get()).docs);
        linkedRecords.push(...(await adminDb.collection('selfAssessmentLog').where('memberId', 'in', ids).get()).docs);
      }
      for (const id of scope.erasedHouseholdIds) linkedRecords.push(...(await adminDb.collection('selfServiceChanges').where('householdId', '==', id).get()).docs);
      for (const email of scope.erasedEmails) {
        linkedRecords.push(...(await adminDb.collection('emailSessions').where('email', '==', email).get()).docs);
        linkedRecords.push(...(await adminDb.collection('eventRosterAccessLog').where('email', '==', email).get()).docs);
        const codes = await adminDb.getAll(...Object.keys(EMAIL_CODE_PURPOSES).map((purpose) => adminDb.collection('emailCodes').doc(codeDocumentId(purpose, email))));
        linkedRecords.push(...codes.filter((document) => document.exists));
      }
      // Erased attendees' tickets no longer take a place on the event.
      const stockChanges = scope.orderUpdates.filter(({ update }) => update.items).flatMap(({ id, update }) =>
        [...new Set(update.items.filter((item) => item.attendeeErased).map((item) => item.id))].map((productId) => ({ id, productId, items: update.items })));
      const stockDocuments = stockChanges.length ? await adminDb.getAll(...stockChanges.map(({ productId }) => adminDb.collection('stock').doc(productId))) : [];
      const batch = adminDb.batch();
      batch.delete(stripeJournal);
      stockChanges.forEach(({ id, productId, items }, index) => {
        if (!stockDocuments[index].data()?.holds?.[id]) return;
        const kept = items.filter((item) => item.id === productId && holdsPlace(item));
        batch.update(stockDocuments[index].ref, new FieldPath('holds', id), kept.length ? { until: null, lines: wantedQuantities(kept) } : FieldValue.delete());
      });
      attentionRecords.forEach((document) => batch.update(document.ref, {
        email: '', detail: 'Personal details removed during GDPR erasure.', data: {}, resolutionNote: '',
        personalDataErasedAt: Timestamp.now()
      }));
      new Map(linkedRecords.map((document) => [document.ref.path, document])).forEach((document) => batch.delete(document.ref));
      const replaceHouseholds = new Set(leftHouseholdIds(scope.family, scope.targets));
      scope.targets.forEach((record) => batch.delete(adminDb.collection('memberships').doc(record.id)));
      if (left.length && shared) {
        const householdUpdate = { ...sharedDetailsUpdate(shared), updatedAt: Timestamp.now() };
        scope.households.filter((household) => replaceHouseholds.has(household.id))
          .forEach((household) => batch.update(household.ref, householdUpdate));
        const legacy = {
          email: shared.email.trim().toLowerCase(), phone: shared.phone.trim(), address: shared.address.trim(), postcode: shared.postcode.trim(),
          emergencyContact: { name: shared.emergencyName.trim(), phone: shared.emergencyPhone.trim(), relationship: shared.emergencyRelationship.trim() },
          guardian: { name: shared.contactName.trim(), relationship: shared.contactRelationship.trim(), email: shared.email.trim().toLowerCase(),
            phone: shared.phone.trim(), address: shared.address.trim(), postcode: shared.postcode.trim() }, updatedAt: Timestamp.now()
        };
        left.filter((record) => !record.householdId).forEach((record) => batch.update(adminDb.collection('memberships').doc(record.id), legacy));
      }
      scope.erasedHouseholdIds.forEach((id) => batch.delete(adminDb.collection('households').doc(id)));
      scope.orderUpdates.forEach(({ id, update }) => batch.update(adminDb.collection('orders').doc(id), { ...update, personalDataErasedAt: Timestamp.now() }));
      // Partial stops write billing state first; read it again so redaction never restores an active item.
      for (const id of scope.subscriptionRecords.keys()) {
        const document = await adminDb.collection('subscriptions').doc(id).get();
        if (document.exists) {
          const redacted = redactSubscription(document.data(), scope.targets, scope.erasedEmails);
          batch.update(document.ref, {
            ...redacted,
            ...(scope.subscriptions.has(id) ? { status: 'cancelled', items: redacted.items
              .map((item) => item.status === 'active' ? { ...item, status: 'cancelled' } : item) } : {}),
            personalDataErasedAt: Timestamp.now()
          });
        }
        const recipients = await adminDb.collection('memberships').where('subscriptionIds', 'array-contains', id).get();
        recipients.docs.filter((recipient) => !targetIds.has(recipient.id)).forEach((recipient) => batch.update(recipient.ref, {
          subscriptionItems: (recipient.data().subscriptionItems || []).map((item) => scope.erasedEmails.has(normalizeEmail(item.payerEmail))
            ? { ...item, payerEmail: '' } : item)
        }));
      }
      scope.discountCodes.forEach((document) => batch.update(document.ref, { email: '***', name: '***' }));
      scope.lists.forEach((document) => batch.delete(document.ref));
      for (const email of scope.erasedEmails) {
        const forms = await adminDb.collection('formSubmissions').where('email', '==', email).get();
        forms.docs.forEach((document) => batch.delete(document.ref));
      }
      [...scope.mirrorCustomers, ...scope.mirrorSubscriptions].forEach((document) => batch.update(document.ref, { membershipIds: FieldValue.arrayRemove(...targetIds) }));
      for (const [id, mode] of cancellations) {
        batch.set(adminDb.collection('stripeSubscriptions').doc(`FCC-${mode}-${id}`), { status: 'Inactive', stripeStatus: 'canceled', reason: 'Cancelled for GDPR erasure' }, { merge: true });
      }
      scope.auditDocs.forEach((document) => batch.update(document.ref, { snapshot: null, personalDataErased: true, personalDataErasedAt: Timestamp.now() }));
      const people = scope.targets.map((record) => ({ name: maskName(fullName(record)), email: maskEmail(identityEmails(record, record.household)[0]), membershipNumber: maskMembershipNumber(record.affiliationNumber), tier: record.membershipTier || '' }));
      batch.create(adminDb.collection('auditLog').doc(), auditEntry({ kind: 'deletion', action: 'gdpr-erasure', reason, actor: admin, at: Timestamp.now(), personalDataErased: true, snapshot: null,
        recordIdHash: crypto.createHash('sha256').update([...targetIds].sort().join(',') || 'lookup').digest('hex'),
        summary: { label: 'GDPR erasure', scope: left.length ? 'person' : scope.family.length > 1 ? 'family' : 'person', people, ordersRedacted: scope.orderUpdates.map(({ id }) => id),
          subscriptionsCancelled: cancellations.map(([id]) => id), earlierDeletionsPurged: scope.auditDocs.size },
        lookupKeys: [...new Set(scope.subjects.flatMap((subject) => [...personLookupKeys(secret, subject), ...(subject.email ? [lookupKey(secret, 'email', subject.email)] : [])]))]
      }));
      await batch.commit();

      const manual = [];
      if (scope.targets.some((record) => record.justgoSyncStatus === 'synced' || record.renewalMethod === 'justgo' || record.affiliationNumber)) manual.push('Remove them from JustGo, or the weekly sync will recreate the record.');
      if (stripeIds.size || scope.erasedEmails.size) manual.push('Stripe retains historical invoices, payments and mandate records that its API cannot fully erase. Review these in Stripe and use Stripe privacy support for any further erasure required; this is not a complete purge of Stripe financial history.');
      if (stripeErasure.retained) manual.push('A Stripe customer still pays for other people. Its contact details were cleared, but its payment method was retained to avoid cancelling their payments. Arrange a replacement payer and review the retained mandate in Stripe.');
      manual.push('Remove any rows about them from Google Sheets and form responses.');
      res.json({ success: true, erased: people.length, ordersRedacted: scope.orderUpdates.length, subscriptionsCancelled: cancellations.length,
        subscriptionItemsStopped: scope.itemStops.reduce((sum, stop) => sum + stop.items.length, 0), stripeCustomersDeleted: stripeErasure.deleted,
        earlierDeletionsPurged: scope.auditDocs.size,
        eventTicketsReleased: scope.orderUpdates.reduce((sum, { id, update }) => sum + (update.items || []).filter((item, index) => item.attendeeErased && !scope.orders.get(id)?.items?.[index]?.attendeeErased).length, 0),
        warnings: scope.warnings, manual });
    } catch (error) {
      console.error('GDPR erasure failed:', error.message);
      res.status(500).json({ error: 'Erasure could not be completed. Some payments may already have stopped, but member records were kept so you can retry. Check Stripe and try again.' });
    }
  });
};
