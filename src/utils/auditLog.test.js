import test from 'node:test';
import assert from 'node:assert/strict';
import { auditEntry, requiredReason } from './auditLog.js';

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
