/** Browser origins allowed to call the API: the site URLs, extra `CORS_ORIGINS`, and localhost outside production. */
export const allowedOrigins = (env = {}) => {
  const origins = [env.PUBLIC_SITE_URL, ...(env.PUBLIC_SITE_URLS || '').split(','), ...(env.CORS_ORIGINS || '').split(',')]
    .map((value) => {
      try { return value?.trim() ? new URL(value.trim()).origin : ''; } catch { return ''; }
    })
    .filter(Boolean);
  return new Set(origins);
};

export const isAllowedOrigin = (origin, allowed, { allowLocalhost = false } = {}) => {
  if (!origin) return true;
  if (allowed.has(origin)) return true;
  if (!allowLocalhost) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname);
  } catch {
    return false;
  }
};
