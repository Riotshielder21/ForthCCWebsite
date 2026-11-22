import { test, expect } from '@playwright/test';
import { PRODUCTS } from '../../src/constants/products.js';
import { DEFAULT_CONSENT_WORDING } from '../../src/utils/consentWordingStore.js';

const publishedWording = Object.fromEntries(Object.entries(DEFAULT_CONSENT_WORDING).map(([key, statement]) => [
  key,
  { label: statement.label, body: statement.body }
]));

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === 'http://127.0.0.1:4175' ? route.fallback() : route.abort();
  });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses = {
      '/api/availability': { products: PRODUCTS, availability: {} },
      '/api/consent-wording': publishedWording,
      '/api/client-errors': { accepted: true },
      '/api/notices/mode': { live: true },
      '/api/membership-names': { names: [], exists: false }
    };
    return route.fulfill({ json: responses[path] || { tiers: [], rules: [] } });
  });
  await page.route('**/content/pages/*.json', (route) => route.fulfill({ json: {} }));
});

test('returning to a page loads published edits without a full reload', async ({ page }) => {
  let title = 'Original published heading';
  let requests = 0;
  await page.route('**/content/pages/home.json', (route) => {
    requests += 1;
    return route.fulfill({ json: { welcomeTitle: title } });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.evaluate(() => { window.navigationTestMarker = 'same-document'; });
  await page.locator('a[href="/membership"]').first().click();
  await expect(page).toHaveURL(/\/membership$/);
  title = 'Updated published heading';
  await page.getByRole('link', { name: 'Go to home page', exact: true }).click();

  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(requests).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.navigationTestMarker)).toBe('same-document');
});

test('the shop offers only products loaded on this visit, and pauses buying while offline', async ({ page, context }) => {
  const saved = { ...PRODUCTS.find((product) => product.id === 'membership-adult'), name: 'Saved adult membership' };
  await page.addInitScript((products) => {
    localStorage.setItem('fcc-public-products', JSON.stringify(products));
  }, [saved]);
  let failing = true;
  await page.route('**/api/availability', (route) => route.fulfill(failing
    ? { status: 503, json: { error: 'Temporarily unavailable' } }
    : { json: { products: [{ ...saved, name: 'Live adult membership' }], availability: {} } }));

  await page.goto('/membership');
  await expect(page.getByText('Prices and availability could not be checked', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /to basket$/ })).toHaveCount(0);
  failing = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();

  const add = page.getByRole('button', { name: 'Add Live adult membership to basket', exact: true });
  await expect(add).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry availability', exact: true })).toHaveCount(0);
  await add.click();

  await context.setOffline(true);
  await expect(page.getByText('You are offline. Reconnect to see what is on sale and to buy.', { exact: true }).first()).toBeVisible();
  await expect(add).toHaveCount(0);
  await page.getByRole('button', { name: 'Open basket, 1 item', exact: true }).click();
  const checkout = page.getByRole('button', { name: 'Checkout', exact: true });
  await expect(checkout).toBeDisabled();
  await context.setOffline(false);
  await expect(checkout).toBeEnabled();
});

test('retrying changed consent wording clears ticks given to the old wording', async ({ page }) => {
  let failing = true;
  await page.route('**/api/consent-wording', (route) => route.fulfill(failing
    ? { status: 503, json: { error: 'Temporarily unavailable' } }
    : { json: { ...publishedWording, disclaimer: { label: 'I accept the updated statement', body: 'Updated participation wording.' } } }));

  await page.goto('/membership');
  const membership = PRODUCTS.find((product) => product.id === 'membership-adult');
  await page.getByRole('button', { name: `Add ${membership.name} to basket`, exact: true }).click();
  await page.getByRole('button', { name: 'Open basket, 1 item', exact: true }).click();
  await page.getByRole('button', { name: 'Checkout', exact: true }).click();
  await page.getByRole('textbox', { name: 'Receipt email', exact: true }).fill('browser-test@example.test');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const oldStatement = page.getByRole('checkbox', { name: publishedWording.disclaimer.label, exact: true });
  await oldStatement.check();
  await expect(oldStatement).toBeChecked();
  const photo = page.getByRole('checkbox', { name: publishedWording.photoVideo.label, exact: true });
  await photo.check();

  failing = false;
  await page.getByRole('button', { name: 'Retry consent wording', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'I accept the updated statement', exact: true })).not.toBeChecked();
  await expect(photo).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Retry consent wording', exact: true })).toHaveCount(0);
});
