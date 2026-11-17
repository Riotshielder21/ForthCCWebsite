import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('consent refresh retains offline wording, reports partial saves and ignores superseded requests', async (t) => {
  const vite = await createServer({
    configFile: false,
    envFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }
  });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  });
  t.mock.method(console, 'error', () => {});

  try {
    const client = await vite.ssrLoadModule('/src/browser/consentWording.js');
    const store = await vite.ssrLoadModule('/src/utils/consentWordingStore.js');
    const wording = {
      disclaimer: { label: 'I agree', body: 'Current participation text.' },
      photoVideo: { label: 'Photos are allowed', body: 'Current photo text.' }
    };
    const response = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
    const fetch = t.mock.method(globalThis, 'fetch', async () => response(wording));

    assert.deepEqual(await client.refreshConsentWording(), { ok: true });
    assert.equal(store.getConsentWording().disclaimer.body, wording.disclaimer.body);

    for (const request of [
      async () => { throw new Error('Offline'); },
      async () => response({}, 503),
      async () => response({ disclaimer: {} })
    ]) {
      fetch.mock.mockImplementation(request);
      const failed = await client.refreshConsentWording();
      assert.equal(failed.ok, false);
      assert.match(failed.error, /may be out of date/);
      assert.equal(store.getConsentWording().disclaimer.body, wording.disclaimer.body);
    }

    let writes = 0;
    fetch.mock.mockImplementation(async (_url, options) => {
      if (options.method === 'PUT') {
        writes += 1;
        return response({ changed: true, live: true, version: 2 });
      }
      return response({}, 503);
    });
    await assert.rejects(client.saveConsentWording({ getIdToken: async () => 'test-token' }, 'disclaimer', wording.disclaimer),
      /was saved, but.*could not be refreshed/);
    assert.equal(writes, 1, 'a failed refresh must not repeat the successful publication');

    const pending = [];
    fetch.mock.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const older = client.refreshConsentWording();
    const newer = client.refreshConsentWording();
    while (pending.length < 2) await new Promise((resolve) => setImmediate(resolve));
    const updated = { ...wording, disclaimer: { ...wording.disclaimer, body: 'Newest text.' } };
    pending[1](response(updated));
    assert.deepEqual(await newer, { ok: true });
    pending[0](response(wording));
    assert.deepEqual(await older, { ok: false, superseded: true });
    assert.equal(store.getConsentWording().disclaimer.body, 'Newest text.');
  } finally {
    await vite.close();
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
