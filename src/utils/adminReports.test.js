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
  const synced = membershipReport('sca-1', { affiliationNumber: '1', firstName: 'Jo', lastName: 'Sync', source: 'justgo', status: 'active', validUntil: '2099-03-01' });
  assert.equal(synced.name, 'Jo Sync');
  assert.equal(synced.status, 'Current');
  const awaitingRenewal = membershipReport('sca-2', {
    affiliationNumber: '2', firstName: 'Sam', lastName: 'Renewal', status: 'active', validUntil: '2099-03-01',
    renewalMethod: 'justgo', justgoSyncStatus: 'synced', lastJustgoSync: '2026-02-28T12:00:00.000Z'
  }, new Date('2026-10-10T12:00:00Z'));
  assert.equal(awaitingRenewal.status, 'Awaiting renewal');
  assert.equal(awaitingRenewal.lastJustgoSync, '2026-02-28T12:00:00.000Z');
  assert.equal(awaitingRenewal.renewalMethod, 'justgo');
  const legacy = membershipReport('L1', { affiliationNumber: 'L1', name: 'Legacy Name', expiry: '01/03/2020', status: 'Active' });
  assert.equal(legacy.status, 'Expired');
  assert.equal(legacy.affiliationNumber, 'L1');
  assert.equal(legacy.source, 'justgo');
  const website = membershipReport('MEM-1', { firstName: 'Ann', lastName: 'Web', emergencyContact: { name: 'E', phone: '9', relationship: 'Friend' }, guardian: { name: 'P', phone: '7', relationship: 'Parent' }, validUntil: '2099-03-01', status: 'active', source: 'website' });
  assert.equal(website.emergencyContact, 'E, Friend, 9');
  assert.equal(website.parent, 'P, Parent, 7');
  const normalized = membershipReport('MEM-2', { firstName: 'Kit', lastName: 'Web', dob: '2015-01-01', membershipTier: 'junior',
    householdId: 'H1', validUntil: '2099-03-01', status: 'active' }, new Date('2026-10-10T12:00:00Z'),
  { contactName: 'Pat Web', contactRelationship: 'Parent', email: 'pat@example.com', phone: '7', address: '2 Road', postcode: 'EH2' });
  assert.equal(normalized.email, 'pat@example.com');
  assert.equal(normalized.parent, 'Pat Web, Parent, 7');
  assert.equal(normalized.address, '2 Road, EH2');
  const included = membershipReport('MEM-3', { firstName: 'Cal', lastName: 'Course', membershipTier: 'adult', status: 'active', validUntil: '2099-03-01',
    membershipIncludedWith: { productId: 'course', name: 'Beginner course', orderRef: 'FCC-1' } });
  assert.deepEqual([included.tier, included.includedWith], ['adult', 'Beginner course']);
});

test('event attendee exports use the linked household as the canonical source of contact details', () => {
  const report = orderReport('O3', {
    email: 'receipt@example.com', status: 'paid',
    items: [{ lineId: 'event', name: 'Paddling', category: 'EVENTS' }],
    people: [{ firstName: 'Kit', lastName: 'Web', junior: true, membershipId: 'M3', lineIds: ['event'], events: [{ name: 'Paddling' }] }]
  }, new Map([['M3', { household: { email: 'parent@example.com', phone: '0777', emergencyContact: {} } }]]));
  const [row] = eventAttendeeRows([report], () => '');
  assert.equal(row[4], '0777');
  assert.equal(row[5], 'parent@example.com');
});

test('mixed shop orders retain individual prices, sizes, quantities, and event schedules in reports', () => {
  const report = orderReport('MIXED-1', {
    email: 'buyer@example.test', status: 'paid', total: '155',
    items: [
      { lineId: 'tee-s', name: 'Club shirt', category: 'MERCHANDISE', type: 'merchandise', size: 'S', price: 20 },
      { lineId: 'tee-m', name: 'Club shirt', category: 'MERCHANDISE', type: 'merchandise', size: 'M', price: 20 },
      { lineId: 'course-1', name: 'Week-long course', category: 'EVENTS', type: 'event-ticket', price: 115,
        eventSchedule: { mode: 'consecutive', startDate: '2027-07-12', days: 5 } }
    ],
    people: [{ firstName: 'Alex', lastName: 'Example', lineIds: ['course-1'], events: [{ name: 'Week-long course',
      eventSchedule: { mode: 'consecutive', startDate: '2027-07-12', days: 5 } }] }]
  });
  assert.equal(report.total, 155);
  assert.deepEqual(report.items.map(({ name, price }) => [name, price]), [
    ['Club shirt (S)', 20], ['Club shirt (M)', 20], ['Week-long course', 115]
  ]);
  const rows = eventAttendeeRows([report], (schedule) => `${schedule.days} days from ${schedule.startDate}`);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].slice(0, 3), ['Week-long course', '5 days from 2027-07-12', 'Alex Example']);
  assert.equal(rows[0][10], 'MIXED-1');
});

test('adult and junior attendees in one household use different emergency-contact rules', () => {
  const household = {
    email: 'parent@example.test', phone: '07700 900111', address: '1 Shared Road', postcode: 'EH1 1AA',
    contactName: 'Pat Guardian', contactRelationship: 'Parent',
    emergencyContact: { name: 'Lee Friend', relationship: 'Friend', phone: '07700 900222' }
  };
  const report = orderReport('FAMILY-1', {
    email: 'receipt@example.test', status: 'paid',
    items: [{ lineId: 'adult-course', name: 'Open-water course', category: 'EVENTS' },
      { lineId: 'junior-course', name: 'Open-water course', category: 'EVENTS' }],
    people: [
      { firstName: 'Pat', lastName: 'Guardian', dob: '1988-04-10', membershipId: 'ADULT-1', lineIds: ['adult-course'], events: [{ name: 'Open-water course' }] },
      { firstName: 'Kit', lastName: 'Guardian', dob: '2013-09-03', junior: true, membershipId: 'JUNIOR-1', lineIds: ['junior-course'], events: [{ name: 'Open-water course' }] }
    ]
  }, new Map([
    ['ADULT-1', { household }],
    ['JUNIOR-1', { household }]
  ]));
  assert.equal(report.people[0].email, 'parent@example.test');
  assert.equal(report.people[0].phone, '07700 900111');
  assert.equal(report.people[0].emergencyContact, 'Lee Friend, Friend, 07700 900222');
  assert.equal(report.people[1].email, 'parent@example.test');
  assert.equal(report.people[1].phone, '07700 900111');
  assert.equal(report.people[1].emergencyContact, 'Pat Guardian, Parent, 07700 900111');
  assert.deepEqual(eventAttendeeRows([report], () => '').map((row) => row[6]), [
    'Lee Friend, Friend, 07700 900222', 'Pat Guardian, Parent, 07700 900111'
  ]);
});

test('separate households may share an external emergency contact without sharing parent contacts', () => {
  const order = {
    email: 'order@example.test', status: 'paid', items: [],
    people: [
      { firstName: 'One', lastName: 'Adult', membershipId: 'H-1' },
      { firstName: 'Two', lastName: 'Adult', membershipId: 'H-2' }
    ]
  };
  const report = orderReport('SHARED-EMERGENCY', order, new Map([
    ['H-1', { household: { contactName: 'Parent One', email: 'one@example.test', phone: '1',
      emergencyContact: { name: 'Same Friend', relationship: 'Friend', phone: '999' } } }],
    ['H-2', { household: { contactName: 'Parent Two', email: 'two@example.test', phone: '2',
      emergencyContact: { name: 'Same Friend', relationship: 'Friend', phone: '999' } } }]
  ]));
  assert.deepEqual(report.people.map(({ email, phone, emergencyContact }) => [email, phone, emergencyContact]), [
    ['one@example.test', '1', 'Same Friend, Friend, 999'],
    ['two@example.test', '2', 'Same Friend, Friend, 999']
  ]);
});

test('JustGo status follows the upload attempts, and the staff list holds only members needing staff', () => {
  const base = { firstName: 'Ann', lastName: 'Web', dob: '1990-01-01', email: 'a@example.com', phone: '1', address: '1 Road', postcode: 'EH1', membershipTier: 'adult', justgoSyncStatus: 'pending', validUntil: '2099-03-01', status: 'active', medical: 'Asthma' };
  const waiting = membershipReport('M1', { ...base, justgoUpload: { status: 'queued' } });
  const invited = membershipReport('M2', { ...base, justgoUpload: { status: 'invited', inviteExpiresAt: '2026-10-20' } });
  const failed = membershipReport('M3', { ...base, affiliationNumber: 'PS123', justgoUpload: { status: 'failed', needsStaff: true, failures: 3, lastError: 'Invitation expired' } });
  const manual = membershipReport('M4', { ...base, justgoUpload: { status: 'manual' } });
  const synced = membershipReport('sca-1', { affiliationNumber: '1', firstName: 'Jo', lastName: 'Sync', justgoSyncStatus: 'synced', status: 'active', validUntil: '2099-03-01' });
  assert.deepEqual([waiting, invited, failed, manual, synced].map((record) => record.justgo),
    ['Awaiting upload', 'Invitation sent', 'Needs staff upload', 'Added by staff, awaiting sync', 'In JustGo']);
  assert.equal(failed.uploadFailures, 3);
  assert.equal(failed.uploadError, 'Invitation expired');
  const rows = justgoUploadRows([waiting, invited, failed, manual, synced]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, justgoUploadHeaders.length);
  assert.deepEqual([rows[0][0], rows[0][1], rows[0][10], rows[0][11], rows[0][12]], ['M3', 'Ann', 'PS123', 3, 'Invitation expired']);
});

test('the member register shows PVG and safeguarding status with expiry dates', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const record = membershipReport('pvg-1', { firstName: 'Pat', lastName: 'Volunteer', checks: { pvg: { expiresOn: '2026-08-01' }, safeguarding: { expiresOn: '2026-01-01' } } }, now);
  assert.equal(record.pvg, 'Due to expire (01/08/2026)');
  assert.equal(record.safeguarding, 'Expired (01/01/2026)');
  assert.equal(membershipReport('pvg-2', {}, now).pvg, 'Not recorded');
});

test('report filters narrow purchases, events, and options', async () => {
  const { purchaseMatches, reportOptions, reportEventNames, onlyEvent } = await import('./adminReports.js');
  const membership = { items: [{ category: 'MEMBERSHIP' }], subscriptionWarning: true };
  const shop = { items: [{ category: 'MERCHANDISE' }, { category: 'SUBSCRIPTIONS' }] };
  assert.equal(purchaseMatches(membership, 'all'), true);
  assert.equal(purchaseMatches(membership, 'subscriptions'), true);
  assert.equal(purchaseMatches(shop, 'subscriptions'), true);
  assert.equal(purchaseMatches(shop, 'merchandise'), true);
  assert.equal(purchaseMatches(shop, 'membership'), false);
  assert.equal(purchaseMatches({ items: [{ category: 'MERCHANDISE' }] }, 'subscriptions'), false);
  assert.deepEqual(reportOptions([{ p: ['b', 'a'] }, { p: ['a', ''] }], (record) => record.p), ['a', 'b']);

  const records = [
    { id: 'o1', total: 30, items: [{ name: 'Pool session', price: 10 }, { name: 'Intro course', price: 20 }],
      people: [{ name: 'Ann', events: [{ name: 'Pool session' }] }, { name: 'Bob', events: [{ name: 'Intro course' }] }] },
    { id: 'o2', total: 20, items: [{ name: 'Intro course', price: 20 }], people: [] }
  ];
  assert.deepEqual(reportEventNames(records), ['Intro course', 'Pool session']);
  assert.equal(onlyEvent(records, 'all'), records);
  const pool = onlyEvent(records, 'Pool session');
  assert.deepEqual(pool.map((record) => [record.id, record.total, record.people.map((person) => person.name)]), [['o1', 10, ['Ann']]]);
  assert.equal(onlyEvent(records, 'Intro course').length, 2);
});


test('JustGo check statuses remain authoritative while a future membership awaits upload', () => {
  const fields = { justgoSyncStatus: 'pending', lastJustgoSync: 1, checks: { pvg: { source: 'justgo', label: 'Current' }, safeguarding: { expiresOn: '2030-01-01' } } };
  const report = membershipReport('pending-volunteer', fields);
  assert.equal(report.pvg, 'Current');
  assert.equal(report.safeguarding, 'Not supplied by JustGo');
});
