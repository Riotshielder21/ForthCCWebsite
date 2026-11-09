import { clubYearDates, clubYearOf, recordClubYear } from './clubYear.js';
import { grantsMembership, isMembership } from './checkout.js';

/**
 * A membership term is one document per person per club year in `membershipTerms`. It records how that year's membership was
 * held (tier, start, end, order, source) and the entitlements bought for that year (boat hire, key hire and similar) in `items`.
 * A term with no `source` holds entitlements only: the person bought them without a website membership for that year.
 * The member record keeps `status` and `validUntil` as the current term.
 */
export const termId = (membershipId, clubYear) => `${membershipId}_${clubYear}`;

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  const date = new Date(typeof value === 'object' && Number.isFinite(value._seconds) ? value._seconds * 1000 : value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/** A term's entitlements, each carrying its club year, in the shape readers such as `holdsForClubYear` take. */
export const termEntitlements = (terms = []) => terms.flatMap((term) =>
  (Array.isArray(term.items) ? term.items : []).map((item) => ({ ...item, clubYear: term.clubYear })));

/** Entitlement record for a purchased line, kept on that club year's term. */
export const entitlementFor = (item, orderRef, grantedAt) => ({
  productId: item.id, name: item.name || '', type: item.type || '', orderRef, grantedAt, ...(item.lineId ? { lineId: item.lineId } : {})
});

/** When a membership bought at `paidAt` for `clubYear` starts: the club year's start, or the payment when that is later. */
export const termStart = (clubYear, paidAt) => {
  const start = clubYearDates(clubYear).start;
  const paid = toDate(paidAt);
  return paid && paid > start ? paid : start;
};

const legacySource = (fields) => fields.source === 'website' ? 'website'
  : fields.justgoSyncStatus === 'synced' || fields.renewalMethod === 'justgo' || fields.source === 'justgo' ? 'justgo' : 'imported';

/**
 * Terms rebuilt from a version-3 member record's `privileges`, `history` and `clubYears`, plus the orders named in its history.
 * `orders` maps an order reference to the order's fields. Returns the terms keyed by club year, the order references to link back
 * to this member, and the recurring membership subscription to record when the member has no reference yet.
 */
export const legacyTerms = (membershipId, fields, orders = new Map(), defaultStripeMode = 'test') => {
  const terms = new Map();
  const termFor = (clubYear) => {
    if (!terms.has(clubYear)) terms.set(clubYear, { membershipId, clubYear, items: [] });
    return terms.get(clubYear);
  };
  for (const privilege of Array.isArray(fields.privileges) ? fields.privileges : []) {
    const clubYear = recordClubYear(privilege);
    if (!Number.isInteger(clubYear) || !privilege?.productId) continue;
    const { clubYear: _year, ...item } = privilege;
    termFor(clubYear).items.push(item);
  }
  const orderRefs = [...new Set((Array.isArray(fields.history) ? fields.history : []).map((entry) => entry?.orderRef)
    .filter((ref) => typeof ref === 'string' && ref))];
  // Each club year's membership is matched to the order that bought it, or to the record's source when none did.
  const bought = new Map();
  for (const orderRef of orderRefs) {
    const order = orders.get(orderRef);
    const person = order?.people?.find((entry) => entry.membershipId === membershipId);
    if (!person) continue;
    const paidAt = toDate(order.paidAt) || toDate(fields.history.find((entry) => entry.orderRef === orderRef)?.paidAt);
    const paidYear = paidAt ? clubYearOf(paidAt) : null;
    const grantedYears = Array.isArray(person.grantMembershipYears) ? person.grantMembershipYears : person.grantMembership && paidYear ? [paidYear] : [];
    for (const line of order.items || []) {
      if (line.revokedAt || !(person.lineIds || []).includes(line.lineId)) continue;
      const year = line.clubYear || paidYear;
      if (!Number.isInteger(year)) continue;
      const membership = isMembership(line);
      if (!membership && !(grantsMembership(line) && grantedYears.includes(year))) continue;
      if (bought.has(year) && bought.get(year).source === 'website' && !membership) continue;
      bought.set(year, { source: membership ? 'website' : 'included', orderRef, paidAt, line });
    }
  }
  const years = [...new Set((Array.isArray(fields.clubYears) ? fields.clubYears : []).map(Number).filter(Number.isInteger))].sort();
  const validUntil = toDate(fields.validUntil);
  for (const year of years) {
    const purchase = bought.get(year);
    const term = termFor(year);
    const end = clubYearDates(year).end;
    // A membership cut short (revoked) ends at the member's validUntil.
    const cutShort = year === years.at(-1) && validUntil && validUntil < end && validUntil > clubYearDates(year).start;
    Object.assign(term, {
      tier: purchase?.line?.membershipTier || fields.membershipTier || '',
      source: purchase?.source || (fields.source === 'website' ? 'website' : legacySource(fields)),
      start: purchase ? termStart(year, purchase.paidAt) : clubYearDates(year).start,
      end: cutShort ? validUntil : end,
      orderRef: purchase?.orderRef || '',
      ...(purchase?.source === 'included' ? { includedWith: { productId: purchase.line.id, name: purchase.line.name || '' } } : {})
    });
  }
  let stripeMembership = null;
  if (!Object.hasOwn(fields, 'stripeMembershipSubscriptionId')) {
    const subscribed = orderRefs.map((ref) => orders.get(ref)).find((order) => order?.stripeSubscriptionId
      && (order.items || []).some((item) => item.category === 'MEMBERSHIP' && item.type === 'subscription'));
    stripeMembership = subscribed
      ? { stripeMembershipSubscriptionId: subscribed.stripeSubscriptionId, stripeMembershipMode: subscribed.stripe?.mode || subscribed.stripeMode || defaultStripeMode }
      : { stripeMembershipSubscriptionId: '', stripeMembershipMode: '' };
  }
  // Key hire bought before `keyAccess` was recorded on the member still grants the boathouse code.
  const keyHire = [...terms.values()].flatMap((term) => term.items).find((item) => item.productId === 'keyhire' && !item.endedAt);
  const keyAccess = keyHire && !fields.keyAccess?.grantedAt && !fields.keyAccess?.revokedAt
    ? { ...(fields.keyAccess || {}), grantedAt: keyHire.grantedAt || null, source: 'purchase' } : null;
  return { terms: [...terms.values()], orderRefs, stripeMembership, keyAccess };
};
