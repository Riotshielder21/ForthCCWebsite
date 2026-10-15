import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_MEMBERSHIP_VERSION, planUpgrade } from './schema.js';

test('an old membership number is renamed and contact details are marked for household migration', () => {
  const plan = planUpgrade({ firstName: 'Jo', scaNumber: 'PS123' });
  assert.deepEqual([plan.from, plan.to], [1, CURRENT_MEMBERSHIP_VERSION]);
  assert.deepEqual(plan.set, { affiliationNumber: 'PS123', schemaVersion: CURRENT_MEMBERSHIP_VERSION });
  assert.deepEqual(plan.remove, ['scaNumber']);
});

test('legacy scaId is used when scaNumber is missing and an existing affiliationNumber wins', () => {
  assert.equal(planUpgrade({ scaId: 'L1' }).set.affiliationNumber, 'L1');
  assert.equal(planUpgrade({ affiliationNumber: 'PS9', scaNumber: 'PS1' }).set.affiliationNumber, 'PS9');
});

test('household migration removes person-level contact and checkout-only fields', () => {
  const plan = planUpgrade({ schemaVersion: 2, email: 'parent@example.com', phone: '1', guardian: {}, emergencyContact: {},
    emergencyNote: 'Parents', photoConsent: true, familyGroup: 'f1', junior: true, returning: true, disclaimerAccepted: true });
  assert.equal(plan.to, 3);
  assert.deepEqual(plan.set.consents.photoVideo, { accepted: true, legacyUnversioned: true, recordedAt: null, by: 'guardian' });
  assert.deepEqual(plan.remove, ['email', 'phone', 'guardian', 'emergencyContact', 'emergencyNote', 'photoConsent', 'familyGroup', 'junior', 'returning', 'disclaimerAccepted']);
});

test('a record without any number is only stamped, and a current record needs nothing', () => {
  const plan = planUpgrade({ firstName: 'Jo' });
  assert.deepEqual(plan.set, { schemaVersion: CURRENT_MEMBERSHIP_VERSION });
  assert.deepEqual(plan.remove, []);
  assert.equal(planUpgrade({ firstName: 'Jo', schemaVersion: CURRENT_MEMBERSHIP_VERSION }), null);
});

test('steps run in order from the record version and a field a later step sets is never removed', () => {
  const migrations = [
    { to: 2, description: 'one', upgrade: () => ({ set: { a: 1 }, remove: ['old'] }) },
    { to: 3, description: 'two', upgrade: (fields) => ({ set: { b: fields.a + 1 }, remove: ['a'] }) }
  ];
  assert.deepEqual(planUpgrade({ old: true }, migrations).set, { a: 1, b: 2, schemaVersion: 3 });
  assert.deepEqual(planUpgrade({ old: true }, migrations).remove, ['old']);
  assert.deepEqual(planUpgrade({ schemaVersion: 2, a: 5 }, migrations).set, { b: 6, schemaVersion: 3 });
});
