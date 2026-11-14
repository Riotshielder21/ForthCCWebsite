import { apiUrl, apiFetch } from './api';

export const subscribeToProducts = (onProducts, onError) => {
  let stopped = false;
  let unsubscribe = () => {};
  import('./contentFirebase.js').then(({ subscribeToProducts: subscribe }) => {
    if (!stopped) unsubscribe = subscribe(onProducts, onError);
  }).catch(onError);
  return () => { stopped = true; unsubscribe(); };
};

export { loadPublishedPageContent } from './publicContent';

export const loadSavedPageDrafts = async (idToken) => {
  const response = await apiFetch(apiUrl('/api/admin/page-drafts'), {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: 'no-store'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not check saved page drafts.');
  if (!result.pages || typeof result.pages !== 'object' || Array.isArray(result.pages)) throw new Error('Invalid saved page drafts response.');
  return result;
};

export const savePageContent = async (pageId, content, idToken) => {
  const response = await apiFetch(apiUrl('/api/admin/publish-page'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ pageId, content })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not publish page content.');
  return result;
};

export const reserveProductId = async (idToken) => {
  const response = await apiFetch(apiUrl('/api/admin/products/reserve-id'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not create a product ID.');
  return result.id;
};

const eventRosterViewers = async (productId, idToken, viewers) => {
  const response = await apiFetch(apiUrl(`/api/admin/events/${encodeURIComponent(productId)}/roster-viewers`), {
    method: viewers === undefined ? 'GET' : 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    ...(viewers === undefined ? {} : { body: JSON.stringify({ viewers }) }),
    cache: 'no-store'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not access attendee-list viewers.');
  if (!Array.isArray(result.viewers) || result.viewers.some((value) => typeof value !== 'string')) throw new Error('Invalid attendee-list viewers response.');
  return result.viewers;
};

export const loadEventRosterViewers = (productId, idToken) => eventRosterViewers(productId, idToken);
export const saveEventRosterViewers = (productId, viewers, idToken) => eventRosterViewers(productId, idToken, viewers);

const defer = (name) => (...args) => import('./contentFirebase.js').then((module) => module[name](...args));
export const saveProduct = defer('saveProduct');
export const removeProduct = defer('removeProduct');
export const seedProducts = defer('seedProducts');
export const uploadProductImage = defer('uploadProductImage');
export const uploadBannerImage = defer('uploadBannerImage');
export const uploadPageImage = defer('uploadPageImage');
