import { useSyncExternalStore } from 'react';
import { apiFetch, apiUrl } from './api';
import { getConsentWording, setConsentWording, subscribeConsentWording } from './consentWordingStore';

const CACHE_KEY = 'fcc-consent-wording';

export const useConsentWording = () => useSyncExternalStore(subscribeConsentWording, getConsentWording);

/** The last wording this browser saw, so a saved checkout and offline use match what was shown. */
export const loadCachedConsentWording = () => {
  try { setConsentWording(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')); } catch { /* defaults apply */ }
};

/** Fetches the published wording; a failure keeps what is already shown. */
export const refreshConsentWording = async () => {
  try {
    const response = await apiFetch(apiUrl('/api/consent-wording'), { cache: 'no-store' });
    if (!response.ok) return;
    const wording = await response.json();
    setConsentWording(wording);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(wording)); } catch { /* storage may be unavailable */ }
  } catch { /* offline: keep the cached wording */ }
};

export const saveConsentWording = async (adminUser, key, { label, body }) => {
  const token = await adminUser.getIdToken();
  const response = await apiFetch(apiUrl(`/api/admin/consent-wording/${encodeURIComponent(key)}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ label, body }), cache: 'no-store'
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The wording could not be saved.');
  await refreshConsentWording();
  return result;
};
