import test from 'node:test';
import assert from 'node:assert/strict';
import { deletionAuditEntry, lookupKey, maskEmail, maskMembershipNumber, maskName, personLookupKeys } from './privacy.js';

const secret = 'test-secret';

test('names, emails and membership numbers are masked for display', () => {
  assert.equal(maskName('  John  Smith '), 'J*** S***');
  assert.equal(maskName(''), '');
  assert.equal(maskEmail('John.Smith@example.co.uk'), 'j***@e***.co.uk');
  assert.equal(maskEmail('not an email'), '***');
  assert.equal(maskMembershipNumber('PS123456'), '***456');
  assert.equal(maskMembershipNumber('A1'), '***');
  assert.equal(maskMembershipNumber(''), '');
});

test('lookup keys ignore case and spacing but depend on the secret and the kind', () => {
  assert.equal(lookupKey(secret, 'email', ' Jo@Example.com '), lookupKey(secret, 'email', 'jo@example.com'));
  assert.equal(lookupKey(secret, 'name-dob', 'Jo  Lee|2012-03-04'), lookupKey(secret, 'name-dob', 'jo lee|2012-03-04'));
  assert.notEqual(lookupKey(secret, 'email', 'a@b.co'), lookupKey('other', 'email', 'a@b.co'));
  assert.notEqual(lookupKey(secret, 'email', 'x'), lookupKey(secret, 'affiliation', 'x'));
  assert.deepEqual(personLookupKeys(secret, { firstName: 'Jo' }), []);
  assert.equal(personLookupKeys(secret, { email: 'a@b.co', firstName: 'Jo', lastName: 'Lee', dob: '2012-03-04', affiliationNumber: 'PS1' }).length, 3);
});

test('a deleted member is summarised without personal details and keeps a hidden snapshot', () => {
  const fields = { firstName: 'Jo', lastName: 'Lee', email: 'jo@example.com', dob: '1990-01-02', affiliationNumber: 'PS123456', membershipTier: 'adult', status: 'active', phone: '0777' };
  const entry = deletionAuditEntry({ kind: 'members', id: 'MEM-1', fields, secret, adminUid: 'admin1' });
  assert.deepEqual(entry.summary, { label: 'Member', maskedName: 'J*** L***', maskedEmail: 'j***@e***.com', membershipNumber: '***456', tier: 'adult', status: 'active', validUntil: null });
  assert.equal(entry.recordId, null);
  assert.equal(entry.snapshot, fields);
  assert.equal(entry.personalDataErased, false);
  assert.ok(entry.lookupKeys.includes(lookupKey(secret, 'email', 'jo@example.com')));
  assert.ok(entry.lookupKeys.includes(lookupKey(secret, 'name-dob', 'Jo Lee|1990-01-02')));
  assert.ok(entry.lookupKeys.includes(lookupKey(secret, 'affiliation', 'PS123456')));
  assert.equal(JSON.stringify(entry.summary).includes('jo@example.com'), false);
});

test('a deleted order keeps its reference, amount and items but masks every person', () => {
  const fields = { email: 'Payer@Example.com', total: '65', status: 'paid', items: [{ name: 'Club tee', size: 'M' }, { name: 'Adult membership' }],
    people: [{ firstName: 'Kit', lastName: 'Lee', dob: '2015-05-05', junior: true, guardian: { email: 'parent@example.com' }, email: '' }, { firstName: 'Al', lastName: 'Lee', dob: '1980-01-01', email: 'al@example.com' }] };
  const entry = deletionAuditEntry({ kind: 'orders', id: 'FCC-ABC', fields, secret, adminUid: 'admin1', stripeAcknowledged: true });
  assert.equal(entry.recordId, 'FCC-ABC');
  assert.equal(entry.summary.total, 65);
  assert.deepEqual(entry.summary.items, ['Club tee (M)', 'Adult membership']);
  assert.deepEqual(entry.summary.people, [{ name: 'K*** L***', email: 'p***@e***.com' }, { name: 'A*** L***', email: 'a***@e***.com' }]);
  assert.equal(entry.summary.maskedEmail, 'p***@e***.com');
  for (const email of ['payer@example.com', 'parent@example.com', 'al@example.com']) assert.ok(entry.lookupKeys.includes(lookupKey(secret, 'email', email)), email);
  assert.ok(entry.lookupKeys.includes(lookupKey(secret, 'name-dob', 'Kit Lee|2015-05-05')));
  assert.equal(entry.stripeAcknowledged, true);
});
