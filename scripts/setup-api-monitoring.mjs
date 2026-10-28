// Creates/updates the API outage email alert in Google Cloud Monitoring. Run by .github/workflows/firebase-hosting.yml.
// Env: API_URL (Cloud Run URL), API_ALERT_EMAILS (comma separated), GOOGLE_CLOUD_PROJECT, and Google credentials (ADC).
import { google } from 'googleapis';
import { parseAlertEmails, syncApiMonitoring } from '../src/utils/apiMonitoring.js';

const { API_URL: apiUrl, API_ALERT_EMAILS: alertEmails, GOOGLE_CLOUD_PROJECT: project } = process.env;
try {
  if (!apiUrl || !project) throw new Error('API_URL and GOOGLE_CLOUD_PROJECT are required.');
  const emails = parseAlertEmails(alertEmails);
  const client = await new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/monitoring'] }).getClient();
  const request = async ({ method, path, body }) => {
    try {
      return (await client.request({ url: `https://monitoring.googleapis.com/v3/${path}`, method, data: body })).data || {};
    } catch (error) {
      const detail = error.response?.data?.error?.message || error.message;
      throw new Error(`${method} ${path.split('?')[0]} failed: ${detail}`);
    }
  };
  await syncApiMonitoring({ request, project, apiUrl, emails, log: (message) => console.log(message) });
} catch (error) {
  const hint = error.message.includes(' failed: ') ? ' Check the deploy service account has the Monitoring Editor role and the Cloud Monitoring API is enabled (DEVELOPMENT.md, "API outage alerts").' : '';
  console.error(`::error title=API outage alert not configured::${error.message}${hint}`);
  process.exitCode = 1;
}
