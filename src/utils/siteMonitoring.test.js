import test from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET_NAME, JOB_CHECK_NAME, siteLogPolicies, syncSiteMonitoring, syncWebsiteBudget, websiteBudget } from './siteMonitoring.js';

test('budget is exactly GBP5/month for only this project with all agreed actual and forecast thresholds', () => {
  const budget = websiteBudget('123', ['projects/fcc/notificationChannels/email']);
  assert.equal(budget.displayName, BUDGET_NAME);
  assert.deepEqual(budget.amount, { specifiedAmount: { currencyCode: 'GBP', units: '5' } });
  assert.deepEqual(budget.budgetFilter.projects, ['projects/123']);
  assert.equal(budget.budgetFilter.calendarPeriod, 'MONTH');
  assert.deepEqual(budget.thresholdRules, [
    { thresholdPercent: 0.5, spendBasis: 'CURRENT_SPEND' }, { thresholdPercent: 0.9, spendBasis: 'CURRENT_SPEND' },
    { thresholdPercent: 1, spendBasis: 'CURRENT_SPEND' }, { thresholdPercent: 1, spendBasis: 'FORECASTED_SPEND' }
  ]);
  assert.deepEqual(budget.notificationsRule, { monitoringNotificationChannels: ['projects/fcc/notificationChannels/email'], disableDefaultIamRecipients: true });
  assert.throws(() => websiteBudget('abc', ['channel']), /Budget requires/);
  assert.throws(() => websiteBudget('123', ['channel'], '0'), /Budget requires/);
  assert.throws(() => websiteBudget('123', []), /Budget requires/);
});

const fakeApi = () => {
  const store = { alertPolicies: [], uptimeCheckConfigs: [], budgets: [] };
  let id = 0;
  return { store, request: async ({ method, path, body }) => {
    const bare = path.split('?')[0];
    const kind = Object.keys(store).find((key) => bare.includes(`/${key}`));
    if (method === 'GET') return { [kind]: store[kind] };
    if (method === 'POST') { const item = { ...body, name: `${bare}/${++id}` }; store[kind].push(item); return item; }
    const index = store[kind].findIndex((item) => item.name === bare);
    if (method === 'DELETE') { store[kind].splice(index, 1); return {}; }
    assert.ok(index >= 0);
    return store[kind][index] = { ...body, name: bare };
  } };
};

test('monitoring is idempotent, repoints recipients, and keeps undeployed job health disabled', async () => {
  const fake = fakeApi();
  const options = { request: fake.request, project: 'fcc', apiUrl: 'https://api.example.com', channels: ['old'], log: () => {} };
  await syncSiteMonitoring({ ...options, enableJobHealth: false });
  assert.equal(fake.store.uptimeCheckConfigs[0].displayName, JOB_CHECK_NAME);
  assert.equal(fake.store.uptimeCheckConfigs[0].httpCheck.path, '/health/jobs');
  assert.equal(fake.store.alertPolicies.find((policy) => policy.displayName.includes('missed')).enabled, false);
  await syncSiteMonitoring({ ...options, channels: ['new'] });
  assert.equal(fake.store.uptimeCheckConfigs.length, 1);
  assert.equal(fake.store.alertPolicies.length, 3);
  for (const policy of fake.store.alertPolicies) {
    assert.deepEqual(policy.notificationChannels, ['new']);
    assert.equal(policy.enabled, true);
  }
});

test('budget setup leaves unrelated/account-wide budgets untouched and updates only the matching project budget', async () => {
  const fake = fakeApi();
  const unrelated = { name: 'billingAccounts/ABC/budgets/existing', displayName: 'GBP1 account-wide', amount: { specifiedAmount: { units: '1' } } };
  fake.store.budgets.push(unrelated);
  const options = { request: fake.request, billingAccount: 'billingAccounts/ABC', projectNumber: '123', channels: ['old'] };
  await syncWebsiteBudget(options);
  await syncWebsiteBudget({ ...options, channels: ['new'] });
  assert.equal(fake.store.budgets.length, 2);
  assert.deepEqual(fake.store.budgets[0], unrelated);
  assert.deepEqual(fake.store.budgets[1].notificationsRule.monitoringNotificationChannels, ['new']);
});

test('log alerts include partial job failures and throttle duplicate notifications', () => {
  const policies = siteLogPolicies(['channel']);
  assert.match(policies[0].conditions[0].conditionMatchedLog.filter, /fcc-client-error/);
  assert.match(policies[1].conditions[0].conditionMatchedLog.filter, /fcc-job-problems/);
  for (const policy of policies) assert.equal(policy.alertStrategy.notificationRateLimit.period, '3600s');
});
