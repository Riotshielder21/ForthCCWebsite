import { clubYearDates, clubYearOf, nextFirst } from '../utils/clubYear.js';

/** The next date a subscription takes a full payment after `now`: the next 1st, or the next 1 March when yearly. */
export const nextBillingDate = (interval, now = new Date()) => interval === 'year' ? clubYearDates(clubYearOf(now)).end : nextFirst(now);

/**
 * Creates a subscription that carries on until it is cancelled. While it waits for its first full payment (`firstCharge`,
 * a 1st or a 1 March) it trials, so nothing is prorated. If that date has already passed (a bank payment that cleared
 * late), it is backdated to it and anchored on the next billing date, so the missed time is charged pro rata.
 * `onCreated` runs as soon as Stripe has the subscription, so it is recorded even if anything after it fails.
 */
export const createRecurringSubscription = async (request, { base, firstCharge, interval = 'month', idempotencyKey, now = new Date(), onCreated = async () => {} }) => {
  const params = firstCharge > now.getTime() / 1000
    ? [...base, ['trial_end', String(firstCharge)], ['proration_behavior', 'none']]
    : [...base, ['backdate_start_date', String(firstCharge)], ['billing_cycle_anchor', String(Math.floor(nextBillingDate(interval, now).getTime() / 1000))],
      ['proration_behavior', 'create_prorations']];
  const subscription = await request('subscriptions', params, 'POST', { idempotencyKey });
  await onCreated(subscription);
  return subscription;
};
