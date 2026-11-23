import { clubYearDates, clubYearOf, recordClubYear } from './clubYear.js';

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

/**
 * A subscription carries on into later club years without being bought again, so each of its items is also an
 * entitlement in every club year after the one it was bought for, up to the current one. It stops at the end the member
 * asked for (`endsAt`) or, once stopped, at the date it was paid up to.
 */
export const continuingEntitlements = (subscriptionItems = [], now = new Date()) => {
  const current = clubYearOf(now);
  return (Array.isArray(subscriptionItems) ? subscriptionItems : []).flatMap((item) => {
    const started = recordClubYear(item);
    // Items from before subscriptions carried on (no `interval`) ended with their own club year.
    if (!item?.productId || !item.interval || !Number.isInteger(started) || started >= current) return [];
    const ended = toDate(item.status === 'active' ? item.endsAt : item.paidUntil || item.cancelledAt || item.endedAt);
    if (item.status !== 'active' && !ended) return [];
    const years = [];
    for (let year = started + 1; year <= current && !(ended && ended <= clubYearDates(year).start); year += 1) {
      years.push({ productId: item.productId, name: item.name || '', type: 'subscription', orderRef: item.orderRef || '', grantedAt: item.startedAt || null,
        clubYear: year, subscriptionId: item.subscriptionId || '', ...(item.lineId ? { lineId: item.lineId } : {}), ...(ended ? { endedAt: ended } : {}) });
    }
    return years;
  });
};

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
