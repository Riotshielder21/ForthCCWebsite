import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_POLICY_NAME, CHANNEL_PREFIX, UPTIME_CHECK_NAME, alertPolicy, parseAlertEmails, syncApiMonitoring, uptimeCheckConfig } from './apiMonitoring.js';

const fakeMonitoring = () => {
  const store = { uptimeCheckConfigs: [], notificationChannels: [], alertPolicies: [] };
  const calls = [];
  let next = 1;
  const request = async ({ method, path, body }) => {
    calls.push(`${method} ${path.split('?')[0]}`);
    const [bare] = path.split('?');
    const kind = Object.keys(store).find((key) => bare.includes(`/${key}`));
    if (method === 'GET') return { [kind]: store[kind] };
    if (method === 'POST') { const item = { ...body, name: `${bare}/id${next++}` }; store[kind].push(item); return item; }
    const index = store[kind].findIndex((item) => item.name === bare);
    if (method === 'DELETE') { store[kind].splice(index, 1); return {}; }
    // Like the real API, a PATCH with an update mask changes only the named fields.
    const mask = new URLSearchParams(path.split('?')[1] || '').get('updateMask');
    const changes = mask ? Object.fromEntries(mask.split(',').map((field) => [field, body[field]])) : body;
    store[kind][index] = { ...store[kind][index], ...changes, name: bare };
    return store[kind][index];
  };
  return { store, calls, request };
};
const options = (fake, overrides = {}) => ({ request: fake.request, project: 'fcc', apiUrl: 'https://api-abc.a.run.app', emails: ['a@example.com'], ...overrides });

test('alert emails are required, de-duplicated and validated', () => {
  assert.deepEqual(parseAlertEmails(' A@example.com, b@example.org a@example.com '), ['a@example.com', 'b@example.org']);
  assert.throws(() => parseAlertEmails(''), /API_ALERT_EMAILS/);
  assert.throws(() => parseAlertEmails('not-an-email'), /Invalid/);
});

test('uptime check probes /health over https every five minutes', () => {
  const config = uptimeCheckConfig('fcc', 'https://api-abc.a.run.app/');
  assert.equal(config.monitoredResource.labels.host, 'api-abc.a.run.app');
  assert.equal(config.httpCheck.path, '/health');
  assert.equal(config.period, '300s');
  assert.throws(() => uptimeCheckConfig('fcc', 'http://api.example.com'), /https/);
  const policy = alertPolicy('check-1', ['channel'], 'https://api-abc.a.run.app');
  assert.match(policy.conditions[0].conditionThreshold.filter, /check_id="check-1"/);
  assert.deepEqual(policy.notificationChannels, ['channel']);
});

test('first run creates the check, email channel and alert policy', async () => {
  const fake = fakeMonitoring();
  const result = await syncApiMonitoring(options(fake));
  assert.equal(fake.store.uptimeCheckConfigs[0].displayName, UPTIME_CHECK_NAME);
  assert.equal(fake.store.notificationChannels[0].displayName, `${CHANNEL_PREFIX}a@example.com`);
  assert.equal(fake.store.alertPolicies[0].displayName, ALERT_POLICY_NAME);
  assert.deepEqual(fake.store.alertPolicies[0].notificationChannels, result.channelNames);
  assert.match(fake.store.alertPolicies[0].conditions[0].conditionThreshold.filter, new RegExp(`check_id="${result.checkId}"`));
});

test('re-running is idempotent and changing the emails updates who is alerted', async () => {
  const fake = fakeMonitoring();
  await syncApiMonitoring(options(fake));
  await syncApiMonitoring(options(fake));
  assert.equal(fake.store.uptimeCheckConfigs.length, 1);
  assert.equal(fake.store.notificationChannels.length, 1);
  assert.equal(fake.store.alertPolicies.length, 1);
  fake.store.notificationChannels.push({ name: 'projects/fcc/notificationChannels/other', displayName: 'Someone else', labels: { email_address: 'x@example.com' } });
  await syncApiMonitoring(options(fake, { emails: ['b@example.com'] }));
  assert.deepEqual(fake.store.notificationChannels.map((channel) => channel.labels.email_address), ['x@example.com', 'b@example.com'], 'old club alert address removed; unrelated channels untouched');
  assert.deepEqual(fake.store.alertPolicies[0].notificationChannels, [fake.store.notificationChannels[1].name]);
});

test('re-running brings a check made by an older setup up to date, including logging failed checks', async () => {
  const fake = fakeMonitoring();
  fake.store.uptimeCheckConfigs.push({ ...uptimeCheckConfig('fcc', 'https://api-abc.a.run.app'), name: 'projects/fcc/uptimeCheckConfigs/old',
    timeout: '10s', logCheckFailures: undefined });
  await syncApiMonitoring(options(fake));
  const { name, ...current } = fake.store.uptimeCheckConfigs[0];
  assert.equal(name, 'projects/fcc/uptimeCheckConfigs/old');
  assert.deepEqual(current, uptimeCheckConfig('fcc', 'https://api-abc.a.run.app'));
});

test('a new API URL replaces the uptime check and repoints the policy', async () => {
  const fake = fakeMonitoring();
  await syncApiMonitoring(options(fake));
  const result = await syncApiMonitoring(options(fake, { apiUrl: 'https://api-new.a.run.app' }));
  assert.equal(fake.store.uptimeCheckConfigs.length, 1);
  assert.equal(fake.store.uptimeCheckConfigs[0].monitoredResource.labels.host, 'api-new.a.run.app');
  assert.match(fake.store.alertPolicies[0].conditions[0].conditionThreshold.filter, new RegExp(`check_id="${result.checkId}"`));
});

test('site-wide setup preserves shared channels while moving the API policy to the new recipients', async () => {
  const fake = fakeMonitoring();
  await syncApiMonitoring(options(fake));
  await syncApiMonitoring(options(fake, { emails: ['b@example.com'], preserveChannels: true }));
  assert.deepEqual(fake.store.notificationChannels.map((channel) => channel.labels.email_address), ['a@example.com', 'b@example.com']);
  assert.deepEqual(fake.store.alertPolicies[0].notificationChannels, [fake.store.notificationChannels[1].name]);
  assert.ok(!fake.calls.some((call) => call.startsWith('DELETE')));
});
