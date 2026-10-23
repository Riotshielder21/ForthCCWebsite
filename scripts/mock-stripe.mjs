// Stands in for the Stripe API when the checkout flow test runs the server (`node --import ./scripts/mock-stripe.mjs`).
// It checks the requests the club-year design depends on, so a regression shows up as a Stripe error in the test.
const originalFetch = globalThis.fetch;
let counter = 0;
// Ids differ between API runs because the emulator keeps earlier runs' records.
const runId = Date.now().toString(36);
const customers = new Set();
const subscriptions = new Map();
const invoices = new Map();
const replies = new Map();
const checkoutPayments = new Map();
const emailOf = (customer) => Buffer.from(String(customer).slice('cus_e2e_'.length), 'base64url').toString();
const now = () => Math.floor(Date.now() / 1000);
const live = (subscription) => ['active', 'trialing'].includes(subscription.status);
const fail = (message, status = 400) => Response.json({ error: { message } }, { status });
// Payer email prefixes: `new-card.` uses different card details at every checkout; `sub-fail.` has every subscription
// change declined; `unpaid-feb.` has an unpaid invoice left open on each subscription (voided at the cut-off).
const paymentMethodFor = (email) => email.startsWith('new-card.') ? `pm_e2e_${counter}` : 'pm_e2e';
const itemsFrom = (params) => [...params.keys()].map((name) => /^items\[(\d+)\]\[price_data\]\[product\]$/.exec(name)?.[1]).filter(Boolean).map((index) => ({
  id: `si_e2e_${runId}_${counter}_${index}`,
  metadata: { line_id: params.get(`items[${index}][metadata][line_id]`), club_year: params.get(`items[${index}][metadata][club_year]`) },
  price: { product: params.get(`items[${index}][price_data][product]`), unit_amount: Number(params.get(`items[${index}][price_data][unit_amount]`)),
    recurring: { interval: params.get(`items[${index}][price_data][recurring][interval]`) } }
}));

globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.stripe.com/')) return originalFetch(url, options);
  const parsed = new URL(url);
  const method = options?.method || 'GET';
  if (parsed.pathname === '/v1/customers') {
    const email = method === 'GET' ? parsed.searchParams.get('email') : new URLSearchParams(options.body).get('email');
    if (!email) throw new Error('Stripe customer requests must include the checkout email.');
    const id = `cus_e2e_${Buffer.from(email).toString('base64url')}`;
    return Response.json(method === 'GET' ? { data: customers.has(id) ? [{ id, email }] : [] } : (customers.add(id), { id, email }));
  }
  if (parsed.pathname === '/v1/checkout/sessions') {
    counter += 1;
    const params = new URLSearchParams(options.body);
    if (params.has('customer_email') || !params.get('customer')?.startsWith('cus_e2e_')) throw new Error('Checkout must use the Stripe customer created for the checkout email.');
    const mode = params.get('mode');
    const orderRef = params.get('metadata[order_ref]');
    if (mode === 'setup' && (params.get('currency') !== 'gbp' || params.get('setup_intent_data[metadata][order_ref]') !== orderRef || params.has('line_items[0][quantity]'))) {
      return fail('A setup session needs a currency and order reference, and no line items.');
    }
    if (!['payment', 'setup'].includes(mode)) return fail(`Checkout is never used in ${mode} mode; subscriptions are created after payment.`);
    checkoutPayments.set(orderRef, { customer: params.get('customer'), paymentMethod: paymentMethodFor(emailOf(params.get('customer'))),
      saved: mode === 'setup' || params.get('payment_intent_data[setup_future_usage]') === 'off_session' });
    const returnUrl = encodeURIComponent(params.get('success_url') || '');
    return Response.json({ id: `cs_e2e_${Date.now()}_${counter}`, url: `https://checkout.stripe.com/e2e?return_url=${returnUrl}`, mode,
      ...(mode === 'setup' ? { setup_intent: `seti_${orderRef}` } : {}) });
  }
  if (/^\/v1\/(payment|setup)_intents\//.test(parsed.pathname)) {
    const id = parsed.pathname.split('/').at(-1);
    const payment = checkoutPayments.get(id.replace(/^(pi|seti)_/, ''));
    if (!payment) return fail('No such intent.', 404);
    return Response.json({ id, customer: payment.customer, payment_method: payment.saved ? payment.paymentMethod : null });
  }
  if (parsed.pathname.startsWith('/v1/payment_methods/')) {
    const id = parsed.pathname.split('/').at(-1);
    return Response.json({ id, type: 'card', card: { fingerprint: `fp_${id}` } });
  }
  if (parsed.pathname === '/v1/invoices' && method === 'GET') {
    const subscription = parsed.searchParams.get('subscription');
    const status = parsed.searchParams.get('status');
    return Response.json({ data: [...invoices.values()].filter((invoice) => invoice.subscription === subscription && (!status || invoice.status === status)) });
  }
  const key = options?.headers?.['Idempotency-Key'];
  if (key && replies.has(key)) return Response.json(replies.get(key));
  const remember = (body) => { if (key) replies.set(key, body); return Response.json(body); };
  if (/^\/v1\/invoices\/[^/]+\/void$/.test(parsed.pathname) && method === 'POST') {
    const invoice = invoices.get(parsed.pathname.split('/')[3]);
    if (!invoice || invoice.status !== 'open') return fail('Only an open invoice can be voided.');
    invoice.status = 'void';
    return remember(invoice);
  }
  if (parsed.pathname === '/v1/products' && method === 'POST') {
    counter += 1;
    return remember({ id: `prod_e2e_${runId}_${counter}`, metadata: { line_id: new URLSearchParams(options.body).get('metadata[line_id]') } });
  }
  if (parsed.pathname === '/v1/subscriptions' && method === 'POST') {
    counter += 1;
    const params = new URLSearchParams(options.body);
    const email = emailOf(params.get('customer'));
    if (email.startsWith('sub-fail.')) return fail('Your card was declined.', 402);
    const clubYear = params.get('metadata[club_year]');
    const cutoff = Number(params.get('metadata[cutoff_at]'));
    const paymentMethod = params.get('default_payment_method');
    if (!paymentMethod?.startsWith('pm_e2e') || !clubYear || !cutoff) return fail('A subscription needs saved payment details, a club year and a cut-off.');
    // Items paid with the same details for the same club year must join the existing subscription instead.
    if ([...subscriptions.values()].some((owned) => owned.customer === params.get('customer') && live(owned)
      && owned.metadata.club_year === clubYear && owned.default_payment_method === paymentMethod)) {
      return fail('These payment details already pay a subscription for this club year.');
    }
    const items = itemsFrom(params);
    if (!items.length || items.some((item) => item.price.recurring.interval !== 'month' || item.metadata.club_year !== clubYear)) {
      return fail('Every item must be monthly and belong to the subscription\'s club year.');
    }
    let subscription;
    const base = { id: `sub_e2e_${runId}_${counter}`, customer: params.get('customer'), default_payment_method: paymentMethod, latest_invoice: null,
      metadata: { order_ref: params.get('metadata[order_ref]'), club_year: clubYear, cutoff_at: String(cutoff) }, items: { data: items } };
    if (params.has('trial_end')) {
      const trialEnd = Number(params.get('trial_end'));
      if (trialEnd <= now() || Number(params.get('cancel_at')) !== cutoff || params.get('proration_behavior') !== 'none' || params.has('billing_cycle_anchor')) {
        return fail('A waiting subscription starts at a future 1st and is cancelled at the cut-off without prorations.');
      }
      subscription = { ...base, status: 'trialing', trial_end: trialEnd, cancel_at: cutoff, current_period_start: now(), current_period_end: trialEnd };
    } else {
      const start = Number(params.get('backdate_start_date'));
      const anchor = Number(params.get('billing_cycle_anchor'));
      if (!start || start > now() || anchor <= now() || params.get('proration_behavior') !== 'create_prorations' || params.has('cancel_at')) {
        return fail('A late subscription is backdated to its missed 1st, anchored on the next 1st and prorated; cancel_at is set afterwards.');
      }
      subscription = { ...base, status: 'active', cancel_at: null, current_period_start: start, current_period_end: anchor };
    }
    subscriptions.set(subscription.id, subscription);
    if (email.startsWith('unpaid-feb.')) {
      const invoice = { id: `in_e2e_${runId}_${counter}`, subscription: subscription.id, status: 'open', amount_due: items.reduce((sum, item) => sum + item.price.unit_amount, 0) };
      invoices.set(invoice.id, invoice);
    }
    return remember(subscription);
  }
  if (parsed.pathname === '/v1/subscription_items' && method === 'POST') {
    counter += 1;
    const params = new URLSearchParams(options.body);
    const owner = subscriptions.get(params.get('subscription'));
    if (!owner || !live(owner)) return fail('No such live subscription.', 404);
    if (emailOf(owner.customer).startsWith('sub-fail.')) return fail('Your card was declined.', 402);
    // A waiting subscription's first debit is a full month; an item joining after a missed 1st is prorated.
    const expected = owner.status === 'trialing' ? 'none' : 'create_prorations';
    if (params.get('proration_behavior') !== expected || params.get('price_data[recurring][interval]') !== 'month'
      || params.get('metadata[club_year]') !== owner.metadata.club_year) {
      return fail(`Added items must be monthly, in the subscription's club year, with proration ${expected}.`);
    }
    const item = { id: `si_e2e_${runId}_${counter}`, metadata: { line_id: params.get('metadata[line_id]'), club_year: params.get('metadata[club_year]') },
      price: { product: params.get('price_data[product]'), unit_amount: Number(params.get('price_data[unit_amount]')), recurring: { interval: 'month' } } };
    owner.items.data.push(item);
    return remember(item);
  }
  if (parsed.pathname.startsWith('/v1/subscription_items/') && method === 'DELETE') {
    const id = parsed.pathname.split('/').at(-1);
    const owner = [...subscriptions.values()].find((subscription) => subscription.items.data.some((item) => item.id === id));
    if (!owner) return fail('No such subscription item.', 404);
    if (owner.items.data.length === 1) return fail('A subscription must keep at least one item.');
    owner.items.data = owner.items.data.filter((item) => item.id !== id);
    return Response.json({ id, deleted: true });
  }
  if (parsed.pathname.startsWith('/v1/subscriptions/')) {
    const id = parsed.pathname.split('/').at(-1);
    const known = subscriptions.get(id);
    if (method === 'POST') {
      const params = new URLSearchParams(options.body);
      if (!known) return fail('No such subscription.', 404);
      if ([...params.keys()].sort().join() !== 'cancel_at,proration_behavior' || params.get('proration_behavior') !== 'none'
        || Number(params.get('cancel_at')) !== Number(known.metadata.cutoff_at)) {
        return fail('An existing subscription is only ever given its cut-off, without prorations.');
      }
      known.cancel_at = Number(params.get('cancel_at'));
      return remember(known);
    }
    if (known && method === 'DELETE') Object.assign(known, { status: 'canceled', ended_at: now() });
    return Response.json(known || { id, status: id.includes('cancelled') ? 'canceled' : 'active', customer: 'cus_e2e', latest_invoice: null, metadata: {} });
  }
  throw new Error('Unexpected Stripe request: ' + parsed.pathname);
};
