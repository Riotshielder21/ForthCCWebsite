import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, isAllowedOrigin } from './cors.js';

test('CORS allows the configured site origins and localhost only outside production', () => {
  const allowed = allowedOrigins({
    PUBLIC_SITE_URL: 'https://fccwebsite-23cfc.web.app/shop', PUBLIC_SITE_URLS: 'https://forthcanoeclub.co.uk, bad url',
    CORS_ORIGINS: 'https://preview.example.com'
  });
  assert.deepEqual([...allowed], ['https://fccwebsite-23cfc.web.app', 'https://forthcanoeclub.co.uk', 'https://preview.example.com']);
  assert.equal(isAllowedOrigin('https://forthcanoeclub.co.uk', allowed), true);
  assert.equal(isAllowedOrigin('https://evil.example.com', allowed), false);
  assert.equal(isAllowedOrigin('https://forthcanoeclub.co.uk.evil.com', allowed), false);
  assert.equal(isAllowedOrigin(undefined, allowed), true);
  assert.equal(isAllowedOrigin('http://localhost:3000', allowed), false);
  assert.equal(isAllowedOrigin('http://localhost:3000', allowed, { allowLocalhost: true }), true);
  assert.equal(isAllowedOrigin('https://localhost:3000', allowed, { allowLocalhost: true }), false);
  assert.equal(isAllowedOrigin('null', allowed, { allowLocalhost: true }), false);
});
