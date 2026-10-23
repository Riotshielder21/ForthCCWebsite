import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdminChange, adminCandidateProblem, isClubEmail } from './adminAccess.js';

test('club email checks require the exact FCC domain and a single nonempty local part', () => {
  assert.equal(isClubEmail('Jo@ForthCanoeClub.co.uk'), true);
  for (const email of [
    undefined, null, {}, '', '@forthcanoeclub.co.uk', 'jo@gmail.com',
    'jo@sub.forthcanoeclub.co.uk', 'jo@forthcanoeclub.co.uk.evil.com',
    'jo@evilforthcanoeclub.co.uk', 'jo@evil.com@forthcanoeclub.co.uk',
    ' jo@forthcanoeclub.co.uk', 'jo@forthcanoeclub.co.uk\n'
  ]) assert.equal(isClubEmail(email), false, String(email));
});

test('an admin change needs an action and a club email', () => {
  assert.deepEqual(validateAdminChange({ action: 'grant', email: ' Jo@ForthCanoeClub.co.uk ' }).value, { action: 'grant', email: 'jo@forthcanoeclub.co.uk' });
  assert.ok(validateAdminChange({ action: 'promote', email: 'jo@forthcanoeclub.co.uk' }).error);
  assert.ok(validateAdminChange({ action: 'grant', email: 'jo@gmail.com' }).error);
  assert.ok(validateAdminChange({ action: 'grant', email: 'jo@forthcanoeclub.co.uk.evil.com' }).error);
  assert.ok(validateAdminChange({ action: 'grant', email: 'not an email' }).error);
  assert.ok(validateAdminChange({ action: 'grant' }).error);
});

test('admins cannot remove themselves', () => {
  assert.ok(validateAdminChange({ action: 'revoke', email: 'me@forthcanoeclub.co.uk' }, 'Me@forthcanoeclub.co.uk').error);
  assert.ok(validateAdminChange({ action: 'revoke', email: 'jo@forthcanoeclub.co.uk' }, 'me@forthcanoeclub.co.uk').value);
  assert.ok(validateAdminChange({ action: 'grant', email: 'me@forthcanoeclub.co.uk' }, 'me@forthcanoeclub.co.uk').value);
});

test('only verified Google sign-ins on the club domain can be approved', () => {
  const google = { email: 'jo@forthcanoeclub.co.uk', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
  assert.equal(adminCandidateProblem(google), '');
  assert.ok(adminCandidateProblem(null));
  assert.ok(adminCandidateProblem({ ...google, disabled: true }));
  assert.ok(adminCandidateProblem({ ...google, emailVerified: false }));
  assert.ok(adminCandidateProblem({ ...google, email: 'jo@gmail.com' }));
  for (const providerId of ['evilgoogle.com', 'google.com.evil.com', 'https://google.com', 'https://evil.com/google.com']) {
    assert.ok(adminCandidateProblem({ ...google, providerData: [{ providerId }] }), providerId);
  }
  assert.ok(adminCandidateProblem({ ...google, providerData: [] }));
  assert.ok(adminCandidateProblem({ ...google, providerData: undefined }));
  assert.equal(adminCandidateProblem({ ...google, providerData: [{ providerId: 'password' }, { providerId: 'google.com' }] }), '');
  const password = { ...google, providerData: [{ providerId: 'password' }] };
  assert.ok(adminCandidateProblem(password));
  assert.equal(adminCandidateProblem(password, { allowPasswordAccounts: true }), '');
  assert.ok(adminCandidateProblem({ ...password, email: 'jo@gmail.com' }, { allowPasswordAccounts: true }));
});
