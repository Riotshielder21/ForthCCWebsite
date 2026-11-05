import { PAGE_CONTENT } from '../constants/pageContent';
import { PUBLIC_ROUTES } from './routes';

const requests = new Map();
export function loadPublishedPageContent(onContent, onError, page = 'home') {
  let active = true;
  let timer;
  const load = async (id) => {
    try {
      if (!requests.has(id)) requests.set(id, fetch(`/content/pages/${id}.json`, { cache: 'no-cache' }).then(async (response) => {
        if (response.status === 404) return {};
        if (!response.ok) throw new Error(`Could not load ${id} content (${response.status}).`);
        // Vite's development SPA fallback has no published JSON for unedited pages.
        if (import.meta.env?.DEV && response.headers.get('content-type')?.includes('text/html')) return {};
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`Invalid ${id} content response.`);
        return response.json();
      }));
      const content = await requests.get(id);
      if (active) onContent({ [id]: content });
    } catch (error) {
      requests.delete(id);
      if (active) onError(error);
    }
  };
  const first = PUBLIC_ROUTES[page]?.content || 'home';
  load(first).then(() => {
    timer = setTimeout(async () => {
      for (const id of Object.keys(PAGE_CONTENT)) {
        if (!active) break;
        if (id !== first) await load(id);
      }
    }, 1000);
  });
  return () => { active = false; clearTimeout(timer); };
}
