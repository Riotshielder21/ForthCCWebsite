import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDetailsUpdate, changedFields, managedByJustgo } from './myDetails.js';

test('contact updates need phone and address, and an emergency contact when the household has one', () => {
  const body = { phone: ' 0770 ', address: '1 Road', postcode: 'EH1', emergencyContact: { name: 'Bo', relationship: 'Friend', phone: '0771' }, email: 'ignored@example.test' };
  assert.deepEqual(validateDetailsUpdate(body, { emergencyContact: {} }).value,
    { phone: '0770', address: '1 Road', postcode: 'EH1', emergencyContact: { name: 'Bo', relationship: 'Friend', phone: '0771' } });
  assert.equal(validateDetailsUpdate(body, { emergencyContact: null }).value.emergencyContact, undefined, 'junior households use the guardian');
  assert.ok(validateDetailsUpdate({ ...body, phone: '' }, {}).error);
  assert.ok(validateDetailsUpdate({ ...body, emergencyContact: { name: 'Bo' } }, { emergencyContact: {} }).error);
});

test('only changed field names are audited', () => {
  assert.deepEqual(changedFields({ phone: '1', address: 'a' }, { phone: '2', address: 'a' }), ['phone']);
});

test('JustGo-managed members update their details in JustGo', () => {
  assert.equal(managedByJustgo({ justgoSyncStatus: 'synced' }), true);
  assert.equal(managedByJustgo({ renewalMethod: 'justgo' }), true);
  assert.equal(managedByJustgo({ renewalMethod: 'website', justgoSyncStatus: 'pending' }), false);
});
