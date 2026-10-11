export const stripeSubscriberReport = (subscription) => {
  const customer = typeof subscription.customer === 'object' ? subscription.customer : null;
  const invoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null;
  const payment = invoice?.payment_intent;
  const charge = typeof payment?.latest_charge === 'object' ? payment.latest_charge
    : typeof invoice?.charge === 'object' ? invoice.charge : null;
  const reversed = Boolean(charge?.refunded || charge?.amount_refunded > 0 || charge?.disputed);
  const suspended = Boolean(subscription.pause_collection);
  const active = subscription.status === 'active' && !suspended && !reversed;
  const items = (subscription.items?.data || []).map((item) => ({
    name: item.price?.nickname || item.price?.id || 'Subscription',
    amount: item.price?.unit_amount === null ? null : (item.price?.unit_amount ?? 0) / 100,
    currency: item.price?.currency || '', interval: item.price?.recurring?.interval || '', quantity: item.quantity ?? 1
  }));
  const timestamp = (value) => value ? new Date(value * 1000).toISOString() : null;
  return {
    id: subscription.id, stripeCustomerId: customer?.id || subscription.customer || '',
    name: customer?.deleted ? '' : customer?.name || '', email: customer?.deleted ? '' : customer?.email || '',
    status: active ? 'Active' : 'Inactive', stripeStatus: subscription.status,
    reason: reversed ? 'Payment refunded or disputed' : suspended ? 'Payments suspended' : active ? '' : subscription.status,
    cancelAt: timestamp(subscription.cancel_at), cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: timestamp(subscription.current_period_end), createdAt: timestamp(subscription.created),
    paymentReversed: reversed, refundCheckAvailable: Boolean(charge), items
  };
};

export const loadStripeSubscribers = async (request, cursor) => {
  const params = new URLSearchParams({ status: 'all', limit: '100' });
  params.append('expand[]', 'data.customer');
  params.append('expand[]', 'data.latest_invoice.payment_intent.latest_charge');
  if (cursor) params.set('starting_after', cursor);
  const result = await request(`subscriptions?${params}`);
  return { records: result.data.map(stripeSubscriberReport), nextCursor: result.has_more ? result.data.at(-1)?.id : null,
    checkedAt: new Date().toISOString() };
};

export const nextClubYearEnd = (now = new Date()) => {
  const year = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric' }).format(now));
  const boundary = new Date(Date.UTC(year, 2, 1));
  return new Date(Date.UTC(now >= boundary ? year + 1 : year, 2, 1)).toISOString();
};

export const importedSubscriber = (record, mode) => {
  if (!['test', 'live'].includes(mode) || !/^sub_[a-zA-Z0-9]+$/.test(record.id)
    || typeof record.stripeCustomerId !== 'string' || !/^cus_[a-zA-Z0-9]+$/.test(record.stripeCustomerId)) {
    throw new Error('Invalid Stripe subscriber identity.');
  }
  return { ...record, clubCustomerId: `FCC-${mode}-${record.stripeCustomerId}`,
    clubSubscriptionId: `FCC-${mode}-${record.id}`, stripeMode: mode };
};

export const importStripeSubscribers = async (db, records, mode, checkedAt) => {
  const imported = records.map((record) => importedSubscriber(record, mode));
  if (!imported.length) return imported;
  const customers = new Map(imported.map((record) => [record.clubCustomerId, {
    clubCustomerId: record.clubCustomerId, stripeCustomerId: record.stripeCustomerId,
    stripeMode: mode, name: record.name, email: record.email, lastCheckedAt: checkedAt
  }]));
  const writes = [
    ...[...customers].map(([id, fields]) => ({ ref: db.collection('stripeCustomers').doc(id), fields })),
    ...imported.map((record) => ({ ref: db.collection('stripeSubscriptions').doc(record.clubSubscriptionId),
      fields: { ...record, lastCheckedAt: checkedAt } }))
  ];
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.getAll(...writes.map((write) => write.ref));
    writes.forEach((write, index) => transaction.set(write.ref, { ...write.fields,
      ...(!existing[index].exists ? { firstImportedAt: checkedAt } : {}) }, { merge: true }));
  });
  return imported;
};

export const scheduleClubYearCancellation = async (request, id, clubCustomerId, mode, now = new Date()) => {
  if (!/^sub_[a-zA-Z0-9]+$/.test(id)) throw new Error('Invalid Stripe subscription ID.');
  const subscription = await request(`subscriptions/${id}?expand[]=customer&expand[]=latest_invoice.payment_intent.latest_charge`);
  const record = importedSubscriber(stripeSubscriberReport(subscription), mode);
  if (record.clubCustomerId !== clubCustomerId) throw new Error('Stripe customer does not match the imported customer. Refresh and check the record.');
  if (record.status !== 'Active') throw new Error('Only an active, unsuspended subscription can be scheduled.');
  const boundary = nextClubYearEnd(now);
  const existingEnd = record.cancelAt || (record.cancelAtPeriodEnd ? record.currentPeriodEnd : null);
  if (existingEnd && new Date(existingEnd) <= new Date(boundary)) {
    return { record, clubYearEnd: boundary, cancellationAt: existingEnd, changed: false };
  }
  const params = new URLSearchParams({
    cancel_at: String(Math.floor(new Date(boundary).getTime() / 1000)), proration_behavior: 'none',
    'metadata[fcc_customer_id]': record.clubCustomerId,
    'metadata[fcc_subscription_id]': record.clubSubscriptionId,
    'metadata[fcc_club_year_end]': boundary
  });
  const updated = await request(`subscriptions/${id}`, { method: 'POST', body: params,
    idempotencyKey: `fcc-club-year-${mode}-${id}-${boundary.slice(0, 10)}` });
  const cancellationAt = updated.cancel_at ? new Date(updated.cancel_at * 1000).toISOString() : null;
  if (cancellationAt !== boundary) throw new Error('Stripe did not confirm the requested cancellation date. Refresh the report before retrying.');
  return { record: importedSubscriber(stripeSubscriberReport({ ...subscription, ...updated,
    customer: subscription.customer, latest_invoice: subscription.latest_invoice }), mode),
    clubYearEnd: boundary, cancellationAt, changed: true };
};