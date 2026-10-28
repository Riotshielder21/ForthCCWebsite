/**
 * The club year runs from 1 March to the end of February and is named by the year it starts (1 March 2027 to
 * 28/29 February 2028 is 2027). Every date here is taken in Europe/London, whatever time zone the server runs in.
 *
 * Payment schedule: monthly direct debits are on the 1st; the last one is 1 February and every subscription stops at
 * the start of 1 March. Current-year sales close earlier: memberships on 8 February and other items on 15 February.
 * From 1 January people can also buy for next club year.
 */
const TIME_ZONE = 'Europe/London';
const partsFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });

export const CURRENT_YEAR_SALES_CUTOFF_DAY = 15;
// This year's membership is sold until the end of February's first week.
export const LAST_MEMBERSHIP_SALE_DAY = 7;
export const JOINING_STEP = 0.2;

/** `{ year, month (0-based), day, hour }` in Europe/London. */
export const londonParts = (date = new Date()) => {
  const parts = Object.fromEntries(partsFormat.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month) - 1, day: Number(parts.day), hour: Number(parts.hour) };
};

/** Midnight at the start of a London calendar day; month may overflow (12 is next January). */
export const londonMidnight = (year, month, day) => {
  const utc = Date.UTC(year, month, day);
  // Clocks change at 01:00 UTC, so London is either 0 or 1 hour ahead at midnight UTC.
  return new Date(utc - londonParts(new Date(utc)).hour * 60 * 60 * 1000);
};

export const clubYearOf = (now = new Date()) => {
  const { year, month } = londonParts(now);
  return month >= 2 ? year : year - 1;
};

export const clubYearDates = (year) => ({
  start: londonMidnight(year, 2, 1),
  end: londonMidnight(year + 1, 2, 1),
  renewalOpens: londonMidnight(year + 1, 0, 1),
  membershipSaleEnds: londonMidnight(year + 1, 1, LAST_MEMBERSHIP_SALE_DAY + 1),
  salesCutoff: londonMidnight(year + 1, 1, CURRENT_YEAR_SALES_CUTOFF_DAY)
});

export const clubYearLabel = (year) => `${year}/${String((year + 1) % 100).padStart(2, '0')}`;

const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * The joining-month charge: the share of this month still to run (today included), rounded up to the next 20%.
 * In a 30-day month: 1st–6th 100%, 7th–12th 80%, 13th–18th 60%, 19th–24th 40%, 25th onwards 20%.
 */
export const joiningShare = (now = new Date()) => {
  const { year, month, day } = londonParts(now);
  const length = daysInMonth(year, month);
  return Math.ceil(((length - day + 1) * 5) / length) / 5;
};

/** The 1st of next month, when a new subscription's first direct debit is taken. */
export const nextFirst = (now = new Date()) => {
  const { year, month } = londonParts(now);
  return londonMidnight(year, month + 1, 1);
};

/** Whole monthly debits remaining in the club year, including the final February debit. */
export const fullMonthsAfterCurrent = (now = new Date()) => {
  const { year, month } = londonParts(now);
  return (clubYearOf(now) + 1 - year) * 12 + 1 - month;
};

/** Membership, services and subscriptions belong to a club year; events, merchandise and vouchers do not. */
export const clubYearKind = (item) => {
  if (item?.category === 'MEMBERSHIP') return item.type === 'external' ? null : 'membership';
  if (item?.category === 'SERVICES' || item?.category === 'SUBSCRIPTIONS') return item.pricingMode === 'subscription' || item.type === 'subscription' ? 'monthly' : 'service';
  return null;
};

export const CLUB_YEAR_CHOICES = ['this', 'next', 'both'];

/**
 * Which club years an item can be bought for now. Before 1 January only this year. From 1 January this year, next year
 * or both; this year's membership stops on 8 February and everything for this year stops on 15 February.
 */
export const clubYearChoices = (item, now = new Date()) => {
  const kind = clubYearKind(item);
  if (!kind) return [];
  const dates = clubYearDates(clubYearOf(now));
  if (now < dates.renewalOpens) return ['this'];
  const thisYearOnSale = now < (kind === 'membership' ? dates.membershipSaleEnds : dates.salesCutoff);
  return thisYearOnSale ? ['this', 'next', 'both'] : ['next'];
};

export const defaultClubYearChoice = (item, now = new Date()) => {
  const choices = clubYearChoices(item, now);
  return choices.includes('this') ? 'this' : choices[0] || null;
};

/** Normalises a requested choice; null means the choice is not on sale (or the item has no club year). */
export const resolveClubYearChoice = (item, requested, now = new Date()) => {
  const choices = clubYearChoices(item, now);
  if (!choices.length) return null;
  if (requested === undefined || requested === null || requested === '') return defaultClubYearChoice(item, now);
  return choices.includes(requested) ? requested : null;
};

/** The club years a choice covers, e.g. 'both' in January 2028 is [2027, 2028]. */
export const clubYearsFor = (choice, now = new Date()) => {
  const current = clubYearOf(now);
  return choice === 'next' ? [current + 1] : choice === 'both' ? [current, current + 1] : choice === 'this' ? [current] : [];
};

/**
 * When a monthly item bought now is debited. This year: from the next 1st while that is before 1 March (so not
 * when bought in February, when the joining-month charge is the only payment). Next year: from 1 March.
 */
export const monthlyDebits = (clubYear, now = new Date()) => {
  const current = clubYearOf(now);
  const { end, start } = clubYearDates(clubYear);
  const subscriptionEnd = end;
  if (clubYear > current) return { firstDebit: start, debits: 12, subscriptionEnd };
  const first = nextFirst(now);
  return first < subscriptionEnd ? { firstDebit: first, debits: fullMonthsAfterCurrent(now), subscriptionEnd }
    : { firstDebit: null, debits: 0, subscriptionEnd };
};

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  const date = new Date(typeof value === 'object' && Number.isFinite(value._seconds) ? value._seconds * 1000 : value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/** A privilege or item's club year: recorded since club years were introduced, otherwise when it was granted. */
export const recordClubYear = (record) => {
  if (Number.isInteger(record?.clubYear)) return record.clubYear;
  const granted = toDate(record?.grantedAt || record?.startedAt);
  return granted ? clubYearOf(granted) : null;
};

/** Whether a member already holds a product for a club year, from a privilege or an active monthly item. */
export const holdsForClubYear = ({ privileges = [], subscriptionItems = [] } = {}, productId, clubYear) =>
  privileges.some((privilege) => privilege.productId === productId && !privilege.endedAt && recordClubYear(privilege) === clubYear)
  || subscriptionItems.some((item) => item.productId === productId && item.status === 'active' && recordClubYear(item) === clubYear);
