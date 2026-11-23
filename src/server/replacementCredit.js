import { clubYearDates, clubYearOf } from '../utils/clubYear.js';
import { isRecurringLine } from '../utils/subscriptions.js';

const DAY = 86400;
export const CARD_ONLY_DAYS = 300;
const idOf = value => typeof value === 'string' ? value : value?.id;

/**
 * What a Bookwhen subscriber has paid for but will not use once the website subscription replaces theirs, from the
 * last settled invoice of a one-item subscription. Monthly: the whole unused days of that payment. Yearly: the unused
 * share of the year in 20% steps, rounded down. With more than 300 days of a yearly payment left, nothing is charged at
 * checkout instead: the card is saved and the first yearly payment is taken on the 1 March after the paid year ends
 * (`cardOnly`, `firstChargeAt`). Returns null when the subscription or payment cannot be verified, so staff review it.
 */
export function replacementCredit(subscription, invoice, now = Math.floor(Date.now() / 1000)) {
  const price = subscription?.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval;
  const line = invoice?.lines?.data?.[0];
  const charge = invoice?.charge;
  const start = line?.period?.start;
  const end = line?.period?.end;
  if (subscription.items?.has_more || subscription.items?.data?.length !== 1 ||
    !['month', 'year'].includes(interval) || price.recurring.interval_count !== 1 ||
    invoice?.status !== 'paid' || invoice.currency !== 'gbp' || idOf(invoice.subscription) !== subscription.id ||
    !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid <= 0 || invoice.amount_paid !== invoice.amount_due ||
    invoice.lines?.has_more || invoice.lines?.data?.length !== 1 || line?.type !== 'subscription' || line.proration !== false ||
    idOf(line.price) !== price.id || charge?.paid !== true || charge.currency !== 'gbp' || charge.amount !== invoice.amount_paid ||
    charge.amount_refunded !== 0 || charge.disputed !== false ||
    !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || start > now) {
    return null;
  }
  const remaining = Math.max(0, end - now);
  const unusedDays = Math.floor(remaining / DAY);
  if (interval === 'month') {
    return { interval, creditPence: Math.round(invoice.amount_paid * unusedDays / Math.round((end - start) / DAY)), unusedDays,
      paidPence: invoice.amount_paid, cardOnly: false, firstChargeAt: null };
  }
  if (remaining > CARD_ONLY_DAYS * DAY) {
    return { interval, creditPence: 0, unusedDays, paidPence: invoice.amount_paid, cardOnly: true,
      firstChargeAt: clubYearDates(clubYearOf(new Date((end - 1) * 1000)) + 1).start.toISOString() };
  }
  const fifths = Math.floor((remaining * 5) / (end - start));
  return { interval, creditPence: Math.round(invoice.amount_paid * fifths / 5), unusedShare: fifths / 5, unusedDays,
    paidPence: invoice.amount_paid, cardOnly: false, firstChargeAt: null };
}

/**
 * Applies a replacement credit to the checkout lines for the invitation's products: it comes off their first payments
 * in basket order, and anything left is carried forward to the new subscription's next payments (a Stripe customer
 * balance, added once the old subscription is stopped). A card-only yearly replacement takes nothing now and starts on
 * `firstChargeAt`, made with `timestamp`.
 */
export function applyReplacementCredit(items, productIds, plan, { timestamp = (iso) => new Date(iso) } = {}) {
  const matches = (item) => productIds.includes(item.id) && isRecurringLine(item) && !item.revokedAt;
  if (!plan) return { items, appliedPence: 0, carryForwardPence: 0 };
  if (plan.cardOnly) {
    const firstDebitAt = timestamp(plan.firstChargeAt);
    return { items: items.map((item) => matches(item) ? { ...item, pricePence: 0, firstDebitAt, replacementCardOnly: true } : item),
      appliedPence: items.filter(matches).reduce((sum, item) => sum + item.pricePence, 0), carryForwardPence: 0 };
  }
  let left = plan.creditPence;
  const credited = items.map((item) => {
    if (!matches(item) || left <= 0) return item;
    const taken = Math.min(left, item.pricePence);
    left -= taken;
    return taken ? { ...item, pricePence: item.pricePence - taken, replacementCreditPence: taken } : item;
  });
  return { items: credited, appliedPence: plan.creditPence - left, carryForwardPence: left };
}
