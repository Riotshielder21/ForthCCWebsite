const trustedCallbacks = new Set(['/api/stripe/webhook', '/api/jobs/renewals']);

export const requiresAppCheck = ({ path, method }) => {
  if (!path.startsWith('/api/') || method === 'OPTIONS' || trustedCallbacks.has(path)) return false;
  return !['GET', 'HEAD'].includes(method)
    || /^\/api\/(?:admin(?:\/|$)|my-details(?:\/|$)|orders(?:\/|$)|event-rosters(?:\/|$)|checkout-receipt(?:\/|$)|club-night\/checkins(?:\/|$)|volunteers\/renew\/|renewals\/)/.test(path);
};

export const appCheckMiddleware = ({ mode = 'monitor', local = false, verifyToken, appIds = [], logger = console }) => {
  if (!['monitor', 'enforce'].includes(mode)) throw new Error('APP_CHECK_MODE must be monitor or enforce.');
  return async (req, res, next) => {
    if (local || !requiresAppCheck(req)) return next();
    const token = req.get('X-Firebase-AppCheck');
    if (!token) {
      logger.warn('App Check: missing token', { method: req.method, mode });
      if (mode === 'enforce') return res.status(401).json({ error: 'Website verification is required. Reload the website and try again.' });
      return next();
    }
    try {
      const verified = await verifyToken(token);
      if (appIds.length && !appIds.includes(verified.appId)) throw new Error('Unapproved Firebase app.');
    } catch (error) {
      logger.warn('App Check: verification failed', { code: error.code || 'verification-failed', mode });
      if (mode === 'enforce') return res.status(403).json({ error: 'Website verification failed. Reload the website and try again.' });
      return next();
    }
    logger.info('App Check: verified request', { method: req.method, mode });
    return next();
  };
};
