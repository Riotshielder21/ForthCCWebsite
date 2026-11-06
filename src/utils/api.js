import { browserAppCheckToken } from './appCheck.js';
import { createVerifiedFetch } from './verifiedFetch.js';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const apiUrl = (path) => `${apiBaseUrl}${path}`;
export const apiFetch = createVerifiedFetch(browserAppCheckToken);
