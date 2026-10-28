import { nextFirst } from '../utils/clubYear.js';

export const createClubYearSubscription = async (request, { base, firstDebit, subscriptionEnd, orderRef, clubYear, now = new Date() }) => {
  if (firstDebit > now.getTime() / 1000) {
    return request('subscriptions', [...base, ['trial_end', String(firstDebit)], ['cancel_at', String(subscriptionEnd)], ['proration_behavior', 'none']],
      'POST', { idempotencyKey: `${orderRef}-${clubYear}-subscription` });
  }
  const subscription = await request('subscriptions', [...base, ['backdate_start_date', String(firstDebit)],
    ['billing_cycle_anchor', String(Math.floor(nextFirst(now).getTime() / 1000))], ['proration_behavior', 'create_prorations']],
  'POST', { idempotencyKey: `${orderRef}-${clubYear}-subscription` });
  // The full February debit covers to March; cancelling at the subscription end must not create a credit.
  return request(`subscriptions/${encodeURIComponent(subscription.id)}`, [['cancel_at', String(subscriptionEnd)], ['proration_behavior', 'none']],
    'POST', { idempotencyKey: `${orderRef}-${clubYear}-cancel-at` });
};
