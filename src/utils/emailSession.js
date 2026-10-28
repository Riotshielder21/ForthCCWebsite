import { apiUrl } from './api.js';

const key = (purpose) => `fcc-email-session-${purpose}`;

/** A verified email-code session, kept only for this browser tab. */
export const loadEmailSession = (purpose, storage = globalThis.sessionStorage) => {
  try {
    const session = JSON.parse(storage?.getItem(key(purpose)) || 'null');
    return session?.token && session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
};

export const saveEmailSession = (purpose, session, storage = globalThis.sessionStorage) => storage?.setItem(key(purpose), JSON.stringify(session));

export const clearEmailSession = (purpose, storage = globalThis.sessionStorage) => {
  const session = loadEmailSession(purpose, storage);
  storage?.removeItem(key(purpose));
  if (session) fetch(apiUrl('/api/email-codes/session'), { method: 'DELETE', headers: { 'X-Email-Session': session.token } }).catch(() => {});
};

/** Calls the API with the session; an ended session is cleared so the sign-in form shows again. */
export const sessionRequest = async (purpose, path, { method = 'GET', body } = {}) => {
  const session = loadEmailSession(purpose);
  const response = await fetch(apiUrl(path), {
    method, cache: 'no-store',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { 'X-Email-Session': session.token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && result.sessionExpired) globalThis.sessionStorage?.removeItem(key(purpose));
  if (!response.ok) {
    const error = new Error(result.error || 'Something went wrong. Please try again.');
    Object.assign(error, { status: response.status, ...result });
    throw error;
  }
  return result;
};
