/**
 * Automatic discounts on single-day trips: £10 off for someone with annual boat hire, and another £10 for someone with a
 * coaching subscription. Holdings count if bought this club year (from 1 March; subscriptions end with the club year) or in
 * the same basket. The qualifying products are locked so admins cannot delete them and silently switch the discount off.
 */
export const TRIP_DISCOUNTS = [
  { id: 'boat-hire', productIds: ['boat-hire'], amount: 10, label: 'annual boat hire' },
  { id: 'subscription', productIds: ['blue-sub', 'gold-sub'], amount: 10, label: 'a coaching subscription' }
];

export const LOCKED_PRODUCT_IDS = [...new Set(TRIP_DISCOUNTS.flatMap((discount) => discount.productIds))];
export const isLockedProduct = (id) => LOCKED_PRODUCT_IDS.includes(id);

export const isTripEvent = (item) => item?.category === 'EVENTS' && item?.eventSchedule?.mode === 'single';

const clubYearStart = (now) => new Date(now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1, 2, 1);

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(typeof value === 'object' && Number.isFinite(value._seconds) ? value._seconds * 1000 : value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/** Product ids from a membership's privileges that were granted in the current club year and not since cancelled. */
export const currentPrivilegeIds = (privileges = [], now = new Date()) => {
  const start = clubYearStart(now);
  return (Array.isArray(privileges) ? privileges : [])
    .filter((privilege) => (toDate(privilege?.grantedAt) || 0) >= start && !(privilege?.endedAt && toDate(privilege.endedAt) <= now))
    .map((privilege) => privilege.productId)
    .filter(Boolean);
};

export const tripDiscountFor = (heldProductIds = []) => {
  const held = new Set(heldProductIds);
  const applied = TRIP_DISCOUNTS.filter((discount) => discount.productIds.some((id) => held.has(id)));
  return { amount: applied.reduce((total, discount) => total + discount.amount, 0), reasons: applied.map((discount) => discount.label) };
};

/**
 * Returns the lines with `tripDiscount` (and `tripDiscountReasons`) set on each single-day event ticket, from what each
 * attendee holds. `privilegesByPerson` maps a person id to their membership's privileges.
 */
export const applyTripDiscounts = (lines, people, privilegesByPerson = new Map(), now = new Date()) => {
  const discounts = new Map();
  for (const person of people || []) {
    const ownLines = (person.lineIds || []).map((lineId) => lines.find((line) => line.lineId === lineId)).filter(Boolean);
    const trips = ownLines.filter(isTripEvent);
    if (!trips.length) continue;
    const { amount, reasons } = tripDiscountFor([...currentPrivilegeIds(privilegesByPerson.get(person.id), now), ...ownLines.map((line) => line.id)]);
    if (amount > 0) trips.forEach((line) => discounts.set(line.lineId, { tripDiscount: amount, tripDiscountReasons: reasons }));
  }
  return lines.map((line) => {
    const { tripDiscount: _amount, tripDiscountReasons: _reasons, ...rest } = line;
    return discounts.has(line.lineId) ? { ...rest, ...discounts.get(line.lineId) } : rest;
  });
};
