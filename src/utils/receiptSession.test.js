import test from 'node:test';
import assert from 'node:assert/strict';
import { RECEIPT_KEY, RECEIPT_SESSION_MS, takeReceiptParams } from './receiptSession.js';

const browserWith = (stored = null, search = '') => {
  const data = new Map(stored ? [[RECEIPT_KEY, JSON.stringify(stored)]] : []);
  const browser = {
    location: { search, pathname: '/payment-success' },
    history: { state: null, replaceState: (_state, _title, path) => {
      assert.equal(path, '/payment-success');
      browser.location.search = '';
    } },
    sessionStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key)
    }
  };
  return browser;
};

test('checkout credentials are stored for exactly one hour and removed from the URL', () => {
  const browser = browserWith(null, '?session_id=cs_new&receipt_token=new');
  const params = takeReceiptParams(browser, 1000);
  assert.deepEqual(params, { sessionId: 'cs_new', receiptToken: 'new', expiresAt: 1000 + RECEIPT_SESSION_MS });
  assert.deepEqual(JSON.parse(browser.sessionStorage.getItem(RECEIPT_KEY)), params);
  assert.equal(browser.location.search, '');
});

test('refresh does not extend the saved receipt lifetime; expiry is inclusive', () => {
  const browser = browserWith(null, '?session_id=cs_new&receipt_token=new');
  const params = takeReceiptParams(browser, 1000);
  assert.deepEqual(takeReceiptParams(browser, params.expiresAt - 1), params);
  assert.deepEqual(takeReceiptParams(browser, params.expiresAt), { sessionId: '', receiptToken: '', expired: true });
  assert.equal(browser.sessionStorage.getItem(RECEIPT_KEY), null);
});

test('old browser tokens without an expiry and tokens saved days ago are discarded', () => {
  for (const extra of [{}, { expiresAt: 1000 }]) {
    const browser = browserWith({ sessionId: 'cs_old', receiptToken: 'old', ...extra });
    assert.equal(takeReceiptParams(browser, 3 * 24 * RECEIPT_SESSION_MS).receiptToken, '');
    assert.equal(browser.sessionStorage.getItem(RECEIPT_KEY), null);
  }
});

test('a new checkout never inherits credentials from a different stored checkout', () => {
  const stored = { sessionId: 'cs_old', receiptToken: 'old', expiresAt: RECEIPT_SESSION_MS };
  const browser = browserWith(stored, '?session_id=cs_new');
  assert.equal(takeReceiptParams(browser, 1000).receiptToken, '');
  assert.equal(browser.sessionStorage.getItem(RECEIPT_KEY), null);
  assert.equal(browser.location.search, '');
});

test('opening the page without saved credentials returns no receipt access', () => {
  assert.deepEqual(takeReceiptParams(browserWith(), 1000), { sessionId: '', receiptToken: '', expired: false });
});
