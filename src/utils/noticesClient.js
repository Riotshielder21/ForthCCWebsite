import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { apiFetch, apiUrl } from './api';
import { publishedNotices } from './notices';

/** Every notice, archived ones included, kept up to date as admins publish. */
export const subscribeToNotices = (onNotices, onError) => {
  if (!db) {
    onError?.(new Error('Notices are unavailable.'));
    return () => {};
  }
  return onSnapshot(collection(db, 'notices'), (snapshot) => {
    // An empty answer from the offline cache is not proof that nothing is published.
    if (snapshot.metadata.fromCache && snapshot.empty) return;
    onNotices(snapshot.docs.map((document) => ({ ...document.data(), id: document.id })));
  }, onError);
};

/** The published notices, `null` until they have loaded and `error` if they could not be. */
export const watchPublishedNotices = (onChange) => subscribeToNotices(
  (notices) => onChange({ notices: publishedNotices(notices), all: notices, error: '' }),
  (error) => onChange({ notices: null, all: [], error: error.message || 'Notices could not be loaded.' })
);

export const loadNoticeMode = async () => {
  const response = await apiFetch(apiUrl('/api/notices/mode'), { cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.live !== 'boolean') throw new Error(result.error || 'Could not check notice publishing mode.');
  return result.live;
};

export const noticePdfUrl = (id, version) => apiUrl(`/api/notices/${encodeURIComponent(id)}/pdf${version ? `?version=${version}` : ''}`);

const adminRequest = async (adminUser, path, options = {}) => {
  const token = await adminUser.getIdToken();
  const response = await apiFetch(apiUrl(path), {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The notice could not be saved.');
  return result;
};

export const publishNotice = (adminUser, id, { title, body }) => adminRequest(adminUser, `/api/admin/notices/${encodeURIComponent(id)}`, {
  method: 'PUT', body: JSON.stringify({ title, body })
});

export const reorderNotices = (adminUser, ids) => adminRequest(adminUser, '/api/admin/notices-order', { method: 'PUT', body: JSON.stringify({ ids }) });

export const loadNoticeVersions = async (adminUser, id) => (await adminRequest(adminUser, `/api/admin/notices/${encodeURIComponent(id)}/versions`)).versions;
