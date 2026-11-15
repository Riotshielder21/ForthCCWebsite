import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUBLIC_ROUTES, PRIVATE_ROUTES } from './routes.js';
import { pageMetadata, SITE_URL } from './pageMetadata.js';
import { pageShell, sitemapXml } from '../../scripts/sitePages.js';
import publicSiteBuild, { publicPageNames } from '../../scripts/publicSiteBuild.js';

test('public pages have unique titles, descriptions and canonical URLs; private and missing pages are noindex', () => {
  const descriptions = new Set();
  for (const [page, { path, title }] of Object.entries(PUBLIC_ROUTES)) {
    const metadata = pageMetadata(page);
    assert.equal(metadata.title, `${title} | Forth Canoe Club SCIO`);
    assert.equal(metadata.canonical, `${SITE_URL}${path}`);
    assert.equal(metadata.robots, 'index, follow');
    assert.ok(metadata.description.length > 50);
    descriptions.add(metadata.description);
  }
  assert.equal(descriptions.size, Object.keys(PUBLIC_ROUTES).length);
  for (const page of [...Object.keys(PRIVATE_ROUTES), 'order-lookup', 'not-found']) {
    assert.equal(pageMetadata(page).robots, 'noindex, nofollow');
    assert.equal(pageMetadata(page).canonical, null);
  }
});

test('sitemap contains exactly public routes and robots references it', () => {
  assert.equal(readFileSync('public/sitemap.xml', 'utf8'), sitemapXml());
  const urls = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, Object.values(PUBLIC_ROUTES).map(({ path }) => SITE_URL + path));
  assert.ok(readFileSync('public/robots.txt', 'utf8').includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
});

test('HTML metadata is replaced without removing final asset URLs, and 404 has no canonical URL', () => {
  const source = '<html><head><title>Old</title><meta name="description" content="Old"><link rel="canonical" href="old"><script type="module" src="/assets/entry-hash.js"></script></head><body><div id="root"></div></body></html>';
  const membership = pageShell(source, 'membership');
  assert.equal((membership.match(/<title>/g) || []).length, 1);
  assert.equal((membership.match(/name="description"/g) || []).length, 1);
  assert.ok(membership.includes('property="og:title"'));
  assert.ok(membership.includes(`${SITE_URL}/membership`));
  assert.ok(membership.includes('/assets/entry-hash.js'));
  const missing = pageShell(membership, 'not-found');
  assert.ok(missing.includes('content="noindex, nofollow"'));
  assert.ok(!missing.includes('rel="canonical"'));
  assert.ok(!missing.includes('property="og:url"'));
});

test('production build writes every public HTML route, a real 404 shell and a current sitemap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fcc-page-shells-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<html><head><title>Club</title></head><body><div id="root"></div></body></html>');
    const chunks = Object.fromEntries(publicPageNames().map((name) => [`assets/${name}.js`, { type: 'chunk', name, fileName: `assets/${name}.js`, imports: [] }]));
    publicSiteBuild().writeBundle({ dir }, chunks);
    for (const [page, { path }] of Object.entries(PUBLIC_ROUTES)) {
      const html = readFileSync(join(dir, path === '/' ? 'index.html' : `${path.slice(1)}.html`), 'utf8');
      assert.ok(html.includes(`<title>${pageMetadata(page).title}</title>`));
      assert.ok(html.includes('property="og:description"'));
    }
    assert.ok(readFileSync(join(dir, '404.html'), 'utf8').includes('Page not found'));
    assert.equal(readFileSync(join(dir, 'sitemap.xml'), 'utf8'), sitemapXml());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
