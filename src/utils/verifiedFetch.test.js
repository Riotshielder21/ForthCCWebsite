import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifiedFetch } from './verifiedFetch.js';

test('verified fetch preserves authentication, body and cancellation while attaching App Check', async () => {
  const controller = new AbortController();
  const headers = new Headers({ Authorization: 'Bearer local-test', 'X-Email-Session': 'email-session' });
  const request = createVerifiedFetch(async () => 'app-token', async (url, options) => {
    assert.equal(url, '/api/checkout-session');
    assert.equal(options.headers.get('X-Firebase-AppCheck'), 'app-token');
    assert.equal(options.headers.get('Authorization'), 'Bearer local-test');
    assert.equal(options.headers.get('X-Email-Session'), 'email-session');
    assert.equal(options.body, '{"test":true}');
    assert.equal(options.method, 'POST');
    assert.equal(options.signal, controller.signal);
    return Response.json({ ok: true });
  });
  assert.equal((await request('/api/checkout-session', {
    method: 'POST', headers, body: '{"test":true}', signal: controller.signal
  })).status, 200);
  assert.equal(headers.has('X-Firebase-AppCheck'), false);
});

test('local or monitor-mode null tokens do not fabricate verification headers', async () => {
  const request = createVerifiedFetch(async () => null, async (_url, options) => {
    assert.equal(options.headers.has('X-Firebase-AppCheck'), false);
    return new Response();
  });
  await request('/api/contact');
});

test('token acquisition failure prevents submission and surfaces the error', async () => {
  let submitted = false;
  const request = createVerifiedFetch(async () => { throw new Error('Verification unavailable'); }, async () => { submitted = true; });
  await assert.rejects(request('/api/contact'), /Verification unavailable/);
  assert.equal(submitted, false);
});
