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

const defer = (name) => (...args) => import('./contentFirebase.js').then((module) => module[name](...args));
export const saveProduct = defer('saveProduct');
export const removeProduct = defer('removeProduct');
export const seedProducts = defer('seedProducts');
export const uploadProductImage = defer('uploadProductImage');
export const uploadBannerImage = defer('uploadBannerImage');
export const uploadPageImage = defer('uploadPageImage');
