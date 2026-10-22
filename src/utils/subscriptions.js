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

// Share of the current billing period left, used to charge a new item only up to the payer's next monthly payment.
export const remainingPeriodShare = (periodStart, periodEnd, now) => {
  if (!(periodEnd > periodStart)) return 1;
  return Math.min(1, Math.max(0, (periodEnd - now) / (periodEnd - periodStart)));
};

export const firstPaymentPence = (monthlyPence, share) => Math.round(monthlyPence * share);

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

export const activeSubscriptionItems = (subscription) => (subscription.items || []).filter((item) => item.status === 'active');

export const monthlyTotal = (subscription) => Math.round(activeSubscriptionItems(subscription)
  .reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0) * 100) / 100;
