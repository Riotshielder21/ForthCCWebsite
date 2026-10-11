const originalFetch = globalThis.fetch;
let counter = 0;
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.stripe.com/')) return originalFetch(url, options);
  const parsed = new URL(url);
  if (parsed.pathname === '/v1/checkout/sessions') {
    counter += 1;
    return Response.json({ id: `cs_e2e_${Date.now()}_${counter}`, url: 'https://checkout.stripe.com/e2e' });
  }
  if (parsed.pathname === '/v1/coupons') return Response.json({ id: `coupon_${counter}` });
  throw new Error('Unexpected Stripe request: ' + parsed.pathname);
};
