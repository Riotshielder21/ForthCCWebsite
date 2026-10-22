const originalFetch = globalThis.fetch;
let counter = 0;
const customers = new Set();
const subscriptions = new Map();
const replies = new Map();
const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.stripe.com/')) return originalFetch(url, options);
  const parsed = new URL(url);
  if (parsed.pathname === '/v1/customers') {
    const email = (options?.method || 'GET') === 'GET' ? parsed.searchParams.get('email') : new URLSearchParams(options.body).get('email');
    if (!email) throw new Error('Stripe customer requests must include the checkout email.');
    const id = `cus_e2e_${Buffer.from(email).toString('base64url')}`;
    return Response.json(options?.method === 'GET' ? { data: customers.has(id) ? [{ id, email }] : [] } : (customers.add(id), { id, email }));
  }
  if (parsed.pathname === '/v1/checkout/sessions') {
    counter += 1;
    const params = new URLSearchParams(options.body);
    if (params.has('customer_email') || !params.get('customer')?.startsWith('cus_e2e_')) throw new Error('Checkout must use the Stripe customer created for the checkout email.');
    const email = Buffer.from(params.get('customer').slice('cus_e2e_'.length), 'base64url').toString();
    const recurring = params.get('mode') === 'subscription';
    const cancelled = email.startsWith('coaching-cancelled.');
    const returnUrl = encodeURIComponent(params.get('success_url') || '');
    let subscription;
    if (recurring) {
      subscription = cancelled ? 'sub_e2e_cancelled' : `sub_e2e_active_${counter}`;
      const items = [...params.keys()].map((key) => /^line_items\[(\d+)\]\[price_data\]\[recurring\]/.exec(key)?.[1]).filter(Boolean).map((index) => ({
        id: `si_e2e_${counter}_${index}`, metadata: {},
        price: { product: { metadata: { line_id: params.get(`line_items[${index}][price_data][product_data][metadata][line_id]`) } },
          unit_amount: Number(params.get(`line_items[${index}][price_data][unit_amount]`)) }
      }));
      if (!cancelled) subscriptions.set(subscription, { id: subscription, status: 'active', customer: params.get('customer'), default_payment_method: 'pm_e2e', current_period_end: periodEnd, latest_invoice: null, items: { data: items } });
    }
    return Response.json({ id: `cs_e2e_${Date.now()}_${counter}`, url: `https://checkout.stripe.com/e2e?return_url=${returnUrl}`, ...(subscription ? { subscription } : {}) });
  }
  if (parsed.pathname === '/v1/coupons') return Response.json({ id: `coupon_${counter}` });
  const method = options?.method || 'GET';
  const key = options?.headers?.['Idempotency-Key'];
  if (key && replies.has(key)) return Response.json(replies.get(key));
  const remember = (body) => { if (key) replies.set(key, body); return Response.json(body); };
  if (parsed.pathname === '/v1/products' && method === 'POST') {
    counter += 1;
    return remember({ id: `prod_e2e_${counter}`, metadata: { line_id: new URLSearchParams(options.body).get('metadata[line_id]') } });
  }
  if (parsed.pathname === '/v1/subscriptions' && method === 'POST') {
    counter += 1;
    const params = new URLSearchParams(options.body);
    const email = Buffer.from(params.get('customer').slice('cus_e2e_'.length), 'base64url').toString();
    if (email.startsWith('sub-fail.')) return Response.json({ error: { message: 'Your card was declined.' } }, { status: 402 });
    if (params.get('default_payment_method') !== 'pm_e2e' || params.get('proration_behavior') !== 'none' || Number(params.get('billing_cycle_anchor')) !== periodEnd) {
      return Response.json({ error: { message: 'Extra subscriptions must reuse the checkout payment method and billing date.' } }, { status: 400 });
    }
    const id = `sub_e2e_active_${counter}`;
    const items = [...params.keys()].map((name) => /^items\[(\d+)\]\[price_data\]\[product\]$/.exec(name)?.[1]).filter(Boolean).map((index) => ({
      id: `si_e2e_${counter}_${index}`, metadata: { line_id: params.get(`items[${index}][metadata][line_id]`) },
      price: { product: params.get(`items[${index}][price_data][product]`), unit_amount: Number(params.get(`items[${index}][price_data][unit_amount]`)) }
    }));
    const subscription = { id, status: 'active', customer: params.get('customer'), default_payment_method: 'pm_e2e', current_period_end: periodEnd, latest_invoice: null, items: { data: items } };
    subscriptions.set(id, subscription);
    return remember(subscription);
  }
  if (parsed.pathname.startsWith('/v1/subscription_items/') && method === 'DELETE') {
    const id = parsed.pathname.split('/').at(-1);
    const owner = [...subscriptions.values()].find((subscription) => subscription.items.data.some((item) => item.id === id));
    if (!owner) return Response.json({ error: { message: 'No such subscription item.' } }, { status: 404 });
    if (owner.items.data.length === 1) return Response.json({ error: { message: 'A subscription must keep at least one item.' } }, { status: 400 });
    owner.items.data = owner.items.data.filter((item) => item.id !== id);
    return Response.json({ id, deleted: true });
  }
  if (parsed.pathname.startsWith('/v1/subscriptions/')) {
    const id = parsed.pathname.split('/').at(-1);
    const known = subscriptions.get(id);
    if (known && method === 'DELETE') known.status = 'canceled';
    return Response.json(known || { id, status: id.includes('cancelled') ? 'canceled' : 'active', customer: 'cus_e2e', latest_invoice: null });
  }
  throw new Error('Unexpected Stripe request: ' + parsed.pathname);
};
