import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { registerClientErrorRoutes } from './clientErrors.js';

test('error endpoint accepts only allowlisted fields, logs no request identifiers, and rate limits abuse', async () => {
  const logged = [];
  const app = express();
  app.use(express.json());
  registerClientErrorRoutes(app, { logger: { error: (value) => logged.push(JSON.parse(value)) } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const send = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/client-errors`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'private user agent', Referer: 'https://club.test/private' },
    body: JSON.stringify(body)
  });
  try {
    assert.equal((await send({ kind: 'auth-network', page: 'admin' })).status, 202);
    assert.deepEqual(logged, [{ severity: 'ERROR', event: 'fcc-client-error', kind: 'auth-network', page: 'admin' }]);
    for (const body of [{ kind: 'javascript', page: 'home', message: 'private' }, { kind: 'private', page: 'home' },
      { kind: 'javascript', page: '/order/secret' }, {}, []]) assert.equal((await send(body)).status, 400);
    assert.equal(logged.length, 1);
    for (let i = 0; i < 4; i++) assert.equal((await send({ kind: 'javascript', page: 'home' })).status, 202);
    const limited = await send({ kind: 'javascript', page: 'home' });
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /Too many/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
