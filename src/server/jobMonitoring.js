import { MONITORED_JOBS, scheduledJobProblem } from '../utils/jobMonitoring.js';

export function registerJobMonitoringHealth(app, { request, project, region = 'europe-west2', attention, now = Date.now, logger = console }) {
  let cached = null;
  let checkedAt = 0;
  let pending = null;
  const check = async () => {
    const results = await Promise.all(Object.entries(MONITORED_JOBS).map(async ([name, config]) => {
      const scheduler = await request(`https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/${name}`);
      let execution = null;
      if (config.run && scheduler.state === 'ENABLED') {
        const result = await request(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${name}/executions?pageSize=1`);
        execution = result.executions?.[0];
      }
      const problem = scheduledJobProblem(name, scheduler, execution, new Date(now()));
      if (problem) {
        await attention.raise('scheduled-job', name, { detail: `${name}: ${problem}`, alert: false });
      } else {
        await attention.settle('scheduled-job', name);
      }
      return problem ? name : null;
    }));
    const problems = results.filter(Boolean);
    return { status: problems.length ? 'unavailable' : 'ok', jobsNeedingAttention: problems.length };
  };
  app.get('/health/jobs', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!project) return res.status(503).json({ status: 'unavailable' });
    try {
      if (!cached || now() - checkedAt >= 5 * 60 * 1000) {
        pending ||= check().then((result) => { cached = result; checkedAt = now(); return result; }).finally(() => { pending = null; });
        await pending;
      }
      res.status(cached.status === 'ok' ? 200 : 503).json(cached);
    } catch (error) {
      logger.error('Scheduled-job health check failed:', error.code || 'monitoring-unavailable');
      cached = { status: 'unavailable' };
      checkedAt = now();
      res.status(503).json(cached);
    }
  });
}
