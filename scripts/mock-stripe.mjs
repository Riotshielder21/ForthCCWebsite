const originalFetch = globalThis.fetch;
let counter = 0;
const customers = new Set();
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
    return Response.json({ id: `cs_e2e_${Date.now()}_${counter}`, url: `https://checkout.stripe.com/e2e?return_url=${returnUrl}`, ...(recurring ? { subscription: cancelled ? 'sub_e2e_cancelled' : 'sub_e2e_active' } : {}) });
  }
  if (parsed.pathname === '/v1/coupons') return Response.json({ id: `coupon_${counter}` });
  if (parsed.pathname.startsWith('/v1/subscriptions/')) {
    const id = parsed.pathname.split('/').at(-1);
    return Response.json({ id, status: id.includes('cancelled') ? 'canceled' : 'active', customer: 'cus_e2e', latest_invoice: null });
  }
  throw new Error('Unexpected Stripe request: ' + parsed.pathname);
};
