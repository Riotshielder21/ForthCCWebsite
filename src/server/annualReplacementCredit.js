import { clubYearDates } from '../utils/clubYear.js';

const secondsPerDay = 86400;
const idOf = value => typeof value === 'string' ? value : value?.id;

export function annualReplacementCredit(subscription, invoice, now = Math.floor(Date.now() / 1000)) {
  const price = subscription.items?.data?.[0]?.price;
  const line = invoice?.lines?.data?.[0];
  const charge = invoice?.charge;
  const start = line?.period?.start;
  const end = line?.period?.end;
  if (subscription.items?.has_more || subscription.items?.data?.length !== 1 ||
    price?.recurring?.interval !== 'year' || price.recurring.interval_count !== 1 ||
    invoice?.status !== 'paid' || invoice.currency !== 'gbp' || idOf(invoice.subscription) !== subscription.id ||
    !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid <= 0 || invoice.amount_paid !== invoice.amount_due ||
    invoice.lines?.has_more || invoice.lines?.data?.length !== 1 || line?.type !== 'subscription' || line.proration !== false ||
    idOf(line.price) !== price.id || charge?.paid !== true || charge.currency !== 'gbp' || charge.amount !== invoice.amount_paid ||
    charge.amount_refunded !== 0 || charge.disputed !== false ||
    !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || start > now) {
    return null;
  }
  const remainingSeconds = Math.max(0, end - now);
  const creditPence = Math.round(invoice.amount_paid * (remainingSeconds / (end - start)));
  return {
    creditPence,
    remainingDays: Math.floor(remainingSeconds / secondsPerDay),
    cardOnly: remainingSeconds > 300 * secondsPerDay,
    cardOnlyFirstChargeAt: remainingSeconds > 300 * secondsPerDay ? clubYearDates(2028).start.toISOString() : null
  };
}
