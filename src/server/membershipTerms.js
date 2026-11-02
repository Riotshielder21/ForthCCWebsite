import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { clubYearDates } from '../utils/clubYear.js';
import { entitlementFor, termEntitlements, termId, termStart } from '../utils/membershipTerms.js';

const chunks = (values, size = 30) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

/** Term documents for the given members, grouped by membership id. Pass a transaction to read inside it. */
export const loadTerms = async (db, membershipIds, reader = null) => {
  const ids = [...new Set(membershipIds.filter(Boolean))];
  const byMember = new Map(ids.map((id) => [id, []]));
  for (const group of chunks(ids)) {
    const query = db.collection('membershipTerms').where('membershipId', 'in', group);
    const snapshot = reader ? await reader.get(query) : await query.get();
    snapshot.docs.forEach((document) => byMember.get(document.data().membershipId)?.push(document));
  }
  return byMember;
};

/** Each member's entitlements across all their terms, keyed by membership id. */
export const loadEntitlements = async (db, membershipIds, reader = null) => {
  const terms = await loadTerms(db, membershipIds, reader);
  return new Map([...terms].map(([id, documents]) => [id, termEntitlements(documents.map((document) => document.data()))]));
};

/** The member fields with `entitlements` attached, for readers such as `holdsForClubYear` and `renewalBasket`. */
export const withEntitlements = async (db, members) => {
  const entitlements = await loadEntitlements(db, [...members.keys()]);
  return new Map([...members].map(([id, data]) => [id, { ...data, entitlements: entitlements.get(id) || [] }]));
};

/** Orders recording a purchase for the member, newest first. */
export const memberOrders = async (db, membershipId, reader = null) => {
  const query = db.collection('orders').where('membershipIds', 'array-contains', membershipId);
  const snapshot = reader ? await reader.get(query) : await query.get();
  return snapshot.docs.sort((a, b) => (b.data().paidAt?.toMillis() || 0) - (a.data().paidAt?.toMillis() || 0));
};

/** Each member's purchase history from their orders: the order, when it was paid and that person's lines. */
export const loadPurchases = async (db, membershipIds) => {
  const ids = [...new Set(membershipIds.filter(Boolean))];
  const byMember = new Map(ids.map((id) => [id, []]));
  const seen = new Set();
  for (const group of chunks(ids)) {
    const snapshot = await db.collection('orders').where('membershipIds', 'array-contains-any', group).get();
    for (const document of snapshot.docs) {
      if (seen.has(document.id)) continue;
      seen.add(document.id);
      const order = document.data();
      for (const person of order.people || []) {
        if (!byMember.has(person.membershipId)) continue;
        const items = (order.items || []).filter((item) => (person.lineIds || []).includes(item.lineId));
        byMember.get(person.membershipId).push({ orderRef: document.id, paidAt: order.paidAt || null, items });
      }
    }
  }
  byMember.forEach((purchases) => purchases.sort((a, b) => (a.paidAt?.toMillis?.() || 0) - (b.paidAt?.toMillis?.() || 0)));
  return byMember;
};

/**
 * Records one person's purchase on their terms: a membership term for each club year the membership covers and the other
 * club-year lines as entitlements. `memberships` maps a club year to `{ line, included }`.
 */
export const writePurchaseTerms = (transaction, db, { membershipId, orderRef, paidAt, memberships, tier, entitlementLines, yearOf }) => {
  const terms = db.collection('membershipTerms');
  const base = (clubYear) => ({ membershipId, clubYear, updatedAt: paidAt });
  for (const [clubYear, { line, included }] of memberships) {
    transaction.set(terms.doc(termId(membershipId, clubYear)), {
      ...base(clubYear), tier: included ? tier : line.membershipTier || tier, source: included ? 'included' : 'website',
      start: Timestamp.fromDate(termStart(clubYear, paidAt)), end: Timestamp.fromDate(clubYearDates(clubYear).end), orderRef,
      includedWith: included ? { productId: line.id, name: line.name || '' } : FieldValue.delete(),
      revokedAt: FieldValue.delete(), revokeReason: FieldValue.delete(), revokedBy: FieldValue.delete()
    }, { merge: true });
  }
  const byYear = new Map();
  for (const line of entitlementLines) byYear.set(yearOf(line), [...(byYear.get(yearOf(line)) || []), entitlementFor(line, orderRef, paidAt)]);
  for (const [clubYear, items] of byYear) {
    transaction.set(terms.doc(termId(membershipId, clubYear)), { ...base(clubYear), items: FieldValue.arrayUnion(...items) }, { merge: true });
  }
};

/** Writes `endedAt` (and any extra fields) on the term items that match and have not ended yet. Returns how many ended. */
export const endTermItems = (writer, termDocuments, matches, endedAt, extra = {}) => {
  let ended = 0;
  for (const document of termDocuments) {
    const items = document.data().items || [];
    let changed = false;
    const next = items.map((item) => {
      if (item.endedAt || !matches(item)) return item;
      changed = true;
      ended += 1;
      return { ...item, endedAt, ...extra };
    });
    if (changed) writer.update(document.ref, { items: next, updatedAt: endedAt });
  }
  return ended;
};
