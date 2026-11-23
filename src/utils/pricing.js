import { DISCOUNTS } from '../constants/products.js';
import { clubYearOf, clubYearDates, clubYearKind, clubYearLabel, firstRecurringCharge, fullMonthsAfterCurrent, joiningShare, thresholdShare } from './clubYear.js';

// Prorated items drop to 60% from 1 October, when five months of the club year (Oct–Feb) remain.
export const PRORATED_MONTHS = 5;
export const NEXT_YEAR_LINE_SUFFIX = '~next';

const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const dayLabel = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });

/**
 * Basket lines carry `clubYearChoice` ('this', 'next' or 'both'). Pricing, orders and records work per club year, so a
 * 'both' line becomes this year's line plus a next-year line with the same details and a derived line id.
 */
export const expandClubYearLines = (lines) => lines.flatMap((line) => {
  if (line.clubYearChoice === 'both') {
    return [{ ...line, clubYearPart: 'this', sourceLineId: line.lineId },
      { ...line, lineId: `${line.lineId}${NEXT_YEAR_LINE_SUFFIX}`, clubYearPart: 'next', sourceLineId: line.lineId }];
  }
  return [line.clubYearChoice === 'next' ? { ...line, clubYearPart: 'next', sourceLineId: line.lineId } : { ...line, sourceLineId: line.lineId }];
});

/** Whoever holds a 'both' line also holds its next-year line. */
export const expandPeopleLines = (people, lines) => {
  const both = new Set(lines.filter((line) => line.clubYearChoice === 'both').map((line) => line.lineId));
  return people.map((person) => ({ ...person,
    lineIds: (person.lineIds || []).flatMap((id) => both.has(id) ? [id, `${id}${NEXT_YEAR_LINE_SUFFIX}`] : [id]) }));
};

const monthName = (date) => date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' });

/** "£25.00 a month from 1 Dec 2026" or "£240.00 a year from 1 Mar 2027": payments that carry on until cancelled. */
export const recurringText = ({ amount, interval, firstCharge }) =>
  `£${Number(amount).toFixed(2)} a ${interval === 'year' ? 'year' : 'month'} from ${dayLabel(firstCharge)}`;

/** The joining-month charge, worded as a discount on the full month, e.g. "Rest of October now (80% off)". */
export const joiningText = (month, share) => {
  const off = 100 - Math.round(share * 100);
  return `Rest of ${month} now${off > 0 ? ` (${off}% off)` : ''}`;
};

/** The first annual payment, worded as a discount on the full year, e.g. "Rest of the club year now (60% off)". */
export const yearShareText = (share) => {
  const off = 100 - Math.round(share * 100);
  return off > 0 ? `Rest of the club year now (${off}% off)` : 'This club year now';
};

// e.g. "Rest of October now (80% off), then £25.00 a month from 1 Nov 2026 until you cancel", with the new club year's
// price from 1 March when that differs: "… from 1 Nov 2026 and £30.00 a month from 1 Mar 2027 until you cancel".
const subscriptionLabel = ({ first, amount, interval, firstCharge, renewalAmount, renewsAt }) =>
  `${first ? `${first}, then ` : ''}${recurringText({ amount, interval, firstCharge })}${renewalAmount !== undefined
    ? ` and ${recurringText({ amount: renewalAmount, interval, firstCharge: renewsAt })}` : ''} until you cancel`;

/**
 * Subscriptions carry on until cancelled. Paid monthly, checkout takes the rest of this month and the 1st of each month
 * follows. Paid annually, checkout takes the rest of this club year (in 20% steps of the year, or the full year price
 * when the product opts out with `thresholdProration: false`) and the full year is charged every 1 March. Bought for
 * next club year, nothing is charged now and the first payment is on 1 March. Staff crediting items (`recurring: false`)
 * have no card to charge later, so a subscription is a one-off payment for its club year instead.
 */
export const calculateCart = (cart, isAnnual, promo = null, now = new Date(), { recurring = true } = {}) => {
  const currentYear = clubYearOf(now);
  const nextClubYearStart = clubYearDates(currentYear).end;
  // Months left including this one, as a whole number; used for the 60% prorated price from October.
  const monthsRemaining = fullMonthsAfterCurrent(now) + 1;
  const share = joiningShare(now);
  const yearShare = thresholdShare(now);
  const renewalOpen = now >= clubYearDates(currentYear).renewalOpens;
  const clubYearInfo = { now, nextClubYearStart, monthsRemaining, joiningShare: share, thresholdShare: yearShare };
  const items = cart.map((item) => {
    const { pricingMode } = item;
    const subscription = pricingMode === 'subscription';
    const monthlyBilling = subscription && recurring && !isAnnual && item.allowMonthly;
    const kind = clubYearKind(item);
    const nextYear = Boolean(kind) && item.clubYearPart === 'next';
    const clubYear = kind ? currentYear + (nextYear ? 1 : 0) : null;
    const interval = subscription && recurring ? (monthlyBilling ? 'month' : 'year') : null;
    const firstCharge = interval ? firstRecurringCharge(clubYear ?? currentYear, interval, now) : null;
    // A code limited to products or categories covers just those; otherwise everything except membership.
    const promoEligible = promo?.productIds?.length || promo?.categories?.length
      ? Boolean(promo.productIds?.includes(item.id) || promo.categories?.includes(item.category))
      : item.category !== 'MEMBERSHIP';
    const flat = promoEligible && promo?.type === 'flat' && pricingMode === 'subscription';
    const monthly = flat ? Math.max(0, item.basePrice - promo.discountValue) : item.basePrice;
    const annualRate = item.hasAnnualDiscount && (!flat || promo.allowsAnnualStacking) ? 1 - DISCOUNTS.ANNUAL : 1;
    let subtotalPrice = item.basePrice;
    let displayPrice = subtotalPrice;
    let annualSaving = 0;
    let promoSaving = 0;
    let monthlyRate = monthlyBilling ? monthly : 0;
    let yearlyRate = interval === 'year' ? money(monthly * 12 * annualRate) : 0;
    const yearShareNow = item.thresholdProration === false ? 1 : yearShare;
    const firstShare = !subscription ? 0 : nextYear ? (recurring ? 0 : 1) : monthlyBilling ? share : yearShareNow;
    let label = 'One-off';
    const yearLabel = kind && (renewalOpen || nextYear) ? `Club year ${clubYearLabel(clubYear)}` : 'Club Year';
    if (subscription) {
      const months = monthlyBilling ? firstShare : 12 * firstShare;
      const rate = monthlyBilling ? 1 : annualRate;
      subtotalPrice = money(item.basePrice * months * rate);
      displayPrice = money(monthly * months * rate);
      annualSaving = monthlyBilling ? 0 : money(item.basePrice * months - subtotalPrice);
      promoSaving = money(subtotalPrice - displayPrice);
    } else if (pricingMode === 'prorated') {
      displayPrice = money(item.basePrice * (!nextYear && monthsRemaining <= PRORATED_MONTHS ? 0.6 : 1));
      subtotalPrice = displayPrice;
      annualSaving = money(item.basePrice - displayPrice);
      label = yearLabel;
    } else if (kind || item.type === 'annual-oneoff' || item.type === 'yearly-service') {
      label = yearLabel;
    }
    // Automatic trip discounts (see tripDiscount.js) come off before any promo code.
    const tripSaving = money(Math.min(Math.max(0, Number(item.tripDiscount) || 0), displayPrice));
    displayPrice = money(displayPrice - tripSaving);
    if (promoEligible && promo?.type === 'multiplier') {
      const saving = money(displayPrice * promo.discountValue);
      displayPrice = money(displayPrice - saving);
      promoSaving += saving;
      monthlyRate = money(monthlyRate * (1 - promo.discountValue));
      yearlyRate = money(yearlyRate * (1 - promo.discountValue));
    }
    // On 1 March every subscription moves to the new club year's shop price: a discount code or this year's volunteer
    // price covers only the line's own club year. Payments in a later year are quoted at today's shop price; the
    // volunteer price for that year can only lower them (see renewalPrice).
    const renewsAt = interval ? clubYearDates((clubYear ?? currentYear) + 1).start : null;
    const shopMonthly = item.volunteerOriginalPrice ?? item.basePrice;
    const renewalRate = interval === 'year' ? money(shopMonthly * 12 * (item.hasAnnualDiscount ? 1 - DISCOUNTS.ANNUAL : 1)) : money(shopMonthly);
    if (interval && firstCharge >= renewsAt) {
      if (monthlyBilling) monthlyRate = renewalRate;
      else yearlyRate = renewalRate;
    }
    const renewalAmount = interval && firstCharge < renewsAt && renewalRate !== (monthlyBilling ? monthlyRate : yearlyRate) ? renewalRate : undefined;
    if (interval) {
      const first = nextYear ? '' : monthlyBilling ? joiningText(monthName(now), share) : yearShareText(firstShare);
      label = subscriptionLabel({ first, amount: monthlyBilling ? monthlyRate : yearlyRate, interval, firstCharge, renewalAmount, renewsAt });
    } else if (subscription) {
      label = nextYear ? yearLabel : `Until ${dayLabel(nextClubYearStart)}`;
    }
    const recurringMonthlyCost = monthlyBilling ? monthlyRate : 0;
    const recurringYearlyCost = interval === 'year' ? yearlyRate : 0;
    return { ...item, label, subtotalPrice, displayPrice, annualSaving, promoSaving, tripSaving, promoEligible, recurringMonthlyCost, recurringYearlyCost, monthlyBilling,
      clubYearInfo, ...(kind ? { clubYear, clubYearPart: nextYear ? 'next' : 'this' } : {}),
      ...(interval ? { interval, firstDebit: firstCharge } : {}), ...(renewalAmount !== undefined ? { renewalAmount, renewsAt } : {}),
      ...(monthlyBilling ? { monthlyAmount: monthlyRate } : {}), ...(interval === 'year' ? { yearlyAmount: yearlyRate } : {}) };
  });
  let credit = promo?.type === 'credit' ? promo.discountValue : 0;
  for (const item of items) {
    if (!item.promoEligible || credit <= 0) continue;
    const saving = money(Math.min(credit, item.displayPrice));
    item.displayPrice = money(item.displayPrice - saving);
    item.promoSaving = money(item.promoSaving + saving);
    credit = money(credit - saving);
  }
  const sum = (field) => money(items.reduce((total, item) => total + item[field], 0));
  const total = sum('displayPrice');
  // Monthly and annual payments are separate subscriptions, and so is each first payment date.
  const byStart = new Map();
  for (const item of items.filter((line) => line.recurringMonthlyCost > 0 || line.recurringYearlyCost > 0)) {
    const key = `${item.interval}:${item.firstDebit.getTime()}`;
    const entry = byStart.get(key) || { interval: item.interval, firstCharge: item.firstDebit, clubYear: item.clubYear, amount: 0 };
    entry.amount = money(entry.amount + (item.interval === 'year' ? item.recurringYearlyCost : item.recurringMonthlyCost));
    byStart.set(key, entry);
  }
  const recurringSchedule = [...byStart.values()].sort((a, b) => a.firstCharge - b.firstCharge || (a.interval === 'month' ? -1 : 1));
  return { items, subtotal: sum('subtotalPrice'), annualSaving: sum('annualSaving'), promoDiscountValue: sum('promoSaving'), tripDiscountValue: sum('tripSaving'), total, year1Total: total,
    recurringMonthlyTotal: sum('recurringMonthlyCost'), recurringYearlyTotal: sum('recurringYearlyCost'), recurringSchedule };
};