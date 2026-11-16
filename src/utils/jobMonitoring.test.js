import test from 'node:test';
import assert from 'node:assert/strict';
import { lastExpectedRun, scheduledJobProblem } from './jobMonitoring.js';

test('expected runs respect London daylight saving, February dates and the two-hour grace', () => {
  assert.equal(new Date(lastExpectedRun('fcc-justgo-sync', new Date('2026-07-12T07:00:00Z'))).toISOString(), '2026-07-12T03:00:00.000Z');
  assert.equal(new Date(lastExpectedRun('fcc-justgo-sync', new Date('2026-11-12T07:00:00Z'))).toISOString(), '2026-11-12T04:00:00.000Z');
  assert.equal(new Date(lastExpectedRun('fcc-renewals', new Date('2026-02-15T10:59:00Z'))).toISOString(), '2026-02-01T09:00:00.000Z');
  assert.equal(new Date(lastExpectedRun('fcc-renewals', new Date('2026-02-15T11:00:00Z'))).toISOString(), '2026-02-15T09:00:00.000Z');
  assert.equal(new Date(lastExpectedRun('fcc-renewals', new Date('2026-01-01T00:00:00Z'))).toISOString(), '2025-02-15T09:00:00.000Z');
  assert.equal(new Date(lastExpectedRun('fcc-justgo-upload', new Date('2026-11-12T14:20:00Z'))).toISOString(), '2026-11-12T11:30:00.000Z');
  assert.throws(() => lastExpectedRun('unknown', new Date()), /Unknown/);
});

const now = new Date('2026-11-12T14:00:00Z');
const schedule = { state: 'ENABLED', lastAttemptTime: '2026-11-12T13:30:00Z', status: { code: 0 }, userUpdateTime: '2026-01-01T00:00:00Z' };
const execution = { createTime: '2026-11-12T13:30:10Z', completionTime: '2026-11-12T13:31:00Z', succeededCount: 1 };

test('paused and newly configured schedules do not produce missed-run alarms', () => {
  assert.equal(scheduledJobProblem('fcc-justgo-upload', { state: 'PAUSED' }, null, now), null);
  assert.equal(scheduledJobProblem('fcc-renewals', { state: 'ENABLED', userUpdateTime: '2026-11-01T00:00:00Z' }, null, now), null);
});

test('job monitoring distinguishes missing dispatch, failed dispatch, absent/failed/hung execution and recovery', () => {
  assert.equal(scheduledJobProblem('fcc-justgo-upload', schedule, execution, now), null);
  assert.match(scheduledJobProblem('fcc-justgo-upload', { ...schedule, lastAttemptTime: '' }, execution, now), /missed/);
  assert.match(scheduledJobProblem('fcc-justgo-upload', { ...schedule, status: { code: 7 } }, execution, now), /dispatch/);
  assert.match(scheduledJobProblem('fcc-justgo-upload', schedule, null, now), /did not start/);
  assert.match(scheduledJobProblem('fcc-justgo-upload', schedule, { ...execution, succeededCount: 0, failedCount: 1 }, now), /failed/);
  assert.match(scheduledJobProblem('fcc-justgo-upload', schedule, { createTime: '2026-11-12T11:30:10Z' }, now), /finish/);
  assert.equal(scheduledJobProblem('fcc-welcome-emails', schedule, null, now), null);
});
