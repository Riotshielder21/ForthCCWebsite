import { PUBLIC_ROUTES, PRIVATE_ROUTES, resolveRoute } from './routes.js';
import { isStaleBuildError } from './staleBuild.js';

export const CLIENT_ERROR_KINDS = ['javascript', 'promise', 'page-render', 'asset-load', 'auth-network', 'api-network', 'api-server'];
export const CLIENT_ERROR_PAGES = [...Object.keys(PUBLIC_ROUTES), ...Object.keys(PRIVATE_ROUTES), 'order-lookup', 'not-found'];

export function clientErrorKind(error, fallback = 'javascript') {
  if (error?.code === 'auth/network-request-failed' || error?.cause?.code === 'auth/network-request-failed') return 'auth-network';
  if (isStaleBuildError(error)) return 'asset-load';
  return fallback;
}

export function createClientErrorReporter({ send, location = () => globalThis.location.href, now = Date.now, logger = console }) {
  const sent = new Map();
  let count = 0;
  return async (kind) => {
    if (!CLIENT_ERROR_KINDS.includes(kind)) throw new Error('Unknown browser error category.');
    const page = resolveRoute(location()).page;
    const key = `${kind}:${page}`;
    const time = now();
    if (count >= 10 || (sent.has(key) && time - sent.get(key) < 60000)) return;
    sent.set(key, time);
    count += 1;
    try {
      await send({ kind, page });
    } catch {
      logger.warn('Browser error report could not be delivered.');
    }
  };
}

// Privacy tools routinely block Google Analytics and reCAPTCHA scripts; only the site's own files show a broken release.
const siteFile = (element, origin) => {
  try {
    return new URL(element.src || element.href, origin).origin === origin;
  } catch {
    return true;
  }
};

export function installClientErrorListeners(target, report) {
  const onError = (event) => {
    const resource = event.target && event.target !== target;
    if (resource && (!['SCRIPT', 'LINK'].includes(event.target.tagName) || !siteFile(event.target, target.location?.origin))) return;
    void report(resource ? 'asset-load' : clientErrorKind(event.error));
  };
  const onRejection = (event) => { void report(clientErrorKind(event.reason, 'promise')); };
  target.addEventListener('error', onError, true);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError, true);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
