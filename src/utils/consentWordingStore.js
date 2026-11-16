import { DISCLAIMER, PHOTO_CONSENT } from '../constants/consentWording.js';

/**
 * The wording ticked for each person. The code holds the defaults; an admin's published edits (stored in
 * `settings/consentWording`) replace the `label` and `body` of each. The browser keeps the current wording here so
 * checkout, check-in and My details all show, and fingerprint, the same text.
 */
export const CONSENT_KEYS = ['disclaimer', 'photoVideo'];
export const DEFAULT_CONSENT_WORDING = { disclaimer: DISCLAIMER, photoVideo: PHOTO_CONSENT };
export const CONSENT_LIMITS = { label: 1000, body: 60000 };

const usable = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;

/** Stored wording laid over the defaults; anything missing or malformed keeps its default. */
export const mergeConsentWording = (stored) => Object.fromEntries(CONSENT_KEYS.map((key) => {
  const base = DEFAULT_CONSENT_WORDING[key];
  const saved = stored?.[key];
  return [key, {
    ...base,
    label: usable(saved?.label, CONSENT_LIMITS.label) ? saved.label : base.label,
    body: usable(saved?.body, CONSENT_LIMITS.body) ? saved.body : base.body
  }];
}));

let current = DEFAULT_CONSENT_WORDING;
const listeners = new Set();

export const getConsentWording = () => current;
export const subscribeConsentWording = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

/** Replaces the wording shown; listeners only hear of real changes. */
export const setConsentWording = (stored) => {
  const next = mergeConsentWording(stored);
  if (CONSENT_KEYS.every((key) => next[key].label === current[key].label && next[key].body === current[key].body)) return;
  current = next;
  listeners.forEach((listener) => listener());
};
