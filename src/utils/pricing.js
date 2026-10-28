import { DISCOUNTS } from '../constants/products.js';
import { clubYearOf, clubYearDates, clubYearKind, clubYearLabel, fullMonthsAfterCurrent, joiningShare, monthlyDebits } from './clubYear.js';

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

export const calculateCart = (cart, isAnnual, promo = null, now = new Date()) => {
  const currentYear = clubYearOf(now);
  const nextClubYearStart = clubYearDates(currentYear).end;
  // Months left including this one, as a whole number; used for the 60% prorated price from October.
  const monthsRemaining = fullMonthsAfterCurrent(now) + 1;
  const share = joiningShare(now);
  const renewalOpen = now >= clubYearDates(currentYear).renewalOpens;
  const clubYearInfo = { now, nextClubYearStart, monthsRemaining, joiningShare: share };
  const items = cart.map((item) => {
    // Catalogue items carry pricingMode (see productTerms); anything without one is fixed unless it is a subscription.
    const pricingMode = item.pricingMode || (item.type === 'subscription' ? 'subscription' : 'fixed');
    const monthlyBilling = pricingMode === 'subscription' && !isAnnual && (item.allowMonthly ?? item.type === 'subscription');
    const kind = clubYearKind({ ...item, pricingMode });
    const nextYear = Boolean(kind) && item.clubYearPart === 'next';
    const clubYear = kind ? currentYear + (nextYear ? 1 : 0) : null;
    const schedule = monthlyBilling ? monthlyDebits(clubYear, now) : { firstDebit: null, debits: 0 };
    // A code limited to products or categories covers just those; otherwise everything except membership.
    const promoEligible = promo?.productIds?.length || promo?.categories?.length
      ? Boolean(promo.productIds?.includes(item.id) || promo.categories?.includes(item.category))
      : item.category !== 'MEMBERSHIP';
    const flat = promoEligible && promo?.discountType === 'flat' && pricingMode === 'subscription';
    const monthly = flat ? Math.max(0, item.basePrice - promo.discountValue) : item.basePrice;
    const annualRate = item.hasAnnualDiscount && (!flat || promo.allowsAnnualStacking) ? 1 - DISCOUNTS.ANNUAL : 1;
    let subtotalPrice = item.basePrice;
    let displayPrice = subtotalPrice;
    let annualSaving = 0;
    let promoSaving = 0;
    let monthlyRate = monthlyBilling ? monthly : 0;
    let label = 'One-off';
    const yearLabel = kind && (renewalOpen || nextYear) ? `Club year ${clubYearLabel(clubYear)}` : 'Club Year';
    if (pricingMode === 'subscription') {
      // Checkout takes the joining-month share of this month (nothing for next year, which is debited from 1 March).
      // Paid up front, this year is that share plus the full months to 1 March; next year is twelve months.
      const months = monthlyBilling ? (nextYear ? 0 : share) : nextYear ? 12 : share + fullMonthsAfterCurrent(now);
      subtotalPrice = money(item.basePrice * months * (monthlyBilling ? 1 : annualRate));
      displayPrice = money(monthly * months * (monthlyBilling ? 1 : annualRate));
      annualSaving = monthlyBilling ? 0 : money(item.basePrice * months - subtotalPrice);
      promoSaving = money(subtotalPrice - displayPrice);
      const percent = `${Math.round(share * 100)}% of this month`;
      label = !monthlyBilling ? (nextYear ? yearLabel : `Until ${dayLabel(nextClubYearStart)}`)
        : nextYear ? `Monthly from ${dayLabel(schedule.firstDebit)}`
        : schedule.debits ? `${percent} now, then monthly from ${dayLabel(schedule.firstDebit)}`
        : `${percent} now (ends ${dayLabel(nextClubYearStart)})`;
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
    if (promoEligible && promo?.discountType === 'multiplier') {
      const saving = money(displayPrice * promo.discountValue);
      displayPrice = money(displayPrice - saving);
      promoSaving += saving;
      monthlyRate = money(monthlyRate * (1 - promo.discountValue));
    }
    const recurringMonthlyCost = schedule.debits ? monthlyRate : 0;
    return { ...item, label, subtotalPrice, displayPrice, annualSaving, promoSaving, tripSaving, promoEligible, recurringMonthlyCost, monthlyBilling,
      clubYearInfo, ...(kind ? { clubYear, clubYearPart: nextYear ? 'next' : 'this' } : {}),
      ...(monthlyBilling ? { monthlyAmount: monthlyRate, firstDebit: schedule.firstDebit, debits: schedule.debits, subscriptionEnd: schedule.subscriptionEnd || null } : {}) };
  });
  let credit = promo?.discountType === 'credit' ? promo.discountValue : 0;
  for (const item of items) {
    if (!item.promoEligible || credit <= 0) continue;
    const saving = money(Math.min(credit, item.displayPrice));
    item.displayPrice = money(item.displayPrice - saving);
    item.promoSaving = money(item.promoSaving + saving);
    credit = money(credit - saving);
  }
  const sum = (field) => money(items.reduce((total, item) => total + item[field], 0));
  const total = sum('displayPrice');
  // Each club year's monthly items are a separate direct debit with its own start date.
  const debitsByStart = new Map();
  for (const item of items.filter((line) => line.recurringMonthlyCost > 0)) {
    const key = item.firstDebit.getTime();
    const entry = debitsByStart.get(key) || { firstDebit: item.firstDebit, subscriptionEnd: item.subscriptionEnd, clubYear: item.clubYear, monthly: 0 };
    entry.monthly = money(entry.monthly + item.recurringMonthlyCost);
    debitsByStart.set(key, entry);
  }
  const monthlySchedule = [...debitsByStart.values()].sort((a, b) => a.firstDebit - b.firstDebit);
  return { items, subtotal: sum('subtotalPrice'), annualSaving: sum('annualSaving'), promoDiscountValue: sum('promoSaving'), tripDiscountValue: sum('tripSaving'), total, year1Total: total,
    recurringMonthlyTotal: sum('recurringMonthlyCost'), monthlySchedule };
};