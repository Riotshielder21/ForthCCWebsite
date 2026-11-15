export const MONITORED_JOBS = {
  'fcc-justgo-sync': { hour: 4, run: true },
  'fcc-justgo-upload': { minute: 30, run: true },
  'fcc-renewals': { hour: 9, annual: true },
  'fcc-welcome-emails': { hour: 6 }
};
const GRACE_MS = 2 * 60 * 60 * 1000;

// Find the latest due run outside the two-hour completion grace, using the Scheduler's London timezone.
export function lastExpectedRun(job, now) {
  const config = MONITORED_JOBS[job];
  if (!config) throw new Error('Unknown monitored job.');
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const cutoff = now.getTime() - GRACE_MS;
  // February is outside daylight saving; avoid searching a year minute by minute for the seasonal job.
  if (config.annual) {
    const year = Number(parts.formatToParts(new Date(cutoff)).find((part) => part.type === 'year').value);
    return [Date.UTC(year, 1, 15, 9), Date.UTC(year, 1, 1, 9), Date.UTC(year - 1, 1, 15, 9)].find((time) => time <= cutoff);
  }
  for (let time = Math.floor(cutoff / 60000) * 60000; time >= cutoff - 27 * 60 * 60 * 1000; time -= 60000) {
    const values = Object.fromEntries(parts.formatToParts(new Date(time)).map(({ type, value }) => [type, Number(value)]));
    if (config.hour === undefined ? values.minute === config.minute : values.hour === config.hour && values.minute === 0) return time;
  }
  throw new Error('Could not calculate the last scheduled run.');
}

export function scheduledJobProblem(name, scheduler, execution, now = new Date()) {
  if (scheduler.state === 'PAUSED') return null;
  if (scheduler.state !== 'ENABLED') return 'Schedule is not enabled or paused.';
  const due = lastExpectedRun(name, now);
  if (Date.parse(scheduler.userUpdateTime) > due) return null; // First scheduled run after creation/configuration is still pending.
  if (!(Date.parse(scheduler.lastAttemptTime) >= due)) return 'The scheduled run was missed.';
  if (scheduler.status?.code) return 'Cloud Scheduler could not dispatch the job.';
  if (!MONITORED_JOBS[name].run) return null;
  if (!execution || !(Date.parse(execution.createTime || execution.startTime) >= due)) return 'Cloud Run did not start the scheduled job.';
  if (!execution.completionTime) {
    return now.getTime() - Date.parse(execution.createTime || execution.startTime) > GRACE_MS ? 'Cloud Run did not finish within two hours.' : null;
  }
  if (Number(execution.failedCount) > 0 || !(Number(execution.succeededCount) > 0)) return 'Cloud Run job failed.';
  return null;
}
