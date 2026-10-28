/**
 * A payer has one Stripe subscription (one monthly direct debit) for every monthly item they pay for, whoever the item
 * is for. Our records say which member gets each item, so staff can stop one member's items and the payer's debit
 * simply drops by that amount.
 */
export const lineHolders = (lineId, people) => {
  const holders = (people || []).filter((person) => (person.lineIds || []).includes(lineId));
  return {
    membershipIds: [...new Set(holders.map((person) => person.membershipId).filter(Boolean))],
    names: [...new Set(holders.map((person) => `${person.firstName || ''} ${person.lastName || ''}`.trim()).filter(Boolean))]
  };
};

// A subscription waiting for its first debit on the 1st is `trialing` in Stripe; both still take payments.
export const subscriptionLive = (subscription) => ['active', 'trialing'].includes(subscription?.status);

// Club-year subscriptions end at 1 March (metadata `cutoff_at`), after the full February debit.
export const endedAtCutoff = (subscription) => {
  const cutoff = Number(subscription?.metadata?.cutoff_at) || 0;
  return Boolean(cutoff && subscription.status === 'canceled' && subscription.ended_at && Math.abs(subscription.ended_at - cutoff) < 24 * 60 * 60);
};

/** Move only the app-managed end for this club year; leave any separate/manual earlier cancellation untouched. */
export const clubYearEndUpdate = (subscription, clubYear, subscriptionEnd) => {
  const previousCutoff = Number(subscription?.metadata?.cutoff_at);
  if (subscription?.metadata?.club_year !== String(clubYear) || !Number.isSafeInteger(previousCutoff) || previousCutoff <= 0
    || subscription.cancel_at !== previousCutoff || previousCutoff >= subscriptionEnd) return null;
  return [['cancel_at', String(subscriptionEnd)], ['metadata[cutoff_at]', String(subscriptionEnd)], ['proration_behavior', 'none']];
};

// Stripe subscription items carry our order line id, either on the item or (for Checkout-created items) on its product.
export const stripeItemLines = (subscription, lineIds) => {
  const items = subscription?.items?.data || [];
  const byLine = new Map();
  for (const item of items) {
    const lineId = item.metadata?.line_id || item.price?.product?.metadata?.line_id;
    if (lineIds.includes(lineId)) byLine.set(lineId, item.id);
  }
  if (!byLine.size && items.length === 1 && lineIds.length === 1) byLine.set(lineIds[0], items[0].id);
  return byLine;
};

export const activeSubscriptionItems = (subscription) => (subscription.items || []).filter((item) => {
  const scheduled = item.cancelScheduledAt;
  const end = scheduled?.toMillis ? scheduled.toMillis() : scheduled ? new Date(scheduled).getTime() : 0;
  return item.status === 'active' && !(end && end <= Date.now());
});

export const monthlyTotal = (subscription) => Math.round(activeSubscriptionItems(subscription)
  .reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0) * 100) / 100;
