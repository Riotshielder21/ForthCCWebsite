import test from 'node:test';
import assert from 'node:assert/strict';
import { memberState, memberReport, orderReport, reportCsv, reportDate, uniqueReportEmails, subscriptionWarning } from './adminReports.js';

test('member status uses expiry, not an unverified Active flag', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(memberState({ status: 'Active', expiry: '01/03/2026' }, now), 'Expired');
  assert.equal(memberState({ status: 'Active', expiry: '01/03/2027' }, now), 'Current');
  assert.equal(memberState({ status: 'Active' }, now), 'Unverified expiry');
  assert.equal(memberState({ status: 'Cancelled', expiry: '01/03/2027' }, now), 'Cancelled');
  assert.equal(reportDate('31/02/2027'), null);
  assert.equal(memberReport('member-1', {}).email, '');
});

test('order reports expose purchases but not receipt access credentials', () => {
  const fields = { email: 'test@example.com', accessTokenHash: 'private', total: '25', status: 'paid',
    createdAt: { toDate: () => new Date('2026-10-10') }, items: [{ name: 'Gold', type: 'subscription', price: '25' }] };
  const report = orderReport('order-1', fields);
  assert.equal(report.total, 25);
  assert.equal(report.subscriptionWarning, true);
  assert.equal(Object.hasOwn(report, 'accessTokenHash'), false);
  assert.equal(subscriptionWarning({ stripeSubscriptionId: 'sub_123' }), true);
  assert.equal(subscriptionWarning({ items: [{ type: 'annual-oneoff' }] }), false);
});

test('CSV quotes values and neutralizes spreadsheet formulas; emails deduplicate', () => {
  assert.equal(reportCsv(['Name'], [['=HYPERLINK("url")'], ['a,b'], ['\t@unsafe']]),
    '"Name"\r\n"\'=HYPERLINK(""url"")"\r\n"a,b"\r\n"\'\t@unsafe"');
  assert.deepEqual(uniqueReportEmails([{ email: ' Test@Example.com ' }, { email: 'test@example.com' }, { email: '' }, { email: 'invalid' }]), ['test@example.com']);
});