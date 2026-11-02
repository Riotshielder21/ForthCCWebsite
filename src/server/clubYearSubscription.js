import { nextFirst } from '../utils/clubYear.js';

// The full February debit covers to March; cancelling at the subscription end must not create a credit.
export const clubYearCancelAt = (request, subscriptionId, { subscriptionEnd, orderRef, clubYear }) =>
  request(`subscriptions/${encodeURIComponent(subscriptionId)}`, [['cancel_at', String(subscriptionEnd)], ['proration_behavior', 'none']],
    'POST', { idempotencyKey: `${orderRef}-${clubYear}-cancel-at` });

/** `onCreated` runs as soon as Stripe has the subscription, so it is recorded even if setting its end then fails. */
export const createClubYearSubscription = async (request, { base, firstDebit, subscriptionEnd, orderRef, clubYear, now = new Date(), onCreated = async () => {} }) => {
  if (firstDebit > now.getTime() / 1000) {
    const subscription = await request('subscriptions', [...base, ['trial_end', String(firstDebit)], ['cancel_at', String(subscriptionEnd)], ['proration_behavior', 'none']],
      'POST', { idempotencyKey: `${orderRef}-${clubYear}-subscription` });
    await onCreated(subscription);
    return subscription;
  }
  const subscription = await request('subscriptions', [...base, ['backdate_start_date', String(firstDebit)],
    ['billing_cycle_anchor', String(Math.floor(nextFirst(now).getTime() / 1000))], ['proration_behavior', 'create_prorations']],
  'POST', { idempotencyKey: `${orderRef}-${clubYear}-subscription` });
  await onCreated(subscription);
  return clubYearCancelAt(request, subscription.id, { subscriptionEnd, orderRef, clubYear });
};
