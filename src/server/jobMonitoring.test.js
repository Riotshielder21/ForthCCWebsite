import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { registerJobMonitoringHealth } from './jobMonitoring.js';

test('job health records fixed staff entries, caches checks, respects pauses, and settles recovered jobs', async () => {
  let time = Date.parse('2026-11-12T14:00:00Z'), calls = 0, failed = true;
  const raised = [], settled = [];
  const app = express();
  registerJobMonitoringHealth(app, { project: 'fcc', now: () => time,
    request: async (url) => {
      calls++;
      const job = url.split('/').pop();
      return { state: job === 'fcc-justgo-upload' || job === 'fcc-justgo-sync' ? 'PAUSED' : 'ENABLED',
        userUpdateTime: '2026-01-01T00:00:00Z',
        lastAttemptTime: job === 'fcc-renewals' ? '2026-02-15T09:00:00Z' : failed ? '' : '2026-11-12T06:00:00Z' };
    },
    attention: { raise: async (...args) => raised.push(args), settle: async (...args) => settled.push(args) } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const get = () => fetch(`http://127.0.0.1:${server.address().port}/health/jobs`);
  try {
    assert.equal((await get()).status, 503);
    assert.deepEqual(raised, [['scheduled-job', 'fcc-welcome-emails', { detail: 'fcc-welcome-emails: The scheduled run was missed.', alert: false }]]);
    assert.equal((await get()).status, 503);
    assert.equal(calls, 4);
    failed = false; time += 300000;
    assert.equal((await get()).status, 200);
    assert.ok(settled.some(([kind, name]) => kind === 'scheduled-job' && name === 'fcc-welcome-emails'));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('monitoring API failures return unavailable without details and are cached to avoid repeated API calls', async () => {
  let calls = 0;
  const app = express();
  registerJobMonitoringHealth(app, { project: 'fcc', attention: {}, logger: { error: () => {} },
    request: async () => { calls++; throw new Error('private upstream detail'); } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/health/jobs`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: 'unavailable' });
    }
    assert.equal(calls, 4);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
