/**
 * Every monthly item becomes its own Stripe subscription, so Stripe collects each as a separate direct debit and each
 * can be cancelled without touching the others. Stripe Checkout can only start one subscription, so the first item's is
 * created there and the others straight after payment on the same saved payment method (their first month is charged
 * in the checkout payment).
 */
export const subscriptionGroups = (items, people) => items.filter((entry) => entry.monthly).map((item, index) => {
  const holders = people.filter((person) => (person.lineIds || []).includes(item.lineId));
  return {
    key: `line:${item.lineId}`, lineIds: [item.lineId],
    membershipIds: [...new Set(holders.map((person) => person.membershipId))],
    names: [...new Set(holders.map((person) => `${person.firstName || ''} ${person.lastName || ''}`.trim()))],
    primary: index === 0, status: index === 0 ? 'checkout' : 'pending'
  };
});

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
