const originalFetch = globalThis.fetch;
let counter = 0;
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.stripe.com/')) return originalFetch(url, options);
  const parsed = new URL(url);
  if (parsed.pathname === '/v1/checkout/sessions') {
    counter += 1;
    const params = new URLSearchParams(options.body);
    const recurring = params.get('mode') === 'subscription';
    const cancelled = params.get('customer_email')?.startsWith('coaching-cancelled.');
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
