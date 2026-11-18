import { test, expect } from '@playwright/test';

test('reports reuse fresh tokens and require a successful refresh once expired', async ({ page }) => {
  await page.clock.install();
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: 'demo-fcc-browser',
    iss: 'https://securetoken.google.com/demo-fcc-browser',
    sub: 'browser-test-admin',
    user_id: 'browser-test-admin',
    email: 'browser-test@forthcanoeclub.co.uk',
    email_verified: true,
    admin: true,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: 'google.com', identities: {} }
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.synthetic-signature`;
  let currentToken = token;
  let refreshBlocked = true;
  let tokenRefreshes = 0;
  let reportRequests = 0;

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'securetoken.googleapis.com') {
      tokenRefreshes += 1;
      return refreshBlocked ? route.abort() : route.fulfill({ json: {
        access_token: currentToken,
        expires_in: '3600',
        refresh_token: 'synthetic-refresh-token',
        token_type: 'Bearer',
        user_id: claims.sub,
        project_id: 'demo-fcc-browser'
      } });
    }
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('/accounts:lookup')) {
      return route.fulfill({ json: { users: [{
        localId: claims.sub,
        email: claims.email,
        emailVerified: true,
        providerUserInfo: [{ providerId: 'google.com', rawId: claims.sub, email: claims.email }]
      }] } });
    }
    return url.origin === 'http://127.0.0.1:4175' ? route.fallback() : route.abort();
  });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/reports') {
      reportRequests += 1;
      expect(route.request().headers().authorization).toBe(`Bearer ${currentToken}`);
      return route.fulfill({ json: { records: [], nextCursor: null } });
    }
    return route.fulfill({ json: { products: [], availability: {}, items: [], pages: {}, tiers: [], rules: [] } });
  });
  await page.route('**/content/pages/*.json', (route) => route.fulfill({ json: {} }));

  await page.goto('/');
  await page.evaluate(async ({ claims, token }) => {
    const database = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open('firebaseLocalStorageDb', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('firebaseLocalStorage', 'readwrite');
        transaction.objectStore('firebaseLocalStorage').put({
          fbase_key: 'firebase:authUser:browser-tests:[DEFAULT]',
          value: {
            uid: claims.sub,
            email: claims.email,
            emailVerified: true,
            isAnonymous: false,
            providerData: [{ providerId: 'google.com', uid: claims.sub, email: claims.email }],
            stsTokenManager: { refreshToken: 'synthetic-refresh-token', accessToken: token, expirationTime: claims.exp * 1000 },
            createdAt: String(claims.iat * 1000),
            lastLoginAt: String(claims.iat * 1000),
            apiKey: 'browser-tests',
            appName: '[DEFAULT]'
          }
        });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, { claims, token });

  await page.goto('/admin/reports');
  await expect.poll(() => reportRequests).toBe(1);
  await expect(page.getByText('No matching records.', { exact: true })).toBeVisible();
  expect(reportRequests).toBe(1);
  expect(tokenRefreshes).toBe(0);

  const refresh = page.getByRole('button', { name: 'Refresh report', exact: true });
  await refresh.click();
  await expect(refresh).toBeEnabled();
  expect(reportRequests).toBe(2);
  expect(tokenRefreshes).toBe(0);

  await page.clock.setFixedTime(new Date((now + 7200) * 1000));
  await refresh.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Firebase could not refresh your session.' })).toBeVisible();
  expect(tokenRefreshes).toBeGreaterThan(0);
  expect(reportRequests).toBe(2);

  refreshBlocked = false;
  currentToken = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ ...claims, iat: now + 7200, exp: now + 10800 })}.synthetic-signature`;
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Firebase could not refresh your session.' })).toHaveCount(0);
  expect(reportRequests).toBe(3);
});
