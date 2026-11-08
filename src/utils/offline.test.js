import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';

const source = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

function worker(overrides = {}) {
  const handlers = {};
  const stores = new Map();
  const fetched = [];
  const manifest = { version: 'test', files: ['/index.html', '/assets/public.js', '/content/pages/home.json'], images: ['/images/home.webp'], paths: ['/', '/membership'], digests: {}, ...overrides };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        put: async (key, response) => data.set(key, response),
        match: async (key) => data.get(key),
        keys: async () => [...data.keys()].map((url) => ({ url }))
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name)
  };
  let online = true;
  let deployed = 'public-file';
  const self = { location: { origin: 'https://club.test' }, addEventListener: (type, handler) => { handlers[type] = handler; }, clients: { claim: async () => {} } };
  vm.runInNewContext(source.replace('__PUBLIC_SITE_MANIFEST__', JSON.stringify(manifest)), {
    self, caches, URL, crypto: webcrypto, Uint8Array, console: { error() {} },
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      fetched.push(url);
      if (!online) throw new Error('Offline');
      return new Response(url.endsWith('.json') ? '{}' : deployed, { headers: { 'content-type': url.endsWith('.json') ? 'application/json' : 'text/plain' } });
    }
  });
  const dispatch = async (type, props = {}) => {
    let result;
    let work;
    handlers[type]({ ...props, waitUntil: (promise) => { work = promise; }, respondWith: (promise) => { result = promise; } });
    await work;
    return result;
  };
  return { dispatch, stores, fetched, offline: () => { online = false; }, deploy: (body) => { deployed = body; } };
}
const request = (path, mode = 'navigate', authorization = false) => ({
  method: 'GET', url: `https://club.test${path}`, mode,
  headers: { has: () => authorization }
});
const sameOriginSource = { url: 'https://club.test/membership' };

test('public pages and lazy modules survive offline navigation and refresh, but private requests are never intercepted', async () => {
  const site = worker();
  await site.dispatch('install');
  await site.dispatch('activate');
  site.offline();
  assert.equal(await (await site.dispatch('fetch', { request: request('/membership') })).text(), 'public-file');
  assert.equal(await (await site.dispatch('fetch', { request: request('/assets/public.js', 'cors') })).text(), 'public-file');
  for (const path of ['/admin', '/api/volunteering', '/my-details', '/order/secret', '/payment-success', '/checkout', '/?renew=secret', '/membership?token=secret']) {
    assert.equal(await site.dispatch('fetch', { request: request(path) }), undefined);
  }
  assert.equal(await site.dispatch('fetch', { request: request('/assets/public.js', 'cors', true) }), undefined);
  assert.deepEqual(site.fetched, ['https://club.test/index.html', 'https://club.test/assets/public.js', 'https://club.test/content/pages/home.json', 'https://club.test/images/home.webp']);
});

test('an evicted page still loads from the network after a newer deployment changes it', async () => {
  const digest = createHash('sha256').update('public-file').digest('hex');
  const site = worker({ digests: { '/index.html': digest } });
  await site.dispatch('install');
  await site.dispatch('activate');
  site.stores.get('fcc-public-test').delete('https://club.test/index.html');
  site.deploy('new-deployment');
  assert.equal(await (await site.dispatch('fetch', { request: request('/') })).text(), 'new-deployment');
  assert.equal(site.stores.get('fcc-public-test').has('https://club.test/index.html'), false);
});

test('readiness checks actual cache entries, not just worker activation', async () => {
  const site = worker();
  await site.dispatch('install');
  let status;
  const query = () => site.dispatch('message', { source: sameOriginSource, data: { type: 'PUBLIC_CACHE_STATUS' }, ports: [{ postMessage: (value) => { status = value; } }] });
  await query();
  assert.equal(status.ready, true);
  site.stores.get('fcc-public-test').delete('https://club.test/images/home.webp');
  await query();
  assert.equal(status.ready, false);
  await site.dispatch('message', { source: sameOriginSource, data: { type: 'PUBLIC_CACHE_REPAIR' }, ports: [{ postMessage: (value) => { status = value; } }] });
  assert.equal(status.ready, true);
});

test('messages from other origins or without a valid client URL are ignored', async () => {
  const site = worker();
  await site.dispatch('install');
  const imageUrl = 'https://club.test/images/home.webp';
  site.stores.get('fcc-public-test').delete(imageUrl);
  const fetchedCount = site.fetched.length;
  let replies = 0;
  const sources = [
    { url: 'https://attacker.test/page' },
    { url: 'https://club.test.attacker.test/page' },
    { url: 'not a valid URL' },
    null
  ];
  for (const source of sources) {
    await site.dispatch('message', {
      ...(source ? { source } : {}),
      data: { type: 'PUBLIC_CACHE_REPAIR' },
      ports: [{ postMessage: () => { replies += 1; } }]
    });
  }
  await site.dispatch('message', {
    data: { type: 'PUBLIC_CACHE_REPAIR' },
    ports: [{ postMessage: () => { replies += 1; } }]
  });
  assert.equal(site.fetched.length, fetchedCount);
  assert.equal(site.stores.get('fcc-public-test').has(imageUrl), false);
  assert.equal(replies, 0);
});

test('an interrupted install or changed deployment is not advertised as an offline-ready site', async () => {
  const site = worker();
  site.offline();
  await assert.rejects(site.dispatch('install'), /Offline/);
  assert.equal(site.stores.size, 0);
  const mixed = worker({ digests: { '/index.html': createHash('sha256').update('different-build').digest('hex') } });
  await assert.rejects(mixed.dispatch('install'), /changed during download/);
  assert.equal(mixed.stores.size, 0);
  const privateImage = worker({ images: ['/api/private-image?token=secret'] });
  await assert.rejects(privateImage.dispatch('install'), /Private routes cannot be saved/);
  assert.equal(privateImage.stores.size, 0);
});
