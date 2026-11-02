/** A Stripe subscription as staff see it. The payer's name and email stay in Stripe; see `subscriberMembershipIds`. */
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
    id: subscription.id, stripeCustomerId: customer?.id || subscription.customer || '', orderRef: subscription.metadata?.order_ref || '',
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
  return { records: result.data.map(stripeSubscriberReport), payerEmails: payerEmails(result.data), nextCursor: result.has_more ? result.data.at(-1)?.id : null,
    checkedAt: new Date().toISOString() };
};

/** Each subscription's payer email, used only to find their orders and never stored. */
export const payerEmails = (subscriptions) => new Map(subscriptions.map((subscription) => [subscription.id,
  typeof subscription.customer === 'object' && !subscription.customer?.deleted ? String(subscription.customer?.email || '').trim().toLowerCase() : '']));

/**
 * The members a Stripe subscription pays for: from its `subscriptions` record, else the order in its metadata, else
 * every order placed with the payer's email.
 */
export const subscriberMembershipIds = async (db, record, email = '') => {
  const own = (await db.collection('subscriptions').doc(record.id).get()).data();
  if (own?.membershipIds?.length) return own.membershipIds;
  if (record.orderRef) {
    const order = (await db.collection('orders').doc(record.orderRef).get()).data();
    if (order?.membershipIds?.length) return order.membershipIds;
  }
  if (!email) return [];
  const orders = await db.collection('orders').where('email', '==', email).limit(50).get();
  return [...new Set(orders.docs.flatMap((document) => document.data().membershipIds || []))];
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

/**
 * Mirrors subscriptions into `stripeSubscriptions` and their payers into `stripeCustomers`, each with the
 * `membershipIds` they cover. A subscriber with no matching members keeps the ones already mirrored.
 */
export const importStripeSubscribers = async (db, records, mode, checkedAt, emails = new Map()) => {
  const imported = await Promise.all(records.map(async (record) => ({ ...importedSubscriber(record, mode),
    membershipIds: await subscriberMembershipIds(db, record, emails.get(record.id)) })));
  if (!imported.length) return imported;
  const customers = new Map();
  for (const record of imported) {
    const customer = customers.get(record.clubCustomerId) || { clubCustomerId: record.clubCustomerId, stripeCustomerId: record.stripeCustomerId,
      stripeMode: mode, membershipIds: [], lastCheckedAt: checkedAt };
    customer.membershipIds = [...new Set([...customer.membershipIds, ...record.membershipIds])];
    customers.set(record.clubCustomerId, customer);
  }
  const writes = [
    ...[...customers].map(([id, fields]) => ({ ref: db.collection('stripeCustomers').doc(id), fields })),
    ...imported.map((record) => ({ ref: db.collection('stripeSubscriptions').doc(record.clubSubscriptionId), record,
      fields: { ...record, lastCheckedAt: checkedAt } }))
  ];
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.getAll(...writes.map((write) => write.ref));
    writes.forEach((write, index) => {
      const membershipIds = [...new Set([...(existing[index].data()?.membershipIds || []), ...write.fields.membershipIds])];
      transaction.set(write.ref, { ...write.fields, membershipIds, ...(!existing[index].exists ? { firstImportedAt: checkedAt } : {}) }, { merge: true });
      if (write.record) write.record.membershipIds = membershipIds;
    });
  });
  return imported;
};

export const cancelStripeSubscription = async (request, id, clubCustomerId, mode) => {
  if (!/^sub_[a-zA-Z0-9]+$/.test(id)) throw new Error('Invalid Stripe subscription ID.');
  const subscription = await request(`subscriptions/${id}?expand[]=customer&expand[]=latest_invoice.payment_intent.latest_charge`);
  const record = importedSubscriber(stripeSubscriberReport(subscription), mode);
  if (record.id !== id) throw new Error('Stripe subscription does not match the requested subscription.');
  if (record.clubCustomerId !== clubCustomerId) throw new Error('Stripe customer does not match the imported customer. Refresh and check the record.');
  if (subscription.status === 'canceled') {
    return { record, changed: false };
  }
  if (record.status !== 'Active') throw new Error('Only an active, unsuspended subscription can be cancelled here.');
  const updated = await request(`subscriptions/${id}`, { method: 'DELETE',
    body: new URLSearchParams({ invoice_now: 'false', prorate: 'false' }) });
  if (updated.id !== id || updated.status !== 'canceled') {
    throw new Error('Stripe did not confirm immediate cancellation. Refresh the report before retrying.');
  }
  return { record: importedSubscriber(stripeSubscriberReport({ ...subscription, ...updated,
    customer: subscription.customer, latest_invoice: subscription.latest_invoice }), mode),
    changed: true };
};