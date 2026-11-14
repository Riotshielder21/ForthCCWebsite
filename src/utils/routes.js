export const PUBLIC_ROUTES = {
  home: { path: '/', title: 'Home', content: 'home' },
  membership: { path: '/membership', title: 'Membership', content: 'membership' },
  beginners: { path: '/beginners', title: 'Beginners', content: 'beginners' },
  disciplines: { path: '/disciplines', title: 'Disciplines', content: 'disciplines' },
  volunteering: { path: '/volunteering', title: 'Volunteering' },
  about: { path: '/about', title: 'About', content: 'about' },
  'contact-us': { path: '/contact-us', title: 'Contact Us', content: 'contact' },
  safeguarding: { path: '/safeguarding', title: 'Safeguarding' },
  notices: { path: '/notices', title: 'Notices' },
  'access-project': { path: '/access-project', title: 'Access Project', content: 'access-project' }
};

const PRIVATE_ROUTES = {
  admin: '/admin', 'admin-reports': '/admin/reports', 'club-night': '/check-ins',
  'my-details': '/my-details', checkout: '/checkout', 'payment-success': '/payment-success', 'payment-issue': '/payment-issue'
};
export const LEGACY_REDIRECTS = { '/home': '/', '/activites': '/disciplines', '/activities': '/disciplines', '/contact': '/contact-us', '/club-night': '/check-ins' };
const CLUB_HOSTS = new Set(['forthcanoeclub.co.uk', 'www.forthcanoeclub.co.uk', 'new.forthcanoeclub.co.uk']);

export const pagePath = (page) => PUBLIC_ROUTES[page]?.path || PRIVATE_ROUTES[page] || null;

export function resolveRoute(value) {
  const url = new URL(value, 'https://forthcanoeclub.co.uk');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/_preview/')) {
    const content = path.slice('/_preview/'.length);
    const page = Object.keys(PUBLIC_ROUTES).find((key) => PUBLIC_ROUTES[key].content === content);
    return { page: page || 'not-found', url: url.pathname + url.search + url.hash, preview: true };
  }
  const queryPage = path === '/' ? url.searchParams.get('page') : null;
  const queryId = queryPage === 'contact' ? 'contact-us' : queryPage;
  const canonical = (queryPage && pagePath(queryId)) || LEGACY_REDIRECTS[path] || path;
  if (queryPage && pagePath(queryId)) url.searchParams.delete('page');
  const page = queryPage && !pagePath(queryId) ? 'not-found'
    : Object.keys(PUBLIC_ROUTES).find((key) => PUBLIC_ROUTES[key].path === canonical)
      || Object.keys(PRIVATE_ROUTES).find((key) => PRIVATE_ROUTES[key] === canonical)
      || (canonical.startsWith('/order/') ? 'order-lookup' : 'not-found');
  return { page, url: canonical + url.search + url.hash, preview: false };
}

export function relativeClubLink(value) {
  if (typeof value !== 'string' || !value) return value;
  if (value.startsWith('#') || (value.startsWith('?') && !new URLSearchParams(value).has('page'))) return value;
  const url = new URL(value, 'https://forthcanoeclub.co.uk');
  if (!CLUB_HOSTS.has(url.hostname) || !['https:', 'http:'].includes(url.protocol)) return value;
  return resolveRoute(url.href).url;
}

export function isSamePageHashLink(currentHref, targetHref) {
  const current = new URL(currentHref, 'https://forthcanoeclub.co.uk');
  const target = new URL(targetHref, current);
  return target.origin === current.origin && target.pathname === current.pathname
    && target.search === current.search && Boolean(target.hash);
}

export function interceptLink(event, origin) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target.closest?.('a[href]');
  if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')
    || anchor.closest('[contenteditable="true"], [data-editor-control]')) return null;
  const url = new URL(anchor.href);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return null;
  if (isSamePageHashLink(window.location.href, url.href)) return null;
  const route = resolveRoute(url.href);
  if (route.page === 'not-found' || route.preview) return null;
  return route;
}
