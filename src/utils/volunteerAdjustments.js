import { DISCOUNTS } from '../constants/products.js';
import { clubYearOf, fullMonthsAfterCurrent } from './clubYear.js';
import { PRORATED_MONTHS } from './pricing.js';
import { applyVolunteerBenefits } from './volunteering.js';

export const VOLUNTEER_ADJUSTMENT = 'volunteer-adjustment';

/** After February's debit (the club year's last) nothing is left to adjust, so a sign-up counts for next club year. */
export const volunteerSignupYear = (now = new Date()) => clubYearOf(now) + (fullMonthsAfterCurrent(now) === 0 ? 1 : 0);

/** Whole months of a club year still to run after the current one; all twelve for a year not yet started. */
export const monthsLeftIn = (clubYear, now = new Date()) => {
  const current = clubYearOf(now);
  if (clubYear > current) return 12;
  return clubYear === current ? fullMonthsAfterCurrent(now) : 0;
};

const pence = (pounds) => Math.round(Number(pounds) * 100);
const isSubscription = (product) => product.type === 'subscription' || product.pricingMode === 'subscription';

/** The price every holder of a line would pay for a product as a volunteer, or null when they share no benefit. */
export const volunteerPriceFor = ({ productId, basePrice, membershipIds, clubYear, members, tiers, now = new Date() }) => {
  if (!membershipIds?.length || ![clubYearOf(now), clubYearOf(now) + 1].includes(clubYear)) return null;
  const [priced] = applyVolunteerBenefits([{ id: productId, lineId: 'line', basePrice, clubYearPart: clubYear > clubYearOf(now) ? 'next' : 'this' }],
    membershipIds.map((membershipId) => ({ membershipId, lineIds: ['line'] })), members, tiers, now);
  return priced.volunteerBenefit ? priced.basePrice : null;
};

/**
 * An existing monthly item is lowered to the volunteer price from its next debit, or removed at the end of the paid
 * period when the benefit makes it free. Nothing changes once the club year's last debit has been taken.
 */
export const monthlyAdjustment = ({ item, volunteerPrice, now = new Date() }) => {
  if (item.status !== 'active' || item.cancelScheduledAt || volunteerPrice === null || !monthsLeftIn(item.clubYear, now)) return null;
  const to = Math.min(Number(item.monthlyAmount), volunteerPrice);
  if (to >= Number(item.monthlyAmount)) return null;
  return to === 0 ? { action: 'remove', from: Number(item.monthlyAmount), to: 0 } : { action: 'reprice', from: Number(item.monthlyAmount), to };
};

const activeRefunds = (item) => (item.refunds || []).filter((refund) => !['failed', 'canceled'].includes(refund.status));

/**
 * A pro-rata refund (in pence) for something already paid for in full, from the volunteer benefit for the whole
 * months still to run. Blue and Gold: the monthly saving per month left, less the annual discount when the product
 * has one. Items that become free: what was paid divided by the months it covered (five when bought at the
 * reduced late-year price, otherwise twelve), per month left. Capped at what has not already been refunded.
 */
export const annualAdjustment = ({ item, product, volunteerPrice, paidAt, now = new Date() }) => {
  const done = activeRefunds(item).filter((refund) => refund.purpose === VOLUNTEER_ADJUSTMENT);
  if (done.length) return { adjusted: true, amount: done.reduce((sum, refund) => sum + refund.amountPence, 0) };
  const months = monthsLeftIn(item.clubYear, now);
  if (!months || volunteerPrice === null || item.monthly || item.volunteerBenefit || item.revokedAt || !product) return null;
  const paid = Number(item.pricePence) || 0;
  let amount;
  let basis;
  const monthWord = `${months} month${months === 1 ? '' : 's'} left`;
  if (isSubscription(product)) {
    const saving = Number(product.basePrice) - volunteerPrice;
    const rate = product.hasAnnualDiscount ? 1 - DISCOUNTS.ANNUAL : 1;
    amount = Math.round(pence(saving) * months * rate);
    basis = `£${saving.toFixed(2)} a month saving × ${monthWord}${rate < 1 ? `, less the ${Math.round(DISCOUNTS.ANNUAL * 100)}% annual discount` : ''}`;
  } else if (volunteerPrice === 0) {
    const bought = paidAt instanceof Date ? paidAt : null;
    const lateYear = (item.pricingMode || product.pricingMode) === 'prorated' && bought && item.clubYear === clubYearOf(bought)
      && fullMonthsAfterCurrent(bought) + 1 <= PRORATED_MONTHS;
    const covered = lateYear ? PRORATED_MONTHS : 12;
    amount = Math.round(paid * months / covered);
    basis = `£${(paid / 100).toFixed(2)} paid ÷ ${covered} months × ${monthWord}`;
  } else {
    return null;
  }
  amount = Math.min(amount, paid - activeRefunds(item).reduce((sum, refund) => sum + refund.amountPence, 0));
  return amount > 0 ? { adjusted: false, amount, months, basis } : null;
};
