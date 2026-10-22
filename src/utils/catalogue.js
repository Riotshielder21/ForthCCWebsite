import { isLockedProduct } from './tripDiscount.js';

/**
 * How a product is charged. Fixed is the full price whenever bought; prorated is the full price, or 60% from 1 October;
 * subscription ("prorated monthly" for services) is a monthly price for each month left until the next 1 March.
 */
export const PRICING_MODES = ['fixed', 'prorated', 'subscription'];
const LEGACY_FIXED_SERVICES = ['keyhire'];
const CATEGORY_TYPES = { VOUCHERS: 'voucher', EVENTS: 'event-ticket', SUBSCRIPTIONS: 'subscription', MERCHANDISE: 'merchandise' };

/**
 * The type follows the category; only services choose a pricing mode. Older saved products are mapped here: a
 * `yearly-service` was always prorated, so it stays prorated, except key hire, which is a fixed price. Only subscription
 * pricing can be paid monthly, and it allows monthly payments unless an admin turns them off.
 */
export const productTerms = (product) => {
  if (product.category === 'MEMBERSHIP') return { type: product.type === 'external' ? 'external' : 'annual-oneoff', pricingMode: 'fixed', allowMonthly: false };
  if (product.category === 'SERVICES') {
    const legacy = product.type === 'subscription' ? 'subscription' : product.type === 'yearly-service' && !LEGACY_FIXED_SERVICES.includes(product.id) ? 'prorated' : 'fixed';
    const pricingMode = PRICING_MODES.includes(product.pricingMode) ? product.pricingMode : legacy;
    return { type: pricingMode === 'subscription' ? 'subscription' : 'yearly-service', pricingMode, allowMonthly: pricingMode === 'subscription' && product.allowMonthly !== false };
  }
  if (product.category === 'SUBSCRIPTIONS') return { type: 'subscription', pricingMode: 'subscription', allowMonthly: product.allowMonthly !== false };
  return { type: CATEGORY_TYPES[product.category] || 'annual-oneoff', pricingMode: 'fixed', allowMonthly: false };
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
  const { membershipRule: _rule, membershipRequired: _required, ...rest } = product;
  return { ...rest, ...productTerms(product), ...(rule ? { membershipRule: rule, membershipRequired: rule !== 'none' } : {}) };
};

// Locked products (the trip discount depends on them) stay in the shop even if a deletion was saved.
export const resolveCatalogue = (defaults, saved) => {
  const products = new Map(defaults.map((product) => [product.id, product]));
  for (const product of saved) {
    if (product.deleted === true && isLockedProduct(product.id)) {
      const { deleted: _deleted, ...kept } = product;
      products.set(product.id, { ...products.get(product.id), ...kept });
    } else if (product.deleted === true) products.delete(product.id);
    else products.set(product.id, product);
  }
  return [...products.values()].map(normaliseProduct);
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