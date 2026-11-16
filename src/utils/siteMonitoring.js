import { alertPolicy, uptimeCheckConfig } from './apiMonitoring.js';

export const JOB_CHECK_NAME = 'FCC scheduled job health';
export const BUDGET_NAME = 'FCC website monthly budget';

export function logAlertPolicy(name, filter, channels, guidance) {
  return {
    displayName: name, combiner: 'OR', enabled: true, severity: 'ERROR', notificationChannels: channels,
    conditions: [{ displayName: name, conditionMatchedLog: { filter } }],
    alertStrategy: { notificationRateLimit: { period: '3600s' }, autoClose: '86400s' },
    documentation: { mimeType: 'text/markdown', content: guidance }
  };
}

export function siteLogPolicies(channels) {
  return [
    logAlertPolicy('FCC browser errors', 'resource.type="cloud_run_revision" AND resource.labels.service_name="fcc-website-api" AND jsonPayload.event="fcc-client-error"',
      channels, 'A browser reported a fixed error category and page, with no error message, URL, stack or form data. Website maintainer: inspect Cloud Run logs filtered by jsonPayload.event="fcc-client-error", reproduce on that page, and check the latest release. Repeated reports are rate limited; a lack of reports does not prove the site is healthy.'),
    logAlertPolicy('FCC scheduled job failures',
      '(resource.type="cloud_scheduler_job" AND (resource.labels.job_id="fcc-renewals" OR resource.labels.job_id="fcc-welcome-emails" OR resource.labels.job_id="fcc-justgo-sync" OR resource.labels.job_id="fcc-justgo-upload") AND severity>=ERROR) OR (resource.type="cloud_run_job" AND (resource.labels.job_name="fcc-justgo-sync" OR resource.labels.job_name="fcc-justgo-upload") AND severity>=ERROR) OR jsonPayload.event="fcc-job-problems"',
      channels, 'Website maintainer: inspect the named Cloud Scheduler job and Cloud Run execution/API logs. Check credentials, APIs and permissions. Renewal/welcome jobs may report partial email failures. For JustGo uploads, reconcile any uncertain write in JustGo before retrying; never blindly replay an upload. Paused JustGo schedules are intentional until integration is enabled.')
  ];
}

export function websiteBudget(projectNumber, channels, amount = '5') {
  if (!/^\d+$/.test(projectNumber) || !/^[1-9]\d*$/.test(amount) || !channels.length || channels.length > 5) throw new Error('Budget requires a project number, positive whole-pound amount and one to five email channels.');
  return {
    displayName: BUDGET_NAME,
    budgetFilter: { projects: [`projects/${projectNumber}`], calendarPeriod: 'MONTH', creditTypesTreatment: 'INCLUDE_ALL_CREDITS' },
    amount: { specifiedAmount: { currencyCode: 'GBP', units: amount } },
    thresholdRules: [0.5, 0.9, 1].map((thresholdPercent) => ({ thresholdPercent, spendBasis: 'CURRENT_SPEND' }))
      .concat([{ thresholdPercent: 1, spendBasis: 'FORECASTED_SPEND' }]),
    notificationsRule: { monitoringNotificationChannels: channels, disableDefaultIamRecipients: true }
  };
}

async function list(request, path, key) {
  const items = [];
  let token = '';
  do {
    const response = await request({ method: 'GET', path: `${path}${path.includes('?') ? '&' : '?'}pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}` });
    items.push(...(response[key] || []));
    token = response.nextPageToken || '';
  } while (token);
  return items;
}

export async function syncSiteMonitoring({ request, project, apiUrl, channels, enableJobHealth = true, log = console.log }) {
  const parent = `projects/${project}`;
  const policies = await list(request, `${parent}/alertPolicies`, 'alertPolicies');
  const checks = await list(request, `${parent}/uptimeCheckConfigs`, 'uptimeCheckConfigs');
  const wanted = uptimeCheckConfig(project, apiUrl);
  wanted.displayName = JOB_CHECK_NAME;
  wanted.httpCheck.path = '/health/jobs';
  wanted.timeout = '60s';
  let check = checks.find((item) => item.displayName === JOB_CHECK_NAME);
  if (check && check.monitoredResource.labels.host !== wanted.monitoredResource.labels.host) {
    await request({ method: 'DELETE', path: check.name });
    check = null;
  }
  check = await request(check ? { method: 'PATCH', path: `${check.name}?updateMask=httpCheck,period,timeout`, body: wanted }
    : { method: 'POST', path: `${parent}/uptimeCheckConfigs`, body: wanted });
  const jobHealth = {
    ...alertPolicy(check.name.split('/').pop(), channels, apiUrl),
    displayName: 'FCC scheduled job missed or unhealthy', combiner: 'OR', enabled: enableJobHealth, severity: 'ERROR',
    documentation: { mimeType: 'text/markdown', content: 'Website maintainer: open Reports & records → Needs attention, then inspect Cloud Scheduler and Cloud Run. The health check allows two hours for completion, respects paused schedules and London time, and checks renewals on 1/15 February. If there is no job entry, check API monitoring permissions, Firestore and the /health/jobs endpoint. A resolved email follows recovery.' }
  };
  jobHealth.conditions[0].displayName = 'Scheduled job health unavailable';
  for (const body of [...siteLogPolicies(channels), jobHealth]) {
    const existing = policies.find((policy) => policy.displayName === body.displayName);
    await request(existing ? { method: 'PATCH', path: existing.name, body: { ...body, name: existing.name } }
      : { method: 'POST', path: `${parent}/alertPolicies`, body });
    log(`Configured "${body.displayName}".`);
  }
}

export async function syncWebsiteBudget({ request, billingAccount, projectNumber, channels, amount = '5' }) {
  if (!/^billingAccounts\/[A-Z0-9-]+$/.test(billingAccount)) throw new Error('A billing account resource name is required.');
  const parent = `${billingAccount}/budgets`;
  const existing = (await list(request, `${parent}?scope=${encodeURIComponent(`projects/${projectNumber}`)}`, 'budgets')).find((budget) => budget.displayName === BUDGET_NAME
    && budget.budgetFilter?.projects?.length === 1 && budget.budgetFilter.projects[0] === `projects/${projectNumber}`);
  const body = websiteBudget(projectNumber, channels, amount);
  return request(existing ? { method: 'PATCH', path: existing.name, body: { ...body, name: existing.name } }
    : { method: 'POST', path: parent, body });
}
