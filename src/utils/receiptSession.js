export const RECEIPT_KEY = 'fcc-payment-receipt';
export const RECEIPT_SESSION_MS = 60 * 60 * 1000;

// Keep checkout credentials out of browser history and never renew them on a refresh.
export const takeReceiptParams = (browser = window, now = Date.now()) => {
  const query = new URLSearchParams(browser.location.search);
  const fromQuery = query.has('receipt_token') || query.has('session_id');
  let stored = null;
  try {
    stored = JSON.parse(browser.sessionStorage.getItem(RECEIPT_KEY) || 'null');
  } catch (error) {
    console.warn('Could not read the saved receipt session:', error);
  }
  const params = fromQuery ? {
    sessionId: query.get('session_id') || '',
    receiptToken: query.get('receipt_token') || '',
    expiresAt: now + RECEIPT_SESSION_MS
  } : stored;
  const valid = params && typeof params.sessionId === 'string' && params.sessionId
    && typeof params.receiptToken === 'string' && params.receiptToken
    && Number.isFinite(params.expiresAt) && params.expiresAt > now
    && params.expiresAt <= now + RECEIPT_SESSION_MS;
  try {
    if (valid && fromQuery) browser.sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(params));
    else if (!valid) browser.sessionStorage.removeItem(RECEIPT_KEY);
  } catch (error) {
    console.warn('Could not update the saved receipt session:', error);
  }
  if (fromQuery) browser.history.replaceState(browser.history.state, '', browser.location.pathname);
  return valid ? params : { sessionId: '', receiptToken: '', expired: Boolean(params) };
};
