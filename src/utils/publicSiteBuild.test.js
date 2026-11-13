import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import publicSiteBuild, { DEV_WORKER_REMOVER, publicPageNames } from '../../scripts/publicSiteBuild.js';
import vm from 'node:vm';

test('the dev server replaces a leftover production worker with one that clears the offline copy and removes itself', async () => {
  let served;
  publicSiteBuild().configureServer({ middlewares: { use: (path, handler) => {
    assert.equal(path, '/sw.js');
    const headers = {};
    handler({}, { setHeader: (key, value) => { headers[key] = value; }, end: (body) => { served = { headers, body }; } });
  } } });
  assert.equal(served.body, DEV_WORKER_REMOVER);
  assert.equal(served.headers['Cache-Control'], 'no-store');
  const handlers = {};
  const deleted = [];
  const navigated = [];
  let skipped = false;
  let unregistered = false;
  let work;
  vm.runInNewContext(DEV_WORKER_REMOVER, {
    caches: { keys: async () => ['fcc-public-old', 'other'], delete: async (name) => deleted.push(name) },
    self: { addEventListener: (type, handler) => { handlers[type] = handler; }, skipWaiting: () => { skipped = true; },
      registration: { unregister: async () => { unregistered = true; } },
      clients: { matchAll: async () => [{ url: 'http://localhost:3000/disciplines', navigate: (url) => navigated.push(url) }] } }
  });
  handlers.install();
  handlers.activate({ waitUntil: (promise) => { work = promise; } });
  await work;
  assert.equal(skipped, true);
  assert.equal(unregistered, true);
  assert.deepEqual(deleted, ['fcc-public-old']);
  assert.deepEqual(navigated, ['http://localhost:3000/disciplines']);
});
import { PUBLIC_ROUTES } from './routes.js';

const pageChunks = () => Object.fromEntries(publicPageNames().map((name) => [`assets/${name}.js`, { type: 'chunk', name, fileName: `assets/${name}.js`, imports: [] }]));

test('every public route, including notices and safeguarding, has its page code saved for offline use', () => {
  const names = publicPageNames();
  assert.equal(names.length, Object.keys(PUBLIC_ROUTES).length);
  assert.ok(names.includes('NoticesPage') && names.includes('SafeguardingPage'));
  assert.throws(() => publicPageNames("export const pageModules = { home: () => import('./HomePage') };"), /has no entry/);
  const dir = mkdtempSync(join(tmpdir(), 'fcc-offline-build-'));
  try {
    const chunks = pageChunks();
    delete chunks['assets/NoticesPage.js'];
    assert.throws(() => publicSiteBuild().writeBundle({ dir }, chunks), /NoticesPage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('offline digests use final written assets, not code before Vite resolves preload references', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fcc-offline-build-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), 'final shell');
    writeFileSync(join(dir, 'assets/entry.js'), 'final resolved preload references');
    publicSiteBuild().writeBundle({ dir }, {
      ...pageChunks(),
      'assets/entry.js': { type: 'chunk', isEntry: true, name: 'index', fileName: 'assets/entry.js', imports: [], code: 'unfinished preload references' }
    });
    const source = readFileSync(join(dir, 'sw.js'), 'utf8');
    const manifest = JSON.parse(source.match(/const manifest = (.*);/)[1]);
    assert.equal(manifest.digests['/assets/entry.js'], createHash('sha256').update('final resolved preload references').digest('hex'));
    assert.ok(manifest.digests['/index.html']);
    assert.ok(manifest.files.includes('/content/pages/home.json'));
    assert.ok(!manifest.files.some((path) => path.includes('/admin')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
