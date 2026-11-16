import { browserAppCheckToken } from './appCheck.js';
import { createVerifiedFetch } from './verifiedFetch.js';
import { reportClientError } from './reportClientError.js';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const apiUrl = (path) => `${apiBaseUrl}${path}`;
const verifiedFetch = createVerifiedFetch(browserAppCheckToken);
export const apiFetch = async (...args) => {
  try {
    const response = await verifiedFetch(...args);
    if (response.status >= 500) void reportClientError('api-server');
    return response;
  } catch (error) {
    if (error?.name !== 'AbortError') void reportClientError('api-network');
    throw error;
  }
};
