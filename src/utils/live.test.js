import test from 'node:test';
import assert from 'node:assert/strict';
import { isLive, liveReadinessProblems } from './live.js';

test('only an explicit true turns live mode on', () => {
  assert.equal(isLive({ WEBSITE_ISLIVE: 'true' }), true);
  assert.equal(isLive({ WEBSITE_ISLIVE: ' TRUE ' }), true);
  for (const value of ['false', '', '1', 'yes', undefined]) assert.equal(isLive({ WEBSITE_ISLIVE: value }), false, String(value));
});

test('readiness warnings only apply to a live site and list what is missing', () => {
  assert.deepEqual(liveReadinessProblems({ env: { WEBSITE_ISLIVE: 'false' } }), []);
  const live = liveReadinessProblems({ env: { WEBSITE_ISLIVE: 'true' }, currentVersions: { 'participation-disclaimer': 3 } });
  assert.equal(live.length, 4);
  assert.match(live[0], /AUDIT_LOOKUP_SECRET/);
  assert.ok(live.some((problem) => /privacy notice/.test(problem)));
  assert.ok(!live.some((problem) => /participation disclaimer/.test(problem)));
  const ready = liveReadinessProblems({ env: { WEBSITE_ISLIVE: 'true', AUDIT_LOOKUP_SECRET: 'x' },
    currentVersions: { 'privacy-notice': 1, 'data-retention': 1, 'first-aid-and-safety': 1, 'participation-disclaimer': 2 } });
  assert.deepEqual(ready, []);
});
