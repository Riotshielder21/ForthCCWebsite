import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_ROUTES, PRIVATE_ROUTES, resolveRoute, relativeClubLink, pagePath, isSamePageHashLink } from './routes.js';
import { readFileSync } from 'node:fs';

test('public paths resolve directly and legacy links canonicalise without losing parameters or hashes', () => {
  for (const [page, { path }] of Object.entries(PUBLIC_ROUTES)) {
    assert.equal(resolveRoute(path).page, page);
    assert.equal(pagePath(page), path);
  }
  assert.deepEqual(resolveRoute('/?page=contact&other=keep#support'), { page: 'contact-us', url: '/contact-us?other=keep#support', preview: false });
  assert.equal(resolveRoute('/home').url, '/');
  assert.equal(resolveRoute('/activites/').url, '/disciplines');
  assert.equal(resolveRoute('/club-night').page, 'club-night');
  assert.equal(resolveRoute('/membership/').url, '/membership');
  assert.equal(resolveRoute('/order/secret?token=keep').page, 'order-lookup');
  assert.equal(resolveRoute('/_preview/contact').page, 'contact-us');
  assert.equal(resolveRoute('/_preview/contact').preview, true);
  for (const path of ['/unknown', '/faq', '/history', '/?page=unknown']) assert.equal(resolveRoute(path).page, 'not-found');
});

test('hosting serves canonical paths and revalidates pages and the worker separately from immutable hashed assets', () => {
  const { hosting } = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'));
  for (const rule of hosting.headers) {
    assert.equal(typeof (rule.source ?? rule.regex), 'string');
    for (const header of rule.headers) {
      assert.equal(typeof header.key, 'string');
      assert.equal(typeof header.value, 'string');
    }
  }
  assert.equal(hosting.headers.find((rule) => rule.source === '/sw.js').headers[0].value, 'no-cache');
  assert.ok(hosting.headers.find((rule) => rule.source === '/assets/**').headers.some((header) => header.value.includes('immutable')));
  // Page HTML names hashed assets that the next release deletes, so browsers must revalidate every page path.
  const pageRule = hosting.headers.findIndex((rule) => rule.regex && rule.headers.some(({ key, value }) => key === 'Cache-Control' && value === 'no-cache'));
  const pageHtml = new RegExp(hosting.headers[pageRule]?.regex);
  for (const path of [...Object.values(PUBLIC_ROUTES).map((route) => route.path), ...Object.values(PRIVATE_ROUTES), '/_preview/home', '/unknown']) {
    assert.match(path, pageHtml);
  }
  for (const path of ['/assets/index-abc123.js', '/sw.js', '/content/pages/home.json']) assert.doesNotMatch(path, pageHtml);
  assert.equal(hosting.headers.find((rule) => rule.source === '404.html').headers[0].value, 'no-cache');
  for (const source of ['/order/**', '/payment-success', '/payment-issue', '/subscription']) {
    const headers = Object.fromEntries(hosting.headers.find((rule) => rule.source === source).headers.map(({ key, value }) => [key, value]));
    assert.equal(headers['Cache-Control'], 'no-store', source);
    assert.equal(headers['Referrer-Policy'], 'no-referrer', source);
    assert.ok(hosting.headers.findIndex((rule) => rule.source === source) > pageRule, `${source} must follow the page rule so no-store wins`);
  }
  for (const redirect of hosting.redirects) assert.equal(resolveRoute(redirect.source).url, redirect.destination);
  assert.ok(!hosting.rewrites.some((rule) => rule.source === '**'), 'unknown paths must reach Hosting’s 404 handler');
  const privateRewrite = hosting.rewrites.find((rule) => rule.source.endsWith('{,/**}'));
  assert.equal(privateRewrite?.destination, '/index.html');
  const configuredRoots = privateRewrite.source.match(/^\/\{([^}]+)\}\{,\/\*\*\}$/)[1].split(',').sort();
  const privateRoots = [...new Set(Object.values(PRIVATE_ROUTES).map((path) => path.split('/')[1]))].sort();
  assert.deepEqual(configuredRoots, privateRoots, 'every private route must retain a direct-load rewrite');
  assert.ok(hosting.rewrites.some((rule) => rule.source === '/order/**'));
  assert.ok(hosting.rewrites.some((rule) => rule.source === '/_preview/**'));
});

test('club links stay on the serving domain, while external services remain external', () => {
  assert.equal(relativeClubLink('https://www.forthcanoeclub.co.uk/activites#polo'), '/disciplines#polo');
  assert.equal(relativeClubLink('https://new.forthcanoeclub.co.uk/?page=membership'), '/membership');
  assert.equal(relativeClubLink('/?page=beginners'), '/beginners');
  assert.equal(relativeClubLink('https://trello.com/b/board'), 'https://trello.com/b/board');
  assert.equal(relativeClubLink('mailto:hello@forthcanoeclub.co.uk'), 'mailto:hello@forthcanoeclub.co.uk');
  assert.equal(relativeClubLink('#timeline'), '#timeline');
  assert.equal(relativeClubLink('?filter=all'), '?filter=all');
});

test('same-page hash links remain native so tabs and in-page navigation can react', () => {
  assert.equal(isSamePageHashLink('/notices', '/notices#privacy-notice'), true);
  assert.equal(isSamePageHashLink('/notices#terms', '/notices#privacy-notice'), true);
  assert.equal(isSamePageHashLink('/notices', '/membership#pricing'), false);
  assert.equal(isSamePageHashLink('/notices?view=all', '/notices#privacy-notice'), false);
  assert.equal(isSamePageHashLink('/notices', '/notices'), false);
});
