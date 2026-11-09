// Stands in for the Stripe API when the checkout flow test runs the server (`node --import ./scripts/mock-stripe.mjs`).
// It checks the requests the club-year design depends on, so a regression shows up as a Stripe error in the test.
const originalFetch = globalThis.fetch;
let counter = 0;
// Ids differ between API runs because the emulator keeps earlier runs' records.
const runId = Date.now().toString(36);
const customers = new Map();
const subscriptions = new Map();
const invoices = new Map();
const replies = new Map();
const checkoutPayments = new Map();
const checkoutSessions = new Map();
const flakyFailures = new Set();
const refunds = new Map();
const emailOf = (customer) => Buffer.from(String(customer).slice('cus_e2e_'.length), 'base64url').toString();
const now = () => Math.floor(Date.now() / 1000);
const live = (subscription) => ['active', 'trialing'].includes(subscription.status);
const fail = (message, status = 400) => Response.json({ error: { message, ...(status === 404 ? { code: 'resource_missing' } : {}) } }, { status });
// Payer email prefixes: `new-card.` uses different card details at every checkout; `sub-fail.` has every subscription
// change declined; `unpaid-feb.` has an unpaid invoice left open on each subscription (voided at the cut-off);
// `flaky.` has Stripe fail with a temporary error the first time each order's subscription is created;
// `paid-late.` has every Checkout Session paid straight away in Stripe, with the webhook never sent; `debit-fail.` has the
// next monthly debit on each subscription fail and stay open, for the period starting at the end of the current one, and
// Stripe cancel the subscription once the site looks for its uncollectible debits (as it does when Stripe gives up).
// Payment intent `pi_charge_<pence>_<suffix>` is a paid card payment that purchased-item refunds can draw on, and
// deleting a subscription item whose ID contains `_flaky_` fails with a temporary error the first time.
const paymentMethodFor = (email) => email.startsWith('new-card.') ? `pm_e2e_${counter}` : 'pm_e2e';
const itemsFrom = (params) => [...params.keys()].map((name) => /^items\[(\d+)\]\[price_data\]\[product\]$/.exec(name)?.[1]).filter(Boolean).map((index) => ({
  id: `si_e2e_${runId}_${counter}_${index}`,
  metadata: { line_id: params.get(`items[${index}][metadata][line_id]`), order_ref: params.get(`items[${index}][metadata][order_ref]`),
    club_year: params.get(`items[${index}][metadata][club_year]`) },
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
    if (method === 'GET') return Response.json({ data: [...customers.values()].filter((customer) => !customer.deleted && customer.email === email), has_more: false });
    const customer = { id, email };
    customers.set(id, customer);
    return Response.json(customer);
  }
  if (parsed.pathname.startsWith('/v1/customers/')) {
    const id = parsed.pathname.split('/').at(-1);
    const customer = customers.get(id);
    if (!customer) return fail('No such customer.', 404);
    if (method === 'POST') {
      for (const [key, value] of new URLSearchParams(options.body)) customer[key] = value;
    } else if (method === 'DELETE') {
      if ([...subscriptions.values()].some((subscription) => subscription.customer === id && !['canceled', 'incomplete_expired'].includes(subscription.status))) {
        return fail('Deleting this customer would cancel another subscription.');
      }
      customers.set(id, { id, deleted: true });
    }
    return Response.json(customers.get(id));
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
    const session = { id: `cs_e2e_${Date.now()}_${counter}`, url: `https://checkout.stripe.com/e2e?return_url=${returnUrl}`, mode, status: 'open',
      success_url: params.get('success_url') || '',
      payment_status: 'unpaid', metadata: { order_ref: orderRef }, ...(mode === 'setup' ? { setup_intent: `seti_${orderRef}` } : {}) };
    if (emailOf(params.get('customer')).startsWith('paid-late.')) {
      const amount = [...params.keys()].map((name) => /^line_items\[(\d+)\]\[price_data\]\[unit_amount\]$/.exec(name)?.[1]).filter(Boolean)
        .reduce((sum, index) => sum + Number(params.get(`line_items[${index}][price_data][unit_amount]`)) * Number(params.get(`line_items[${index}][quantity]`) || 1), 0);
      Object.assign(session, { status: 'complete', payment_status: 'paid', amount_total: amount, payment_intent: `pi_${orderRef}` });
    }
    checkoutSessions.set(session.id, session);
    return Response.json(session);
  }
  const checkoutSession = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(parsed.pathname);
  if (checkoutSession) {
    const session = checkoutSessions.get(checkoutSession[1]);
    if (!session) return fail('No such checkout session.', 404);
    if (!checkoutSession[2]) return Response.json(session);
    if (session.status !== 'open') return fail('Only an open checkout session can be expired.');
    session.status = 'expired';
    return Response.json(session);
  }
  const charged = /^\/v1\/payment_intents\/(pi_charge_(\d+)_\w+)$/.exec(parsed.pathname);
  if (charged) {
    const refunded = [...refunds.values()].filter((refund) => refund.payment_intent === charged[1]).reduce((sum, refund) => sum + refund.amount, 0);
    return Response.json({ id: charged[1], latest_charge: { id: `ch_${charged[1]}`, paid: true, currency: 'gbp', amount: Number(charged[2]), amount_refunded: refunded } });
  }
  if (parsed.pathname === '/v1/refunds' && method === 'GET') {
    return Response.json({ data: [...refunds.values()].filter((refund) => refund.payment_intent === parsed.searchParams.get('payment_intent')), has_more: false });
  }
  if (parsed.pathname.startsWith('/v1/refunds/')) {
    const refund = refunds.get(parsed.pathname.split('/').at(-1));
    return refund ? Response.json(refund) : fail('No such refund.', 404);
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
    // The site only asks for uncollectible debits once Stripe has given up on them, which cancels the subscription.
    const owner = subscriptions.get(subscription);
    if (status === 'uncollectible' && owner?.debitFails) Object.assign(owner, { status: 'canceled', ended_at: now() });
    return Response.json({ data: [...invoices.values()].filter((invoice) => invoice.subscription === subscription && (!status || invoice.status === status)) });
  }
  const key = options?.headers?.['Idempotency-Key'];
  if (key && replies.has(key)) return Response.json(replies.get(key));
  const remember = (body) => { if (key) replies.set(key, body); return Response.json(body); };
  if (parsed.pathname === '/v1/refunds' && method === 'POST') {
    const params = new URLSearchParams(options.body);
    const charge = /^pi_charge_(\d+)_/.exec(params.get('payment_intent') || '');
    const amount = Number(params.get('amount'));
    const refunded = [...refunds.values()].filter((refund) => refund.payment_intent === params.get('payment_intent')).reduce((sum, refund) => sum + refund.amount, 0);
    if (!charge || !(amount > 0) || refunded + amount > Number(charge[1])) return fail('The refund exceeds the charge.');
    counter += 1;
    const refund = { id: `re_e2e_${runId}_${counter}`, object: 'refund', status: 'succeeded', amount, payment_intent: params.get('payment_intent'),
      metadata: Object.fromEntries([...params].filter(([name]) => name.startsWith('metadata[')).map(([name, value]) => [name.slice(9, -1), value])) };
    refunds.set(refund.id, refund);
    return remember(refund);
  }
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
  if (parsed.pathname === '/v1/subscriptions' && method === 'GET') {
    const customer = parsed.searchParams.get('customer');
    return Response.json({ data: [...subscriptions.values()].filter((subscription) => !customer || subscription.customer === customer), has_more: false });
  }
  if (parsed.pathname === '/v1/subscriptions' && method === 'POST') {
    counter += 1;
    const params = new URLSearchParams(options.body);
    const email = emailOf(params.get('customer'));
    if (email.startsWith('sub-fail.')) return fail('Your card was declined.', 402);
    if (email.startsWith('flaky.') && !flakyFailures.has(params.get('metadata[order_ref]'))) {
      flakyFailures.add(params.get('metadata[order_ref]'));
      return fail('Stripe is temporarily unavailable.', 500);
    }
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
    if (email.startsWith('debit-fail.')) {
      const invoice = { id: `in_e2e_${runId}_${counter}_failed`, subscription: subscription.id, status: 'open', amount_due: items.reduce((sum, item) => sum + item.price.unit_amount, 0),
        lines: { data: [{ period: { start: subscription.current_period_end, end: subscription.current_period_end + 31 * 24 * 60 * 60 } }] } };
      invoices.set(invoice.id, invoice);
      subscription.debitFails = true;
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
    const item = { id: `si_e2e_${runId}_${counter}`, metadata: { line_id: params.get('metadata[line_id]'), order_ref: params.get('metadata[order_ref]'), club_year: params.get('metadata[club_year]') },
      price: { product: params.get('price_data[product]'), unit_amount: Number(params.get('price_data[unit_amount]')), recurring: { interval: 'month' } } };
    owner.items.data.push(item);
    return remember(item);
  }
  if (parsed.pathname.startsWith('/v1/subscription_items/') && method === 'POST') {
    const id = parsed.pathname.split('/').at(-1);
    const params = new URLSearchParams(options.body);
    const item = [...subscriptions.values()].flatMap((subscription) => subscription.items.data).find((entry) => entry.id === id);
    if (!item) return fail('No such subscription item.', 404);
    if ([...params.keys()].every((key) => key.startsWith('metadata['))) {
      for (const [key, value] of params) item.metadata[key.slice(9, -1)] = value;
      return remember(item);
    }
    // Volunteer prices apply from the next debit: the same product, monthly, with no proration.
    if (params.get('proration_behavior') !== 'none' || params.get('price_data[product]') !== item.price.product
      || params.get('price_data[recurring][interval]') !== 'month' || !(Number(params.get('price_data[unit_amount]')) > 0)) {
      return fail('A price change keeps the product and monthly interval, without prorations.');
    }
    item.price = { ...item.price, unit_amount: Number(params.get('price_data[unit_amount]')) };
    return remember(item);
  }
  if (parsed.pathname.startsWith('/v1/subscription_items/') && method === 'DELETE') {
    const id = parsed.pathname.split('/').at(-1);
    if (id.includes('_flaky_') && !flakyFailures.has(id)) {
      flakyFailures.add(id);
      return fail('Stripe is temporarily unavailable.', 500);
    }
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
      if ([...params.keys()].every((key) => key.startsWith('metadata[') || key === 'description')) {
        for (const [key, value] of params) {
          if (key === 'description') known.description = value;
          else known.metadata[key.slice(9, -1)] = value;
        }
        return remember(known);
      }
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
