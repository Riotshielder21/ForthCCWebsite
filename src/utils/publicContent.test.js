import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublishedPageContent } from './publicContent.js';

const response = (content) => new Response(JSON.stringify(content), {
  headers: { 'Content-Type': 'application/json' }
});

const loadOnce = (page = 'home') => new Promise((resolve, reject) => {
  const stop = loadPublishedPageContent((content) => {
    stop();
    resolve(content);
  }, (error) => {
    stop();
    reject(error);
  }, page);
});

test('revisiting a page fetches its latest text instead of retaining the first successful response', async (t) => {
  let title = 'Original text';
  const fetch = t.mock.method(globalThis, 'fetch', async () => response({ title }));
  assert.deepEqual(await loadOnce(), { home: { title } });

  title = 'Published edit';
  assert.deepEqual(await loadOnce(), { home: { title } });
  assert.equal(fetch.mock.callCount(), 2);
  assert.deepEqual(fetch.mock.calls[1].arguments, ['/content/pages/home.json', { cache: 'no-cache' }]);
});

test('concurrent subscribers share an in-flight request, even if one stops listening', async (t) => {
  let finish;
  const fetch = t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => { finish = resolve; }));
  const staleContent = t.mock.fn();
  const staleError = t.mock.fn();
  const stop = loadPublishedPageContent(staleContent, staleError);
  const active = loadOnce();
  stop();

  finish(response({ title: 'Current text' }));
  assert.deepEqual(await active, { home: { title: 'Current text' } });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(staleContent.mock.callCount(), 0);
  assert.equal(staleError.mock.callCount(), 0);
});

test('network, HTTP and invalid-content failures reach the caller and do not poison a later retry', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  const cases = [
    [() => Promise.reject(new Error('Offline')), /Offline/],
    [async () => new Response('Unavailable', { status: 503 }), /Could not load home content \(503\)/],
    [async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }), /Invalid home content response/],
    [async () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }), /JSON/]
  ];

  for (const [request, expected] of cases) {
    fetch.mock.mockImplementation(request);
    await assert.rejects(loadOnce(), expected);
    fetch.mock.mockImplementation(async () => response({ title: 'Recovered' }));
    assert.deepEqual(await loadOnce(), { home: { title: 'Recovered' } });
  }
});

test('an unpublished page uses defaults but is fetched again when content becomes available', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  assert.deepEqual(await loadOnce('contact-us'), { contact: {} });

  fetch.mock.mockImplementation(async () => response({ title: 'New contact wording' }));
  assert.deepEqual(await loadOnce('contact-us'), { contact: { title: 'New contact wording' } });
});

test('stopping a page load cancels pending background prefetch', async (t) => {
  let prefetch;
  t.mock.method(globalThis, 'setTimeout', (callback) => {
    prefetch = callback;
    return 17;
  });
  const clearTimeout = t.mock.method(globalThis, 'clearTimeout', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => response({ title: 'Home' }));
  let loaded;
  const content = new Promise((resolve) => { loaded = resolve; });
  const stop = loadPublishedPageContent(loaded, assert.fail);
  await content;
  await Promise.resolve();

  assert.equal(typeof prefetch, 'function');
  stop();
  await prefetch();
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(clearTimeout.mock.calls[0].arguments[0], 17);
});
