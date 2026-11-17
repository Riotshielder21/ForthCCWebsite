import { useSyncExternalStore } from 'react';
import { apiFetch, apiUrl } from '../utils/api.js';
import {
  CONSENT_KEYS,
  CONSENT_LIMITS,
  getConsentWording,
  setConsentWording,
  subscribeConsentWording
} from '../utils/consentWordingStore.js';

const CACHE_KEY = 'fcc-consent-wording';
const refreshListeners = new Set();
let refreshState = { refreshing: false, error: '' };
let revision = 0;

const subscribeRefresh = (listener) => {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
};
const getRefreshState = () => refreshState;
const updateRefreshState = (next) => {
  refreshState = next;
  refreshListeners.forEach((listener) => listener());
};

export const useConsentWording = () => useSyncExternalStore(subscribeConsentWording, getConsentWording);
export const useConsentWordingRefresh = () => useSyncExternalStore(subscribeRefresh, getRefreshState);

export const loadCachedConsentWording = () => {
  try {
    setConsentWording(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
  } catch (error) {
    console.warn('Saved consent wording could not be restored:', error);
  }
};

/** A failed refresh retains the last wording and reports that it could not be checked. */
export const refreshConsentWording = async () => {
  const request = ++revision;
  updateRefreshState({ refreshing: true, error: '' });

  try {
    const response = await apiFetch(apiUrl('/api/consent-wording'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not refresh consent wording (${response.status}).`);

    const wording = await response.json();
    const valid = CONSENT_KEYS.every((key) => (
      typeof wording?.[key]?.label === 'string' && wording[key].label.trim()
      && wording[key].label.length <= CONSENT_LIMITS.label
      && typeof wording[key].body === 'string' && wording[key].body.trim()
      && wording[key].body.length <= CONSENT_LIMITS.body
    ));
    if (!valid) throw new Error('Invalid consent wording response.');
    if (request !== revision) return { ok: false, superseded: true };

    setConsentWording(wording);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(wording));
    } catch (error) {
      console.warn('Consent wording could not be saved for offline use:', error);
    }

    updateRefreshState({ refreshing: false, error: '' });
    return { ok: true };
  } catch (error) {
    if (request !== revision) return { ok: false, superseded: true };
    console.error('Consent wording refresh failed:', error);
    const message = 'Consent wording could not be checked. The displayed wording may be out of date.';
    updateRefreshState({ refreshing: false, error: message });
    return { ok: false, error: message };
  }
};

export const saveConsentWording = async (adminUser, key, { label, body }) => {
  const token = await adminUser.getIdToken();
  const response = await apiFetch(apiUrl(`/api/admin/consent-wording/${encodeURIComponent(key)}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ label, body }),
    cache: 'no-store'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The wording could not be saved.');

  const refresh = await refreshConsentWording();
  if (!refresh.ok) {
    throw new Error('The wording was saved, but the displayed copy could not be refreshed. Use "Retry consent wording" before publishing again.');
  }

  return result;
};
