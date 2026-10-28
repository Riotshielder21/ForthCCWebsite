/** Google Cloud Monitoring set-up for the API outage email alert (run by the deploy workflow). */
export const UPTIME_CHECK_NAME = 'FCC API health';
export const ALERT_POLICY_NAME = 'FCC API outage';
export const CHANNEL_PREFIX = 'FCC API alerts: ';

export const parseAlertEmails = (value = '') => {
  const emails = [...new Set(value.split(/[,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const invalid = emails.filter((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
  if (invalid.length) throw new Error(`Invalid API alert email address: ${invalid.join(', ')}`);
  if (!emails.length) throw new Error('Set API_ALERT_EMAILS in the deploy workflow to at least one email address.');
  return emails;
};

export const uptimeCheckConfig = (project, apiUrl) => {
  const { hostname, protocol } = new URL(apiUrl);
  if (protocol !== 'https:') throw new Error('The API URL must use https.');
  return {
    displayName: UPTIME_CHECK_NAME,
    monitoredResource: { type: 'uptime_url', labels: { project_id: project, host: hostname } },
    httpCheck: { path: '/health', port: 443, useSsl: true, validateSsl: true, requestMethod: 'GET' },
    period: '300s',
    timeout: '10s'
  };
};

export const alertPolicy = (checkId, channelNames, apiUrl) => ({
  displayName: ALERT_POLICY_NAME,
  combiner: 'OR',
  severity: 'CRITICAL',
  enabled: true,
  notificationChannels: channelNames,
  alertStrategy: { autoClose: '1800s' },
  conditions: [{
    displayName: 'API /health failing from more than one region',
    conditionThreshold: {
      filter: `metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.label.check_id="${checkId}" AND resource.type="uptime_url"`,
      aggregations: [{ alignmentPeriod: '1200s', perSeriesAligner: 'ALIGN_NEXT_OLDER', crossSeriesReducer: 'REDUCE_COUNT_FALSE', groupByFields: ['resource.label.*'] }],
      comparison: 'COMPARISON_GT',
      thresholdValue: 1,
      duration: '60s',
      trigger: { count: 1 }
    }
  }],
  documentation: {
    mimeType: 'text/markdown',
    content: [
      `The Forth Canoe Club API (${apiUrl}) is failing its /health check, which also confirms Firestore can be read.`,
      'Shop, checkout, sign-ups and admin pages will fail; the Volunteering page shows its built-in default.',
      '',
      '1. Open Cloud Run → fcc-website-api → Logs for the error.',
      '2. If a recent deploy caused it, Cloud Run → Revisions → route traffic to the previous working revision.',
      '3. Check Secret Manager secrets, project billing and status.cloud.google.com.',
      '4. See "API outage" in DEVELOPMENT.md. A resolved email follows when the check passes again.'
    ].join('\n')
  }
});

const idOf = (name) => name.split('/').pop();

/**
 * Creates or updates the uptime check, one email channel per address and the alert policy.
 * `request({ method, path, body })` calls https://monitoring.googleapis.com/v3/<path> and returns parsed JSON.
 */
export async function syncApiMonitoring({ request, project, apiUrl, emails, log = () => {} }) {
  const parent = `projects/${project}`;
  const list = async (path, key) => {
    const items = [];
    let pageToken = '';
    do {
      const page = await request({ method: 'GET', path: `${path}${path.includes('?') ? '&' : '?'}pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}` });
      items.push(...(page[key] || []));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return items;
  };

  const wanted = uptimeCheckConfig(project, apiUrl);
  let check = (await list(`${parent}/uptimeCheckConfigs`, 'uptimeCheckConfigs')).find((item) => item.displayName === UPTIME_CHECK_NAME);
  // The monitored host cannot be changed on an existing check, so a new API URL means a new check.
  if (check && check.monitoredResource?.labels?.host !== wanted.monitoredResource.labels.host) {
    await request({ method: 'DELETE', path: check.name });
    log(`Replaced uptime check for old host ${check.monitoredResource?.labels?.host}.`);
    check = null;
  }
  if (check) {
    check = await request({ method: 'PATCH', path: `${check.name}?updateMask=httpCheck,period,timeout`, body: wanted });
    log(`Uptime check up to date: ${wanted.monitoredResource.labels.host}/health every 5 minutes.`);
  } else {
    check = await request({ method: 'POST', path: `${parent}/uptimeCheckConfigs`, body: wanted });
    log(`Created uptime check: ${wanted.monitoredResource.labels.host}/health every 5 minutes.`);
  }

  const channels = (await list(`${parent}/notificationChannels?filter=${encodeURIComponent('type="email"')}`, 'notificationChannels'))
    .filter((channel) => channel.displayName?.startsWith(CHANNEL_PREFIX));
  const channelNames = [];
  for (const email of emails) {
    const existing = channels.find((channel) => channel.labels?.email_address?.toLowerCase() === email);
    const channel = existing || await request({ method: 'POST', path: `${parent}/notificationChannels`,
      body: { type: 'email', displayName: `${CHANNEL_PREFIX}${email}`, labels: { email_address: email }, enabled: true } });
    if (!existing) log(`Added alert email ${email}.`);
    channelNames.push(channel.name);
  }

  const policyBody = alertPolicy(idOf(check.name), channelNames, apiUrl);
  const policy = (await list(`${parent}/alertPolicies`, 'alertPolicies')).find((item) => item.displayName === ALERT_POLICY_NAME);
  if (policy) await request({ method: 'PATCH', path: policy.name, body: { ...policyBody, name: policy.name } });
  else await request({ method: 'POST', path: `${parent}/alertPolicies`, body: policyBody });
  log(`Alert policy "${ALERT_POLICY_NAME}" emails: ${emails.join(', ')}.`);

  // Addresses removed from the workflow stop receiving alerts.
  for (const channel of channels.filter((item) => !channelNames.includes(item.name))) {
    await request({ method: 'DELETE', path: `${channel.name}?force=true` });
    log(`Removed alert email ${channel.labels?.email_address}.`);
  }
  return { checkId: idOf(check.name), channelNames };
}
