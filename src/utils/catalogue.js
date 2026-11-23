import { clubYearOf } from './clubYear.js';

/**
 * How a product is charged. Fixed is the full price whenever bought; prorated is the full price, or 60% from 1 October;
 * subscription is a monthly price paid on the 1st, or twelve months paid every 1 March, until cancelled.
 */
export const PRICING_MODES = ['fixed', 'prorated', 'subscription'];
const CATEGORY_TYPES = { VOUCHERS: 'voucher', EVENTS: 'event-ticket', SUBSCRIPTIONS: 'subscription', MERCHANDISE: 'merchandise' };

/**
 * The type follows the category; only services choose a pricing mode, and only subscription pricing can be paid
 * monthly (when `allowMonthly` is set). Paid annually, a subscription's first payment covers the rest of the club year
 * in 20% steps unless `thresholdProration` is turned off, when it is the full year.
 */
export const productTerms = (product) => {
  const subscriptionTerms = (allowMonthly) => ({ type: 'subscription', pricingMode: 'subscription', allowMonthly, thresholdProration: product.thresholdProration !== false });
  const fixed = { pricingMode: 'fixed', allowMonthly: false, thresholdProration: false };
  if (product.category === 'MEMBERSHIP') return { type: product.type === 'external' ? 'external' : 'annual-oneoff', ...fixed };
  if (product.category === 'SERVICES') {
    const pricingMode = PRICING_MODES.includes(product.pricingMode) ? product.pricingMode : 'fixed';
    return pricingMode === 'subscription' ? subscriptionTerms(product.allowMonthly === true)
      : { type: 'yearly-service', pricingMode, allowMonthly: false, thresholdProration: false };
  }
  if (product.category === 'SUBSCRIPTIONS') return subscriptionTerms(product.allowMonthly === true);
  return { type: CATEGORY_TYPES[product.category] || 'annual-oneoff', ...fixed };
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
  if (product.category === 'MEMBERSHIP' && typeof rest.description === 'string') {
    rest.description = rest.description.replace(/\bSCA\b/g, 'Paddle Scotland');
  }
  if (product.category === 'EVENTS' && eventSchedule) rest.eventSchedule = eventSchedule;
  return { ...rest, ...productTerms(product), ...(rule ? { membershipRule: rule, membershipRequired: rule !== 'none' } : {}) };
};

const scheduled = (product) => Number.isInteger(product.nextYearPriceFrom) && typeof product.nextYearPrice === 'number'
  && Number.isFinite(product.nextYearPrice) && product.nextYearPrice >= 0;

/**
 * A product's price this club year (`basePrice`) and next (`nextYearPrice`) at `now`. Staff can set next club year's
 * price ahead (`nextYearPrice`, from club year `nextYearPriceFrom`): it is quoted and charged for anything bought for
 * that year and for subscription payments from its 1 March, and it becomes the price on that 1 March. Until then this
 * year's price still applies to this year, so a January purchase for this year costs this year's price.
 */
export const yearPrices = (product, now = new Date()) => {
  if (product.basePrice === undefined && !scheduled(product)) return {};
  const current = clubYearOf(now);
  const thisYear = scheduled(product) && product.nextYearPriceFrom <= current ? product.nextYearPrice : Number(product.basePrice);
  return { basePrice: thisYear, nextYearPrice: scheduled(product) && product.nextYearPriceFrom <= current + 1 ? product.nextYearPrice : thisYear };
};

/** The product editor's next club year price: blank unless one is set for the coming club year. */
export const nextYearPriceInput = (product, now = new Date()) =>
  scheduled(product) && product.nextYearPriceFrom === clubYearOf(now) + 1 ? String(product.nextYearPrice) : '';

/** What the product editor saves for next club year's price: it starts on the coming 1 March, or is cleared when blank. */
export const nextYearPriceFields = (input, now = new Date()) => String(input ?? '').trim() === ''
  ? { nextYearPrice: null, nextYearPriceFrom: null } : { nextYearPrice: Number(input), nextYearPriceFrom: clubYearOf(now) + 1 };

// Only products saved in the database are on sale: a starter product in src/constants/products.js is not, until it
// has a record. Inactive products leave the shop. Sorted by `sortOrder`. Trip discount products cannot be made
// inactive (firestore.rules). Prices are those in force at `now` (see yearPrices).
export const resolveCatalogue = (saved, now = new Date()) => saved.filter((product) => product.active !== false)
  .map((product) => ({ ...normaliseProduct(product), ...yearPrices(product, now) })).sort((a, b) => a.sortOrder - b.sortOrder);

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