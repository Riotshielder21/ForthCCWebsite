/**
 * Monthly items become Stripe subscriptions: one per person, except people on the same family membership, who share
 * one. Stripe Checkout can only start one subscription, so the first group is created there and the others are created
 * straight after payment on the same saved payment method (their first month is charged in the checkout payment).
 */
export const subscriptionGroupKey = (person) => person.subscriptionGroup || `person:${person.membershipId || person.id}`;

export const subscriptionGroups = (items, people) => {
  const groups = new Map();
  for (const item of items.filter((entry) => entry.monthly)) {
    const holders = people.filter((person) => (person.lineIds || []).includes(item.lineId));
    const key = holders.length ? subscriptionGroupKey(holders[0]) : 'order';
    const group = groups.get(key) || { key, membershipIds: [], names: [], lineIds: [] };
    for (const person of holders) {
      if (group.membershipIds.includes(person.membershipId)) continue;
      group.membershipIds.push(person.membershipId);
      group.names.push(`${person.firstName || ''} ${person.lastName || ''}`.trim());
    }
    group.lineIds.push(item.lineId);
    groups.set(key, group);
  }
  return [...groups.values()].map((group, index) => ({ ...group, primary: index === 0, status: index === 0 ? 'checkout' : 'pending' }));
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

export const activeSubscriptionItems = (subscription) => (subscription.items || []).filter((item) => item.status === 'active');

export const monthlyTotal = (subscription) => Math.round(activeSubscriptionItems(subscription)
  .reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0) * 100) / 100;
