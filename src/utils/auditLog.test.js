import test from 'node:test';
import assert from 'node:assert/strict';
import { auditEntry, legacyAuditEntry, requiredReason } from './auditLog.js';

const at = new Date('2026-05-01T10:00:00Z');

test('a destructive action needs a non-blank reason of up to 1000 characters', () => {
  assert.equal(requiredReason({ reason: '  Duplicate order  ' }), 'Duplicate order');
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 42 }, { reason: 'x'.repeat(1001) }, null]) assert.equal(requiredReason(body), '');
});

test('audit entries share kind, action, reason, actor and time; routine actions get a generated reason', () => {
  assert.deepEqual(auditEntry({ kind: 'deletion', action: 'delete-record', reason: ' Test order ', actor: { uid: 'u1', email: 'a@forthcanoeclub.co.uk' }, at, recordId: 'FCC-1' }),
    { kind: 'deletion', action: 'delete-record', reason: 'Test order', by: 'a@forthcanoeclub.co.uk', byUid: 'u1', at, recordId: 'FCC-1' });
  assert.equal(auditEntry({ kind: 'access', action: 'grant-admin', actor: { uid: 'u1' }, at }).reason, 'Granted admin access');
  assert.deepEqual(auditEntry({ kind: 'subscription', action: 'volunteer-price-change', actor: 'volunteer-benefits', at }).by, 'volunteer-benefits');
  assert.throws(() => auditEntry({ kind: 'deletion', action: 'delete-record', reason: ' ', actor: 'x', at }));
  assert.throws(() => auditEntry({ kind: 'other', action: 'x', reason: 'y', actor: 'x', at }));
});

test('old audit entries move into one log with a kind, action, actor, time and reason', () => {
  assert.deepEqual(legacyAuditEntry('adminSubscriptionAudit', 's1', { adminUid: 'u1', adminEmail: 'a@x', action: 'cancel-items', stripeSubscriptionId: 'sub_1', orderRefs: ['FCC-1'], lineIds: ['l1'], reason: '', checkedAt: at }), {
    id: 'subscription_s1', entry: { kind: 'subscription', action: 'cancel-items', reason: 'Recorded before reasons were required', by: 'a@x', byUid: 'u1', at, stripeSubscriptionId: 'sub_1', orderRefs: ['FCC-1'], lineIds: ['l1'] }
  });
  assert.equal(legacyAuditEntry('adminSubscriptionAudit', 'i', { action: 'cancel-immediately', checkedAt: at.toISOString() }).entry.at.getTime(), at.getTime());
  assert.equal(legacyAuditEntry('adminSubscriptionAudit', 'v', { action: 'volunteer-price-change', adminUid: 'u', checkedAt: at }).entry.reason, 'Volunteer price applied to the monthly payment');
  const deletion = legacyAuditEntry('adminDeletionAudit', 'd1', { kind: 'orders', adminUid: 'u1', recordId: 'FCC-1', summary: {}, lookupKeys: ['k'], createdAt: at, personalDataErased: false });
  assert.deepEqual(deletion, { id: 'deletion_d1', entry: { kind: 'deletion', action: 'delete-record', recordKind: 'orders', reason: 'Recorded before reasons were required', by: 'u1', byUid: 'u1', at,
    recordId: 'FCC-1', summary: {}, lookupKeys: ['k'], personalDataErased: false } });
  const erasure = legacyAuditEntry('adminDeletionAudit', 'g1', { kind: 'gdpr-erasure', adminUid: 'u1', createdAt: at });
  assert.equal(erasure.entry.action, 'gdpr-erasure');
  assert.equal('recordKind' in erasure.entry, false);
  const item = legacyAuditEntry('adminItemAudit', 'op-1', { action: 'revoke', reason: 'Refunded', orderRef: 'FCC-1', lineId: 'l1', operationId: 'op-1', by: 'a@x', status: 'complete', at });
  assert.deepEqual(item, { id: 'item_op-1', entry: { kind: 'item', action: 'revoke', reason: 'Refunded', by: 'a@x', byUid: '', at, orderRef: 'FCC-1', lineId: 'l1', operationId: 'op-1', status: 'complete' } });
  assert.deepEqual(legacyAuditEntry('adminAccessAudit', 'a1', { action: 'grant', email: 'b@x', uid: 'u2', by: 'a@x', at }).entry,
    { kind: 'access', action: 'grant-admin', reason: 'Granted admin access', by: 'a@x', byUid: '', at, email: 'b@x', uid: 'u2' });
  assert.equal(legacyAuditEntry('adminAccessAudit', 'a2', { action: 'revoke', by: 'a@x', at }).entry.action, 'revoke-admin');
});
