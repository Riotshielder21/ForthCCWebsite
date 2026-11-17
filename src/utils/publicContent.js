import { PAGE_CONTENT } from '../constants/pageContent.js';
import { PUBLIC_ROUTES } from './routes.js';

const requests = new Map();

const fetchPageContent = async (id) => {
  const response = await fetch(`/content/pages/${id}.json`, { cache: 'no-cache' });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`Could not load ${id} content (${response.status}).`);

  const contentType = response.headers.get('content-type') || '';
  // Vite's development SPA fallback has no published JSON for unedited pages.
  if (import.meta.env?.DEV && contentType.includes('text/html')) return {};
  if (!contentType.includes('application/json')) throw new Error(`Invalid ${id} content response.`);

  return response.json();
};

const requestPageContent = (id) => {
  if (!requests.has(id)) {
    const pending = fetchPageContent(id).finally(() => requests.delete(id));
    requests.set(id, pending);
  }

  return requests.get(id);
};

export function loadPublishedPageContent(onContent, onError, page = 'home') {
  let active = true;
  let timer;

  const load = async (id) => {
    try {
      const content = await requestPageContent(id);
      if (active) onContent({ [id]: content });
    } catch (error) {
      if (active) onError(error);
    }
  };

  const first = PUBLIC_ROUTES[page]?.content || 'home';
  load(first).then(() => {
    if (!active) return;

    timer = setTimeout(async () => {
      for (const id of Object.keys(PAGE_CONTENT)) {
        if (!active) break;
        if (id !== first) await load(id);
      }
    }, 1000);
  });

  return () => {
    active = false;
    clearTimeout(timer);
  };
}
