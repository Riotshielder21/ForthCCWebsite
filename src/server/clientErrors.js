import { rateLimit } from './rateLimit.js';
import { CLIENT_ERROR_KINDS, CLIENT_ERROR_PAGES } from '../utils/clientErrors.js';

export function registerClientErrorRoutes(app, { logger = console } = {}) {
  app.post('/api/client-errors', rateLimit(10, 60 * 1000), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const body = req.body;
    if (!body || Object.keys(body).some((key) => !['kind', 'page'].includes(key))
      || !CLIENT_ERROR_KINDS.includes(body.kind) || !CLIENT_ERROR_PAGES.includes(body.page)) {
      return res.status(400).json({ error: 'Choose a recognised browser error category and page.' });
    }
    logger.error(JSON.stringify({ severity: 'ERROR', event: 'fcc-client-error', kind: body.kind, page: body.page }));
    res.status(202).json({ accepted: true });
  });
}
