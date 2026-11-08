const manifest = __PUBLIC_SITE_MANIFEST__;
const cacheName = `fcc-public-${manifest.version}`;
const absolute = (path) => new URL(path, self.location.origin).href;
const allowed = new Set([...manifest.files, ...manifest.images].map(absolute));
const privatePath = /^\/(?:api|admin|order|my-details|checkout|check-ins|club-night|payment-success|_preview)(?:\/|$)/;

async function download(cache, path) {
  const url = absolute(path);
  if (privatePath.test(new URL(url).pathname)) throw new Error(`Private routes cannot be saved for offline reading: ${url}`);
  const external = new URL(url).origin !== self.location.origin;
  const response = await fetch(url, {
    cache: path.startsWith('/assets/') ? 'force-cache' : 'no-cache',
    priority: 'low',
    credentials: 'omit',
    mode: external ? 'no-cors' : 'same-origin'
  });
  if (!response.ok && response.type !== 'opaque') throw new Error(`Public offline download failed: ${url} (${response.status})`);
  if (path.endsWith('.json') && !response.headers.get('content-type')?.includes('application/json')) throw new Error(`Invalid public content: ${url}`);
  if (manifest.digests[path]) {
    const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== manifest.digests[path]) throw new Error(`Public files changed during download: ${url}. Reload to retry.`);
  }
  await cache.put(url, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      for (const path of manifest.files) await download(cache, path);
      for (const path of manifest.images) await download(cache, path);
    } catch (error) {
      await caches.delete(cacheName);
      console.error('Public pages could not be saved for offline use:', error);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Updates wait for existing tabs to close before activating; do not force mixed-build tabs.
    for (const name of await caches.keys()) if (name.startsWith('fcc-public-') && name !== cacheName) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const sourceUrl = event.source?.url;
  const messageOrigin = typeof event.origin === 'string' ? event.origin : '';
  try {
    const sourceOrigin = sourceUrl ? new URL(sourceUrl).origin : '';
    const hasTrustedSourceOrigin = !!sourceOrigin && sourceOrigin === self.location.origin;
    const hasTrustedMessageOrigin = !!messageOrigin && messageOrigin === self.location.origin;
    if (!hasTrustedSourceOrigin && !hasTrustedMessageOrigin) return;
  } catch {
    return;
  }
  if (['PUBLIC_CACHE_STATUS', 'PUBLIC_CACHE_REPAIR'].includes(event.data?.type)) {
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName);
      if (event.data.type === 'PUBLIC_CACHE_REPAIR') {
        try {
          for (const path of [...manifest.files, ...manifest.images]) {
            if (!await cache.match(absolute(path))) await download(cache, path);
          }
        } catch (error) {
          console.error('Public offline storage could not be restored:', error);
          event.ports[0]?.postMessage({ ready: false, version: manifest.version });
          return;
        }
      }
      const entries = new Set((await cache.keys()).map((request) => request.url));
      event.ports[0]?.postMessage({ ready: [...allowed].every((url) => entries.has(url)), version: manifest.version });
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization')) return;
  const url = new URL(request.url);
  if (privatePath.test(url.pathname)) return;
  const publicNavigation = request.mode === 'navigate' && url.origin === self.location.origin
    && manifest.paths.includes(url.pathname) && !url.search;
  if (!publicNavigation && !allowed.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const key = publicNavigation ? absolute('/index.html') : url.href;
    const cached = await cache.match(key);
    if (cached) return cached;
    // A missing entry means storage was evicted; do not claim readiness based on this response.
    try {
      await download(cache, publicNavigation ? '/index.html' : (url.origin === self.location.origin ? url.pathname + url.search : url.href));
      const saved = await cache.match(key);
      if (saved) return saved;
    } catch (error) {
      console.error('Public offline copy unavailable, loading from the network:', error);
    }
    // A newer deployment fails this worker's checks; the site must still load normally rather than fail.
    return fetch(request);
  })());
});
