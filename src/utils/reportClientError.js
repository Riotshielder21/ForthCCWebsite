import { createClientErrorReporter } from './clientErrors.js';

const apiBase = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
const report = createClientErrorReporter({
  send: async (body) => {
    const response = await fetch(`${apiBase}/api/client-errors`, {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000), keepalive: true
    });
    if (!response.ok) throw new Error('Browser error reporting unavailable.');
    const result = await response.json();
    if (result.accepted !== true) throw new Error('Browser error report was not accepted.');
  }
});
export const reportClientError = (kind) => typeof window === 'undefined' ? Promise.resolve() : report(kind);
