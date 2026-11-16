import { execFileSync } from 'node:child_process';
import { google } from 'googleapis';
import { parseAlertEmails, syncApiMonitoring } from '../src/utils/apiMonitoring.js';
import { syncSiteMonitoring, syncWebsiteBudget } from '../src/utils/siteMonitoring.js';

const project = process.env.GOOGLE_CLOUD_PROJECT;
const apiUrl = process.env.API_URL;
try {
  if (!project || !apiUrl) throw new Error('GOOGLE_CLOUD_PROJECT and API_URL are required.');
  const emails = parseAlertEmails(process.env.API_ALERT_EMAILS);
  const client = process.argv.includes('--gcloud') ? null
    : await new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const token = client ? null : execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  const requestFor = (base) => async ({ method, path, body }) => {
    if (client) return (await client.request({ url: `${base}/${path}`, method, data: body, timeout: 30000 })).data;
    const response = await fetch(`${base}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': project },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${method} ${path.split('?')[0]}: ${result.error?.message || response.status}`);
    return result;
  };
  const monitoring = requestFor('https://monitoring.googleapis.com/v3');
  const { channelNames } = await syncApiMonitoring({ request: monitoring, project, apiUrl, emails, preserveChannels: true, log: console.log });
  const health = await fetch(new URL('/health/jobs', apiUrl), { signal: AbortSignal.timeout(60000) });
  const healthBody = await health.json();
  const enableJobHealth = [200, 503].includes(health.status) && ['ok', 'unavailable'].includes(healthBody.status);
  if (!enableJobHealth) console.warn('Scheduled-job missed-run alert remains disabled until /health/jobs is deployed.');
  await syncSiteMonitoring({ request: monitoring, project, apiUrl, channels: channelNames, enableJobHealth });
  const billing = requestFor('https://cloudbilling.googleapis.com/v1');
  const { billingAccountName } = await billing({ method: 'GET', path: `projects/${project}/billingInfo` });
  const resource = await requestFor('https://cloudresourcemanager.googleapis.com/v1')({ method: 'GET', path: `projects/${project}` });
  const budget = await syncWebsiteBudget({ request: requestFor('https://billingbudgets.googleapis.com/v1'),
    billingAccount: billingAccountName, projectNumber: resource.projectNumber, channels: channelNames, amount: process.env.MONTHLY_BUDGET_GBP || '5' });
  console.log(`Configured ${budget.name}: GBP ${budget.amount.specifiedAmount.units}/month; alerts to ${emails.join(', ')}.`);
} catch (error) {
  console.error(`Monitoring setup failed: ${error.message}`);
  process.exitCode = 1;
}
