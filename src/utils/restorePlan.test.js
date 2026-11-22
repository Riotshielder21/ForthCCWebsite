import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupKey, personLookupKeys } from './privacy.js';
import { restorePlan } from './restorePlan.js';

const secret = 'restore-test-secret';
const snapshotTime = '2026-11-20T12:00:00Z';
const before = new Date('2026-11-20T11:00:00Z');
const after = new Date('2026-11-20T13:00:00Z');
const ann = { firstName: 'Ann', lastName: 'Example', dob: '2010-04-01', householdId: 'H1', guardian: { email: 'family@example.test' } };
const ben = { firstName: 'Ben', lastName: 'Example', dob: '2012-06-01', householdId: 'H1', guardian: { email: 'family@example.test' } };
const cal = { firstName: 'Cal', lastName: 'Other', dob: '1990-02-02', email: 'cal@example.test', householdId: 'H2' };

const restored = [
  { path: 'memberships/M1', data: ann }, { path: 'memberships/M2', data: ben }, { path: 'memberships/M3', data: cal },
  { path: 'households/H1', data: { email: 'family@example.test' } }, { path: 'households/H2', data: { email: 'cal@example.test' } },
  { path: 'orders/FCC-1', data: { email: 'family@example.test', total: 30 } },
  { path: 'orders/FCC-2', data: { email: 'cal@example.test', total: 50 } },
  { path: 'orders/FCC-3', data: { email: 'cal@example.test', total: 20 } },
  { path: 'lists/L1', data: { membershipId: 'M1' } },
  { path: 'lists/L2', data: { email: 'family@example.test' } },
  { path: 'settings/club', data: { name: 'FCC' } }
];
const live = new Map([
  ['memberships/M2', { data: ben, updateTime: before }],
  ['memberships/M3', { data: cal, updateTime: before }],
  ['households/H1', { data: { email: 'family@example.test', phone: 'replaced' }, updateTime: after }],
  ['households/H2', { data: { email: 'cal@example.test' }, updateTime: before }],
  ['orders/FCC-1', { data: { email: '', total: 30, personalDataErasedAt: after }, updateTime: after }],
  ['orders/FCC-2', { data: { email: 'cal@example.test', total: 0 }, updateTime: after }],
  ['settings/club', { data: { name: 'FCC' }, updateTime: before }]
]);
// Ann was erased after the restore point; Cal's erasure happened before it, so the restored copy already reflects it.
const auditEntries = [
  { action: 'gdpr-erasure', at: after, lookupKeys: [...personLookupKeys(secret, ann), lookupKey(secret, 'email', 'family@example.test')],
    summary: { ordersRedacted: ['FCC-1'] } },
  { action: 'gdpr-erasure', at: before, lookupKeys: personLookupKeys(secret, cal), summary: { ordersRedacted: [] } }
];
const paths = (documents) => documents.map((document) => document.path || document).sort();

test('a restore keeps people erased since the restore point out, without touching a family member who stays', () => {
  const plan = restorePlan({ restored, live, auditEntries, snapshotTime, secret });
  assert.equal(plan.erasuresSince, 1);
  assert.deepEqual(paths(plan.erased), ['households/H1', 'lists/L1', 'memberships/M1', 'orders/FCC-1']);
  assert.deepEqual(paths(plan.unchanged), ['households/H2', 'memberships/M2', 'memberships/M3', 'settings/club']);
  assert.deepEqual(paths(plan.changed), ['orders/FCC-2']);
  assert.deepEqual(paths(plan.write), ['lists/L2', 'orders/FCC-3']);
});

test('changes made since the restore point are overwritten only when asked, and erasures still win', () => {
  const plan = restorePlan({ restored, live, auditEntries, snapshotTime, secret, overwriteChanged: true });
  assert.deepEqual(paths(plan.write), ['lists/L2', 'orders/FCC-2', 'orders/FCC-3']);
  assert.deepEqual(paths(plan.erased), ['households/H1', 'lists/L1', 'memberships/M1', 'orders/FCC-1']);
});

test('a restore refuses to run without the lookup secret when people were erased since the restore point', () => {
  assert.throws(() => restorePlan({ restored, live, auditEntries, snapshotTime, secret: '' }), /AUDIT_LOOKUP_SECRET/);
  // With no erasure since the restore point no secret is needed, and a redacted live record is still never overwritten.
  assert.deepEqual(paths(restorePlan({ restored, live, auditEntries: auditEntries.slice(1), snapshotTime, secret: '' }).erased), ['orders/FCC-1']);
});
