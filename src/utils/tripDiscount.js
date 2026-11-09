import { clubYearOf, recordClubYear } from './clubYear.js';

/**
 * Automatic discounts on single-day trips for attendees who hold a qualifying product: by default £10 off for annual boat
 * hire, and another £10 for a coaching subscription. Admins change the rules (settings/tripDiscounts); these defaults apply
 * until they do. Holdings count if bought this club year (from 1 March; subscriptions end with the club year) or in the same
 * basket. Owning kit alone never qualifies. Products in a rule are locked so admins cannot delete them and silently switch
 * the discount off.
 */
export const DEFAULT_TRIP_DISCOUNTS = [
  { id: 'boat-hire', productIds: ['boat-hire'], amount: 10, label: 'annual boat hire', short: 'Kit hire' },
  { id: 'subscription', productIds: ['blue-sub', 'gold-sub'], amount: 10, label: 'a coaching subscription', short: 'Subscription' }
];

export const TRIP_DISCOUNT_LIMITS = { rules: 10, products: 10, amount: 100, label: 60, short: 30 };
// Only products recorded as a membership's entitlements, so a holding bought earlier in the club year still counts.
export const TRIP_DISCOUNT_CATEGORIES = ['SERVICES', 'SUBSCRIPTIONS'];
const RULE_ID = /^[a-z0-9-]{1,40}$/;

/** The saved rules, or the defaults when none have been saved. An empty saved list means no trip discounts. */
export const tripDiscountRules = (saved) => Array.isArray(saved?.rules) ? saved.rules : DEFAULT_TRIP_DISCOUNTS;

/**
 * Checks rules an admin submitted. Each qualifying product must be a shop service or subscription in `catalogue` and
 * belong to one rule only. Returns `{ value }` or `{ error }`.
 */
export const validateTripDiscounts = (rules, catalogue = []) => {
  if (!Array.isArray(rules) || rules.length > TRIP_DISCOUNT_LIMITS.rules) return { error: `Keep up to ${TRIP_DISCOUNT_LIMITS.rules} trip discounts.` };
  const value = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || typeof rule.id !== 'string' || !RULE_ID.test(rule.id) || value.some((other) => other.id === rule.id)) {
      return { error: 'Each trip discount needs its own identity.' };
    }
    const short = typeof rule.short === 'string' ? rule.short.trim().replace(/\s+/g, ' ') : '';
    const label = typeof rule.label === 'string' ? rule.label.trim().replace(/\s+/g, ' ') : '';
    if (!short || short.length > TRIP_DISCOUNT_LIMITS.short) return { error: `Give each trip discount a short name of up to ${TRIP_DISCOUNT_LIMITS.short} characters.` };
    if (!label || label.length > TRIP_DISCOUNT_LIMITS.label) return { error: `Describe what qualifies for each trip discount in up to ${TRIP_DISCOUNT_LIMITS.label} characters.` };
    if (value.some((other) => other.short.toLowerCase() === short.toLowerCase() || other.label.toLowerCase() === label.toLowerCase())) {
      return { error: 'Give each trip discount a different name and description.' };
    }
    const amount = typeof rule.amount === 'number' ? rule.amount : NaN;
    if (!Number.isFinite(amount) || amount <= 0 || amount > TRIP_DISCOUNT_LIMITS.amount || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
      return { error: `Set each trip discount between £0.01 and £${TRIP_DISCOUNT_LIMITS.amount}.` };
    }
    const productIds = Array.isArray(rule.productIds) ? [...new Set(rule.productIds)] : [];
    if (!productIds.length || productIds.length > TRIP_DISCOUNT_LIMITS.products) {
      return { error: `Choose between 1 and ${TRIP_DISCOUNT_LIMITS.products} qualifying products for ${short}.` };
    }
    for (const id of productIds) {
      if (!catalogue.some((product) => product.id === id && TRIP_DISCOUNT_CATEGORIES.includes(product.category))) {
        return { error: `Qualifying products for ${short} must be services or subscriptions in the shop.` };
      }
      if (value.some((other) => other.productIds.includes(id))) return { error: 'A product can qualify for one trip discount only.' };
    }
    value.push({ id: rule.id, productIds, amount: Math.round(amount * 100) / 100, label, short });
  }
  return { value };
};

const lowerFirst = (name) => (/^[A-Z][A-Z]/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));

/** "Kit hire discount applied", "Kit hire and subscription discounts applied", etc., from a line's `tripDiscountReasons`. */
export const tripDiscountText = (reasons = [], rules = DEFAULT_TRIP_DISCOUNTS) => {
  const names = rules.filter((discount) => reasons.includes(discount.label)).map((discount) => discount.short);
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} discount applied`;
  const rest = names.slice(1).map(lowerFirst);
  return `${[names[0], ...rest.slice(0, -1)].join(', ')} and ${rest.at(-1)} discounts applied`;
};

const pounds = (amount) => `£${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;

/** For event cards: "£10 off with annual boat hire, and £10 off with a coaching subscription." */
export const tripDiscountSummary = (rules = DEFAULT_TRIP_DISCOUNTS) => {
  const parts = rules.map((discount) => `${pounds(discount.amount)} off with ${discount.label}`);
  if (!parts.length) return '';
  return `${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`}.`;
};

export const lockedProductIds = (rules = DEFAULT_TRIP_DISCOUNTS) => [...new Set(rules.flatMap((discount) => discount.productIds))];
export const isLockedProduct = (id, rules = DEFAULT_TRIP_DISCOUNTS) => lockedProductIds(rules).includes(id);
export const tripDiscountForProduct = (id, rules = DEFAULT_TRIP_DISCOUNTS) => rules.find((discount) => discount.productIds.includes(id)) || null;

export const isTripEvent = (item) => item?.category === 'EVENTS' && item?.eventSchedule?.mode === 'single';

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(typeof value === 'object' && Number.isFinite(value._seconds) ? value._seconds * 1000 : value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/** Product ids from a member's entitlements (or volunteer privileges) for the current club year and not since cancelled. */
export const currentPrivilegeIds = (privileges = [], now = new Date()) => {
  const year = clubYearOf(now);
  return (Array.isArray(privileges) ? privileges : [])
    .filter((privilege) => recordClubYear(privilege) === year && !(privilege?.endedAt && toDate(privilege.endedAt) <= now))
    .map((privilege) => privilege.productId)
    .filter(Boolean);
};

export const tripDiscountFor = (heldProductIds = [], rules = DEFAULT_TRIP_DISCOUNTS) => {
  const held = new Set(heldProductIds);
  const applied = rules.filter((discount) => discount.productIds.some((id) => held.has(id)));
  return { amount: applied.reduce((total, discount) => total + discount.amount, 0), reasons: applied.map((discount) => discount.label) };
};

/**
 * Returns the lines with `tripDiscount` (and `tripDiscountReasons`) set on each single-day event ticket, from what each
 * attendee holds. `privilegesByPerson` maps a person id to their membership's privileges. The own-kit tick plays no part.
 */
export const applyTripDiscounts = (lines, people, privilegesByPerson = new Map(), now = new Date(), rules = DEFAULT_TRIP_DISCOUNTS) => {
  const discounts = new Map();
  for (const person of people || []) {
    const ownLines = (person.lineIds || []).map((lineId) => lines.find((line) => line.lineId === lineId)).filter(Boolean);
    const trips = ownLines.filter(isTripEvent);
    if (!trips.length) continue;
    const { amount, reasons } = tripDiscountFor([...currentPrivilegeIds(privilegesByPerson.get(person.id), now),
      ...ownLines.filter((line) => line.clubYearPart !== 'next').map((line) => line.id)], rules);
    if (amount > 0) trips.forEach((line) => discounts.set(line.lineId, { tripDiscount: amount, tripDiscountReasons: reasons }));
  }
  return lines.map((line) => {
    const { tripDiscount: _amount, tripDiscountReasons: _reasons, ...rest } = line;
    return discounts.has(line.lineId) ? { ...rest, ...discounts.get(line.lineId) } : rest;
  });
};
