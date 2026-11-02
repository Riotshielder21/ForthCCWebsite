import { isLockedProduct } from './tripDiscount.js';

/**
 * How a product is charged. Fixed is the full price whenever bought; prorated is the full price, or 60% from 1 October;
 * subscription ("prorated monthly" for services) is a monthly price for each month left until the next 1 March.
 */
export const PRICING_MODES = ['fixed', 'prorated', 'subscription'];
const CATEGORY_TYPES = { VOUCHERS: 'voucher', EVENTS: 'event-ticket', SUBSCRIPTIONS: 'subscription', MERCHANDISE: 'merchandise' };

/**
 * The type follows the category; only services choose a pricing mode, and only subscription pricing can be paid
 * monthly (when `allowMonthly` is set).
 */
export const productTerms = (product) => {
  if (product.category === 'MEMBERSHIP') return { type: product.type === 'external' ? 'external' : 'annual-oneoff', pricingMode: 'fixed', allowMonthly: false };
  if (product.category === 'SERVICES') {
    const pricingMode = PRICING_MODES.includes(product.pricingMode) ? product.pricingMode : 'fixed';
    return { type: pricingMode === 'subscription' ? 'subscription' : 'yearly-service', pricingMode, allowMonthly: pricingMode === 'subscription' && product.allowMonthly === true };
  }
  if (product.category === 'SUBSCRIPTIONS') return { type: 'subscription', pricingMode: 'subscription', allowMonthly: product.allowMonthly === true };
  return { type: CATEGORY_TYPES[product.category] || 'annual-oneoff', pricingMode: 'fixed', allowMonthly: false };
};

const LEGACY_FIXED_SERVICES = ['keyhire'];

/**
 * Converts a saved product to the current shape. `active` replaces the soft-delete `deleted` flag (and any
 * `hidden`/`visible`), `sortOrder` is backfilled from the shop's display order (`displayIndex`), and products saved
 * before `pricingMode`/`allowMonthly` existed get the terms they were sold on: a `yearly-service` was prorated except
 * key hire, and a subscription could be paid monthly. A partial override with no `category` (a removed starter
 * product) keeps the starter terms. Returns only what changes.
 */
export const productUpgrade = (fields, displayIndex) => {
  const set = {};
  const remove = ['deleted', 'hidden', 'visible'].filter((key) => key in fields);
  if (typeof fields.active !== 'boolean') set.active = fields.deleted !== true && fields.hidden !== true && fields.visible !== false;
  if (typeof fields.sortOrder !== 'number') set.sortOrder = (displayIndex + 1) * 10;
  if (fields.category && !PRICING_MODES.includes(fields.pricingMode)) {
    set.pricingMode = fields.category === 'SUBSCRIPTIONS' || (fields.category === 'SERVICES' && fields.type === 'subscription') ? 'subscription'
      : fields.category === 'SERVICES' && fields.type === 'yearly-service' && !LEGACY_FIXED_SERVICES.includes(fields.id) ? 'prorated' : 'fixed';
  }
  if (fields.category && typeof fields.allowMonthly !== 'boolean') set.allowMonthly = (set.pricingMode || fields.pricingMode) === 'subscription';
  return { set, remove };
};

/**
 * Who can buy an event, service or subscription: 'required' needs a club membership, 'none' is open to non-members
 * (kept as contacts), and 'included' makes each person a member for the club year. Older products only had
 * `membershipRequired`, which events could turn off.
 */
export const MEMBERSHIP_RULES = ['required', 'none', 'included'];
const MEMBERSHIP_RULE_CATEGORIES = ['EVENTS', 'SERVICES', 'SUBSCRIPTIONS'];
export const productMembershipRule = (product) => {
  if (!MEMBERSHIP_RULE_CATEGORIES.includes(product.category)) return null;
  if (MEMBERSHIP_RULES.includes(product.membershipRule)) return product.membershipRule;
  return product.category === 'EVENTS' && product.membershipRequired === false ? 'none' : 'required';
};

export const normaliseProduct = (product) => {
  const rule = productMembershipRule(product);
  const { membershipRule: _rule, membershipRequired: _required, eventSchedule, ...rest } = product;
  if (product.category === 'EVENTS' && eventSchedule) rest.eventSchedule = eventSchedule;
  return { ...rest, ...productTerms(product), ...(rule ? { membershipRule: rule, membershipRequired: rule !== 'none' } : {}) };
};

// Inactive products leave the shop, except locked ones (the trip discount depends on them). Sorted by `sortOrder`.
export const resolveCatalogue = (defaults, saved) => {
  const products = new Map(defaults.map((product) => [product.id, product]));
  for (const product of saved) {
    if (product.active === false && isLockedProduct(product.id)) products.set(product.id, { ...products.get(product.id), ...product, active: true });
    else if (product.active === false) products.delete(product.id);
    else products.set(product.id, product);
  }
  return [...products.values()].map(normaliseProduct).sort((a, b) => a.sortOrder - b.sortOrder);
};

export const validateEventSchedule = (schedule) => {
  if (!schedule || !['single', 'consecutive', 'weekly'].includes(schedule.mode) || schedule.timeZone !== 'Europe/London') {
    throw new Error('Choose a single event, consecutive-day course, or consecutive-week course in Europe/London.');
  }
  const { startDate, startTime, endTime } = schedule;
  const count = schedule.mode === 'single' ? 1 : Number(schedule.mode === 'weekly' ? schedule.weeks : schedule.days);
  if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
    || !Number.isFinite(Date.parse(`${startDate}T00:00:00Z`))
    || new Date(`${startDate}T00:00:00Z`).toISOString().slice(0, 10) !== startDate
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime || '')
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime || '') || endTime <= startTime
    || !Number.isInteger(count) || count < 1 || count > 60) {
    throw new Error('Enter a valid date, a same-day end time after the start, and 1–60 course days or weeks.');
  }
  return { mode: schedule.mode, startDate, startTime, endTime,
    ...(schedule.mode === 'weekly' ? { weeks: count } : { days: count }), timeZone: 'Europe/London' };
};

export const eventSessions = (schedule) => {
  const valid = validateEventSchedule(schedule);
  return Array.from({ length: valid.mode === 'weekly' ? valid.weeks : valid.days }, (_, index) => {
    const date = new Date(`${valid.startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index * (valid.mode === 'weekly' ? 7 : 1));
    return { date: date.toISOString().slice(0, 10), startTime: valid.startTime, endTime: valid.endTime };
  });
};

export const eventScheduleLabel = (schedule) => {
  try {
    const sessions = eventSessions(schedule);
    const date = (value) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
    const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const duration = minutes(schedule.endTime) - minutes(schedule.startTime);
    const weekly = schedule.mode === 'weekly';
    return `${date(sessions[0].date)}${sessions.length > 1 ? ` to ${date(sessions.at(-1).date)} (${sessions.length} ${weekly ? 'weeks' : 'days'})` : ''}, ${schedule.startTime}–${schedule.endTime}${weekly ? ' weekly' : sessions.length > 1 ? ' daily' : ''}, ${duration} minutes per session (Europe/London)`;
  } catch {
    return 'Schedule unavailable';
  }
};