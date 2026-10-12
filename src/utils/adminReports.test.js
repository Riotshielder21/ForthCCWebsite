import test from 'node:test';
import assert from 'node:assert/strict';
import { memberState, memberReport, membershipReport, orderReport, reportCsv, reportDate, uniqueReportEmails, subscriptionWarning, eventAttendeeRows, eventAttendeeHeaders, justgoUploadRows, justgoUploadHeaders } from './adminReports.js';

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
test('event export lists every attendee with the details a leader needs', () => {
  const order = orderReport('O1', {
    email: 'buyer@example.com', status: 'paid', paidAt: '2026-10-01',
    items: [{ lineId: 'a', name: 'Five-day course', category: 'EVENTS', price: 50, eventSchedule: { startDate: '2027-04-05' } }, { lineId: 'b', name: 'Five-day course', category: 'EVENTS', price: 50 }, { lineId: 'm', name: 'Adult', category: 'MEMBERSHIP', price: 30 }],
    people: [
      { firstName: 'Ann', lastName: 'One', dob: '1990-01-01', email: 'ann@example.com', phone: '1', lineIds: ['a', 'm'], emergencyContact: { name: 'E', phone: '9', relationship: 'Friend' }, medical: 'Asthma', swimming: 'basic', photoConsent: true },
      { firstName: 'Kid', lastName: 'Two', dob: '2015-01-01', junior: true, lineIds: ['b'], emergencyNote: 'Parents are the emergency contact', guardian: { phone: '7', email: 'p@example.com' } }
    ]
  });
  const rows = eventAttendeeRows([order], (schedule) => `from ${schedule.startDate}`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, eventAttendeeHeaders.length);
  assert.deepEqual(rows[0].slice(0, 3), ['Five-day course', 'from 2027-04-05', 'Ann One']);
  assert.equal(rows[0][6], 'E, Friend, 9');
  assert.equal(rows[1][6], 'Parents are the emergency contact');
  assert.equal(rows[1][4], '7', 'a child is reached through the parent phone');
  const legacy = eventAttendeeRows([orderReport('O2', { email: 'old@example.com', status: 'paid', items: [{ name: 'Course', category: 'EVENTS' }] })], () => '');
  assert.equal(legacy[0][2], 'Attendee details not recorded');
});

test('one membership report covers JustGo and website records', () => {
  const synced = membershipReport('sca-1', { scaNumber: '1', firstName: 'Jo', lastName: 'Sync', source: 'justgo', status: 'active', validUntil: '2099-03-01' });
  assert.equal(synced.name, 'Jo Sync');
  assert.equal(synced.status, 'Current');
  const awaitingRenewal = membershipReport('sca-2', {
    scaNumber: '2', firstName: 'Sam', lastName: 'Renewal', status: 'active', validUntil: '2099-03-01',
    renewalMethod: 'justgo', justgoSyncStatus: 'synced', lastJustgoSync: '2026-02-28T12:00:00.000Z'
  }, new Date('2026-10-10T12:00:00Z'));
  assert.equal(awaitingRenewal.status, 'Awaiting renewal');
  assert.equal(awaitingRenewal.lastJustgoSync, '2026-02-28T12:00:00.000Z');
  assert.equal(awaitingRenewal.renewalMethod, 'justgo');
  const legacy = membershipReport('L1', { scaId: 'L1', name: 'Legacy Name', expiry: '01/03/2020', status: 'Active' });
  assert.equal(legacy.status, 'Expired');
  assert.equal(legacy.scaId, 'L1');
  assert.equal(legacy.source, 'justgo');
  const website = membershipReport('MEM-1', { firstName: 'Ann', lastName: 'Web', emergencyContact: { name: 'E', phone: '9', relationship: 'Friend' }, guardian: { name: 'P', phone: '7', relationship: 'Parent' }, validUntil: '2099-03-01', status: 'active', source: 'website' });
  assert.equal(website.emergencyContact, 'E, Friend, 9');
  assert.equal(website.parent, 'P, Parent, 7');
});

test('JustGo status follows the upload attempts, and the staff list holds only members needing staff', () => {
  const base = { firstName: 'Ann', lastName: 'Web', dob: '1990-01-01', email: 'a@example.com', phone: '1', address: '1 Road', postcode: 'EH1', membershipTier: 'adult', justgoSyncStatus: 'pending', validUntil: '2099-03-01', status: 'active', medical: 'Asthma' };
  const waiting = membershipReport('M1', { ...base, justgoUpload: { status: 'queued' } });
  const invited = membershipReport('M2', { ...base, justgoUpload: { status: 'invited', inviteExpiresAt: '2026-10-20' } });
  const failed = membershipReport('M3', { ...base, scaNumber: 'PS123', justgoUpload: { status: 'failed', needsStaff: true, failures: 3, lastError: 'Invitation expired' } });
  const manual = membershipReport('M4', { ...base, justgoUpload: { status: 'manual' } });
  const synced = membershipReport('sca-1', { scaNumber: '1', firstName: 'Jo', lastName: 'Sync', justgoSyncStatus: 'synced', status: 'active', validUntil: '2099-03-01' });
  assert.deepEqual([waiting, invited, failed, manual, synced].map((record) => record.justgo),
    ['Awaiting upload', 'Invitation sent', 'Needs staff upload', 'Added by staff, awaiting sync', 'In JustGo']);
  assert.equal(failed.uploadFailures, 3);
  assert.equal(failed.uploadError, 'Invitation expired');
  const rows = justgoUploadRows([waiting, invited, failed, manual, synced]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, justgoUploadHeaders.length);
  assert.deepEqual([rows[0][0], rows[0][1], rows[0][10], rows[0][11], rows[0][12]], ['M3', 'Ann', 'PS123', 3, 'Invitation expired']);
});
