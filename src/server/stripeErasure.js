const idOf = (value) => typeof value === 'string' ? value : value?.id;
const ended = (subscription) => ['canceled', 'incomplete_expired'].includes(subscription.status);
const financialMetadata = new Set(['order_ref', 'line_id', 'club_year', 'cutoff_at', 'first_debit_at']);

const clearMetadata = (metadata = {}) => Object.keys(metadata)
  .filter((key) => !financialMetadata.has(key)).map((key) => [`metadata[${key}]`, '']);

const all = async (request, path, params) => {
  const records = [];
  let cursor;
  do {
    const query = new URLSearchParams({ ...params, limit: '100', ...(cursor ? { starting_after: cursor } : {}) });
    const page = await request(`${path}?${query}`);
    records.push(...page.data);
    if (page.has_more && !page.data.length) throw new Error(`Stripe returned an empty ${path} page with more records.`);
    cursor = page.has_more ? page.data.at(-1).id : null;
  } while (cursor);
  return records;
};

/** Customer deletion also cancels every subscription, so never delete a payer who still funds other people. */
export const eraseStripeDetails = async (request, { subscriptionIds, emails, customerIds = [], erasedPayerSubscriptionIds = new Set(), rememberCustomer = async () => {} }) => {
  const knownIds = new Set(subscriptionIds);
  const subscriptions = [];
  for (const id of knownIds) {
    try { subscriptions.push(await request(`subscriptions/${encodeURIComponent(id)}`)); }
    catch (error) { if (error.stripeCode !== 'resource_missing') throw error; }
  }
  for (const subscription of subscriptions) {
    const fields = clearMetadata(subscription.metadata);
    if (!ended(subscription)) fields.push(['description', '']);
    if (fields.length) await request(`subscriptions/${encodeURIComponent(subscription.id)}`, { method: 'POST', body: new URLSearchParams(fields) });
    for (const item of subscription.items?.data || []) {
      const metadata = clearMetadata(item.metadata);
      if (!ended(subscription) && metadata.length) {
        await request(`subscription_items/${encodeURIComponent(item.id)}`, { method: 'POST', body: new URLSearchParams(metadata) });
      }
    }
  }
  const customers = new Map();
  for (const id of customerIds) {
    try {
      const customer = await request(`customers/${encodeURIComponent(id)}`);
      if (!customer.deleted) customers.set(id, customer);
    } catch (error) { if (error.stripeCode !== 'resource_missing') throw error; }
  }
  for (const email of emails) {
    for (const customer of await all(request, 'customers', { email })) customers.set(customer.id, customer);
  }
  // Deleted customers are omitted by the email search; the subscription still points at them on a retry.
  for (const subscription of subscriptions) {
    const id = idOf(subscription.customer);
    if (!id || customers.has(id)) continue;
    const customer = await request(`customers/${encodeURIComponent(id)}`);
    if (!customer.deleted && (emails.has(String(customer.email || '').trim().toLowerCase()) || erasedPayerSubscriptionIds.has(subscription.id))) customers.set(id, customer);
  }
  let deleted = 0;
  let retained = 0;
  for (const customer of customers.values()) {
    // Remember before clearing the email, otherwise a failed DELETE can no longer be found by email on retry.
    await rememberCustomer(customer.id);
    const live = (await all(request, 'subscriptions', { customer: customer.id, status: 'all' })).filter((subscription) => !ended(subscription));
    if (live.some((subscription) => !knownIds.has(subscription.id))) {
      throw new Error('Stripe has an unlinked active subscription for this customer. Import and reconcile it before erasure so their billing can be stopped without cancelling other members.');
    }
    const fields = ['name', 'email', 'phone', 'address', 'shipping', 'description', 'metadata',
      'invoice_settings[footer]', 'invoice_settings[custom_fields]'].map((field) => [field, '']);
    await request(`customers/${encodeURIComponent(customer.id)}`, { method: 'POST', body: new URLSearchParams(fields) });
    if (!live.length) {
      await request(`customers/${encodeURIComponent(customer.id)}`, { method: 'DELETE' });
      deleted += 1;
    } else retained += 1;
  }
  return { deleted, retained };
};
