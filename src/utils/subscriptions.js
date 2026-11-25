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

/** Monthly and yearly subscription lines on an order; both are set up as Stripe subscriptions after payment. */
export const isRecurringLine = (item) => Boolean(item?.monthly || item?.yearly);

/**
 * A member who cancels from the continue/cancel email stops at the club-year end (metadata `cutoff_at`): after the
 * 1 February debit, or before the 1 March yearly payment. Ending there is expected, not a failure.
 */
export const endedAtCutoff = (subscription) => {
  const cutoff = Number(subscription?.metadata?.cutoff_at) || 0;
  return Boolean(cutoff && subscription.status === 'canceled' && subscription.ended_at && Math.abs(subscription.ended_at - cutoff) < 24 * 60 * 60);
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

/** What an item or a whole subscription costs each time it is charged, e.g. "£25.00 a month" or "£240.00 a year". */
export const itemPrice = (item) => item?.interval === 'year' ? `£${Number(item.yearlyAmount || 0).toFixed(2)} a year` : `£${Number(item?.monthlyAmount || 0).toFixed(2)} a month`;
export const subscriptionPrice = (subscription) => {
  const yearly = subscription?.interval === 'year';
  const total = Math.round(activeSubscriptionItems(subscription).reduce((sum, item) => sum + Number((yearly ? item.yearlyAmount : item.monthlyAmount) || 0), 0) * 100) / 100;
  return `£${total.toFixed(2)} a ${yearly ? 'year' : 'month'}`;
};

/**
 * The member's answer to the continue/cancel email for `continuation.renewalYear`: confirmed, cancelled (it stops at the
 * end of February), or unconfirmed, when it simply carries on.
 */
export const continuationStatus = (subscription) => {
  const answer = subscription?.continuation;
  if (!answer?.renewalYear) return null;
  return { renewalYear: answer.renewalYear, status: ['confirmed', 'cancelled'].includes(answer.status) ? answer.status : 'unconfirmed' };
};

export const continuationLabel = (subscription) => {
  const answer = continuationStatus(subscription);
  if (!answer) return 'Carries on until cancelled.';
  const year = `${answer.renewalYear}/${String((answer.renewalYear + 1) % 100).padStart(2, '0')}`;
  return { confirmed: `Club year ${year}: confirmed, carries on.`, cancelled: `Club year ${year}: cancelled, stops at the end of February.`,
    unconfirmed: `Club year ${year}: unconfirmed, carries on.` }[answer.status];
};
