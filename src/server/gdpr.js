import crypto from 'node:crypto';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { identityEmails, matchesIdentity, redactOrder, sharedDetailsErrors, sharedDetailsUpdate } from '../utils/erasure.js';
import { lookupKey, maskEmail, maskMembershipNumber, maskName, personLookupKeys } from '../utils/privacy.js';
import { memberIsJunior } from '../utils/households.js';

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
export const registerGdprRoutes = (app, { rateLimit, requireAdmin, db, stripeReportRequest, localFirebase, customerId, normalizeEmail, isValidEmail }) => {
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
      const identity = { email: normalizeEmail(body.email), firstName: text(body.firstName, 80), lastName: text(body.lastName, 80), dob: text(body.dob, 10), affiliationNumber: text(body.affiliationNumber, 40) };
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
    const orderRefs = [...new Set(targets.flatMap((record) => (record.history || []).map((entry) => entry.orderRef)).filter((id) => typeof id === 'string' && id && !id.includes('/')))].slice(0, 300);
    if (orderRefs.length) (await adminDb.getAll(...orderRefs.map((id) => adminDb.collection('orders').doc(id)))).forEach((document) => document.exists && orders.set(document.id, document.data()));
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

    const subscriptions = new Map();
    const warnings = [];
    for (const record of targets) if (record.stripeMembershipSubscriptionId) subscriptions.set(record.stripeMembershipSubscriptionId, record.stripeMembershipMode || 'test');
    // Monthly payments are recorded per club year in `subscriptions`, which lists the members each one pays for.
    const candidates = new Map();
    for (const order of orders.values()) {
      for (const id of new Set([order.stripeSubscriptionId, ...(Array.isArray(order.stripeSubscriptionIds) ? order.stripeSubscriptionIds : [])].filter(Boolean))) {
        if (!candidates.has(id)) candidates.set(id, order);
      }
    }
    for (const record of targets) for (const id of Array.isArray(record.subscriptionIds) ? record.subscriptionIds : []) if (!candidates.has(id)) candidates.set(id, null);
    for (const [id, order] of candidates) {
      const stored = await adminDb.collection('subscriptions').doc(id).get();
      const covered = stored.exists ? stored.data().membershipIds || [] : (order?.people || []).map((person) => person.membershipId);
      const payer = normalizeEmail(stored.exists ? stored.data().email : order?.email || '');
      const everyoneErased = covered.length ? covered.every((membershipId) => targetIds.has(membershipId)) : erasedEmails.has(payer);
      if (everyoneErased) subscriptions.set(id, (stored.exists ? stored.data().stripeMode : order?.stripeMode) || 'test');
      else if (!subscriptions.has(id)) warnings.push(`Subscription ${id} also covers people who are staying, so it was not cancelled. Review it in Stripe.`);
    }

    const emailList = [...erasedEmails];
    const byEmail = async (collection) => (await Promise.all(emailList.map((email) => adminDb.collection(collection).where('email', '==', email).limit(100).get()))).flatMap((snapshot) => snapshot.docs);
    const [discountCodes, lists, mirrorCustomers, mirrorSubscriptions] = await Promise.all([byEmail('discountCodes'), byEmail('lists'), byEmail('stripeCustomers'), byEmail('stripeSubscriptions')]);
    const customerDocs = candidateEmails.size ? (await adminDb.getAll(...[...candidateEmails].map((email) => adminDb.collection('customers').doc(customerId(email))))).filter((document) => document.exists) : [];

    const auditDocs = new Map();
    for (const subject of subjects) {
      const [nameKey] = personLookupKeys(secret, { ...subject, email: '' });
      if (!nameKey) continue;
      const emailKeys = [...new Set([subject.email, ...targets.filter((record) => matchesIdentity(record, subject, record.household)).flatMap((record) => identityEmails(record, record.household))].filter(Boolean))].map((email) => lookupKey(secret, 'email', email));
      (await adminDb.collection('adminDeletionAudit').where('lookupKeys', 'array-contains', nameKey).limit(50).get()).docs
        .filter((document) => !document.data().personalDataErased && emailKeys.some((key) => document.data().lookupKeys.includes(key)))
        .forEach((document) => auditDocs.set(document.id, document));
    }
    const householdRecords = [...households.values()];
    const erasedHouseholdIds = householdRecords.filter((document) => {
      const id = document.id;
      const members = familyRecords.filter((record) => record.householdId === id);
      return members.length && members.every((record) => targetIds.has(record.id));
    }).map((document) => document.id);
    return { targets, remaining, family: familyRecords, households: householdRecords, erasedHouseholdIds, subjects, erasedEmails, orderUpdates, subscriptions, warnings, discountCodes, lists, mirrorCustomers, mirrorSubscriptions, customerDocs, auditDocs };
  };

  const describe = (scope) => ({
    people: scope.targets.map((record) => ({ id: record.id, name: fullName(record), email: identityEmails(record, record.household)[0] || '', tier: record.membershipTier || '', junior: juniorRecord(record), status: record.status || '',
      justgo: record.justgoSyncStatus === 'synced' || record.renewalMethod === 'justgo' || Boolean(record.affiliationNumber) })),
    family: scope.family.map((record) => ({ id: record.id, name: fullName(record), junior: juniorRecord(record), erased: scope.targets.some((target) => target.id === record.id) })),
    remaining: scope.remaining.map((record) => ({ id: record.id, name: fullName(record), junior: juniorRecord(record) })),
    ordersRedacted: scope.orderUpdates.length, subscriptionsToCancel: [...scope.subscriptions.keys()], warnings: scope.warnings,
    related: { discountCodes: scope.discountCodes.length, lists: scope.lists.length, stripeRecords: scope.mirrorCustomers.length + scope.mirrorSubscriptions.length },
    deletedRecords: [...scope.auditDocs].map(([id, document]) => ({ id, summary: document.data().summary, deletedAt: document.data().createdAt?.toDate?.() || null }))
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
      res.json(describe(scope));
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
      if (cancellations.length) {
        const writeKey = process.env.STRIPE_SUBSCRIPTION_ADMIN_KEY || '';
        if (!/^(sk|rk)_(test|live)_/.test(writeKey)) return res.status(503).json({ error: 'Stripe subscriptions must be cancelled, but STRIPE_SUBSCRIPTION_ADMIN_KEY is not set. Nothing was erased.' });
        const keyMode = writeKey.includes('_live_') ? 'live' : 'test';
        if (cancellations.some(([id, mode]) => !/^sub_[a-zA-Z0-9_]+$/.test(id) || mode !== keyMode)) {
          return res.status(400).json({ error: 'A linked subscription cannot be cancelled with the configured Stripe key. Nothing was erased.' });
        }
        const request = stripeReportRequest(writeKey);
        for (const [id] of cancellations) {
          let current = null;
          try { current = await request(`subscriptions/${encodeURIComponent(id)}`); }
          catch (error) { if (!/No such subscription/i.test(error.message)) throw error; }
          if (current && current.status !== 'canceled') await request(`subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
        }
      }

      const targetIds = new Set(scope.targets.map((record) => record.id));
      const renewalInvites = [];
      for (let index = 0; index < scope.targets.length; index += 30) {
        const ids = scope.targets.slice(index, index + 30).map((record) => record.id);
        renewalInvites.push(...(await adminDb.collection('renewalInvites').where('membershipIds', 'array-contains-any', ids).get()).docs);
      }
      const batch = adminDb.batch();
      new Map(renewalInvites.map((document) => [document.id, document])).forEach((document) => batch.delete(document.ref));
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
      scope.discountCodes.forEach((document) => batch.update(document.ref, { email: '***', name: '***' }));
      scope.lists.forEach((document) => batch.delete(document.ref));
      [...scope.mirrorCustomers, ...scope.mirrorSubscriptions].forEach((document) => batch.update(document.ref, { name: '', email: '' }));
      for (const [id, mode] of cancellations) {
        batch.set(adminDb.collection('stripeSubscriptions').doc(`FCC-${mode}-${id}`), { status: 'Inactive', stripeStatus: 'canceled', reason: 'Cancelled for GDPR erasure', name: '', email: '' }, { merge: true });
      }
      scope.customerDocs.forEach((document) => {
        if (scope.erasedEmails.has(normalizeEmail(document.data().email))) batch.delete(document.ref);
        else batch.update(document.ref, { membershipIds: FieldValue.arrayRemove(...targetIds) });
      });
      scope.auditDocs.forEach((document) => batch.update(document.ref, { snapshot: null, personalDataErased: true, personalDataErasedAt: Timestamp.now() }));
      const people = scope.targets.map((record) => ({ name: maskName(fullName(record)), email: maskEmail(identityEmails(record, record.household)[0]), membershipNumber: maskMembershipNumber(record.affiliationNumber), tier: record.membershipTier || '' }));
      batch.create(adminDb.collection('adminDeletionAudit').doc(), {
        kind: 'gdpr-erasure', adminUid: admin.uid, createdAt: Timestamp.now(), personalDataErased: true, snapshot: null,
        recordIdHash: crypto.createHash('sha256').update([...targetIds].sort().join(',') || 'lookup').digest('hex'),
        summary: { label: 'GDPR erasure', scope: left.length ? 'person' : scope.family.length > 1 ? 'family' : 'person', people, ordersRedacted: scope.orderUpdates.map(({ id }) => id),
          subscriptionsCancelled: cancellations.map(([id]) => id), earlierDeletionsPurged: scope.auditDocs.size },
        lookupKeys: [...new Set(scope.subjects.flatMap((subject) => [...personLookupKeys(secret, subject), ...(subject.email ? [lookupKey(secret, 'email', subject.email)] : [])]))]
      });
      await batch.commit();

      const manual = [];
      if (scope.targets.some((record) => record.justgoSyncStatus === 'synced' || record.renewalMethod === 'justgo' || record.affiliationNumber)) manual.push('Remove them from JustGo, or the nightly sync will recreate the record.');
      if (cancellations.length) manual.push('Delete the customer in the Stripe dashboard so its name and email are removed there.');
      manual.push('Remove any rows about them from Google Sheets and form responses.');
      res.json({ success: true, erased: people.length, ordersRedacted: scope.orderUpdates.length, subscriptionsCancelled: cancellations.length, earlierDeletionsPurged: scope.auditDocs.size, warnings: scope.warnings, manual });
    } catch (error) {
      console.error('GDPR erasure failed:', error.message);
      res.status(500).json({ error: 'Erasure could not be completed. Check the record and try again.' });
    }
  });
};
