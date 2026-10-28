import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipActivity, clubYearStart, renewalConfirmationOpen, justgoSyncHealth } from './membership.js';

const synced = { status: 'active', renewalMethod: 'justgo', justgoSyncStatus: 'synced', validUntil: '2027-06-01' };

test('the club year starts on 1 March', () => {
  assert.equal(clubYearStart(new Date(2026, 9, 11)).getTime(), new Date(2026, 2, 1).getTime());
  assert.equal(clubYearStart(new Date(2027, 1, 20)).getTime(), new Date(2026, 2, 1).getTime());
});

test('JustGo members are inactive from 1 March until the sync confirms them', () => {
  const day = new Date(2027, 2, 1, 1, 0);
  assert.equal(membershipActivity({ ...synced, lastJustgoSync: new Date(2027, 1, 28, 4, 0) }, day), 'awaiting-renewal');
  assert.equal(membershipActivity({ ...synced, lastJustgoSync: new Date(2027, 2, 1, 4, 0) }, new Date(2027, 2, 1, 5, 0)), 'active');
  assert.equal(membershipActivity(synced, day), 'awaiting-renewal', 'never synced means unconfirmed');
});

test('a member confirmed this club year stays active all year', () => {
  assert.equal(membershipActivity({ ...synced, lastJustgoSync: new Date(2026, 3, 2) }, new Date(2026, 9, 11)), 'active');
});

test('website members and unlinked purchases are active by their paid-until date', () => {
  const website = { status: 'active', renewalMethod: 'website', justgoSyncStatus: 'pending', validUntil: '2027-03-01' };
  assert.equal(membershipActivity(website, new Date(2026, 9, 11)), 'active');
  assert.equal(membershipActivity(website, new Date(2027, 2, 1, 0, 1)), 'expired');
});

test('an expired or cancelled record is never active, whatever the sync says', () => {
  assert.equal(membershipActivity({ ...synced, validUntil: '2020-03-01', lastJustgoSync: new Date() }, new Date()), 'expired');
  assert.equal(membershipActivity({ ...synced, status: 'cancelled', lastJustgoSync: new Date() }, new Date()), 'inactive');
});

test('the confirmation window covers the first two weeks of the club year', () => {
  assert.equal(renewalConfirmationOpen(new Date(2027, 2, 5)), true);
  assert.equal(renewalConfirmationOpen(new Date(2027, 2, 20)), false);
  assert.equal(renewalConfirmationOpen(new Date(2026, 9, 11)), false);
});

test('Firestore timestamps and millisecond values are understood', () => {
  const stamp = { toMillis: () => new Date(2027, 5, 1).getTime() };
  assert.equal(membershipActivity({ ...synced, validUntil: stamp, lastJustgoSync: new Date(2026, 4, 1).getTime() }, new Date(2026, 6, 1)), 'active');
});

test('the weekly JustGo sync counts as stopped when no run has completed for eight days', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.deepEqual(justgoSyncHealth(undefined, now), { lastSuccessAt: null, healthy: false });
  assert.equal(justgoSyncHealth({ lastSuccessAt: new Date('2026-10-03T02:00:00Z') }, now).healthy, true, 'a week since the last run is normal');
  assert.equal(justgoSyncHealth({ lastSuccessAt: { toMillis: () => Date.parse('2026-10-02T11:00:00Z') } }, now).healthy, false);
});
