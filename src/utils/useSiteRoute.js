import { useCallback, useEffect, useRef, useState } from 'react';
import { interceptLink, pagePath, resolveRoute } from './routes';
import { pageMetadata } from './pageMetadata';

export function useSiteRoute() {
  const [route, setRoute] = useState(() => resolveRoute(window.location.href));
  const routeRef = useRef(route);
  const navigate = useCallback((next, replace = false) => {
    const url = new URL(next.url, window.location.origin);
    if (url.pathname + url.search + url.hash !== window.location.pathname + window.location.search + window.location.hash) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', next.url);
    }
    routeRef.current = next;
    setRoute(next);
    if (url.hash) requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView());
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = resolveRoute(window.location.href);
      if (!next.preview) window.history.replaceState(null, '', next.url);
      routeRef.current = next;
      setRoute(next);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    const metadata = pageMetadata(route.page);
    document.title = metadata.title;
    for (const [name, content] of Object.entries({ description: metadata.description, robots: metadata.robots })) {
      let element = document.querySelector(`meta[name="${name}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.name = name;
        document.head.append(element);
      }
      element.content = content;
    }
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!metadata.canonical) canonical?.remove();
    else {
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.append(canonical);
      }
      canonical.href = metadata.canonical;
    }
  }, [route.page]);

  const setCurrentPage = useCallback((value) => {
    const page = typeof value === 'function' ? value(routeRef.current.page) : value;
    if (page === routeRef.current.page) return;
    const path = pagePath(page);
    if (!path) throw new Error(`Unknown navigation destination: ${page}`);
    navigate(resolveRoute(path));
  }, [navigate]);

  const onLinkClick = useCallback((event) => {
    const next = interceptLink(event, window.location.origin);
    if (!next) return;
    event.preventDefault();
    navigate(next);
  }, [navigate]);

  const navigateTo = useCallback((url) => navigate(resolveRoute(url)), [navigate]);
  return { currentPage: route.page, setCurrentPage, onLinkClick, navigateTo };
}
