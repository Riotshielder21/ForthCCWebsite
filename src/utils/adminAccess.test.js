import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdminChange, adminCandidateProblem, isClubEmail, ADMIN_AUTH_RETRY_MESSAGE, retryableAdminAuthMessage, verifyAdminSession } from './adminAccess.js';

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
  assert.ok(validateAdminChange({ action: 'revoke', email: 'me@forthcanoeclub.co.uk', reason: 'Left' }, 'Me@forthcanoeclub.co.uk').error);
  assert.deepEqual(validateAdminChange({ action: 'revoke', email: 'jo@forthcanoeclub.co.uk', reason: ' Left the committee ' }, 'me@forthcanoeclub.co.uk').value,
    { action: 'revoke', email: 'jo@forthcanoeclub.co.uk', reason: 'Left the committee' });
  assert.ok(validateAdminChange({ action: 'grant', email: 'me@forthcanoeclub.co.uk' }, 'me@forthcanoeclub.co.uk').value);
});

test('removing admin access needs a reason', () => {
  for (const reason of [undefined, '', '   ', 'x'.repeat(1001)]) {
    assert.match(validateAdminChange({ action: 'revoke', email: 'jo@forthcanoeclub.co.uk', reason }, 'me@forthcanoeclub.co.uk').error, /reason/);
  }
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

test('admin session verification distinguishes retryable refresh failures from revoked access', async () => {
  const user = { email: 'admin@forthcanoeclub.co.uk', isAnonymous: false,
    getIdTokenResult: async (forceRefresh) => ({ claims: { admin: true }, forceRefresh }) };
  assert.deepEqual(await verifyAdminSession(user, true), { status: 'approved', user });
  assert.equal((await verifyAdminSession({ ...user, getIdTokenResult: async () => ({ claims: {} }) })).status, 'rejected');
  assert.equal((await verifyAdminSession({ ...user, email: 'admin@example.com' })).status, 'rejected');

  for (const code of ['auth/network-request-failed', 'auth/timeout', 'auth/too-many-requests']) {
    const failure = Object.assign(new Error('raw Firebase error'), { code });
    assert.equal(retryableAdminAuthMessage(failure), ADMIN_AUTH_RETRY_MESSAGE);
    const result = await verifyAdminSession({ ...user, getIdTokenResult: async () => { throw failure; } });
    assert.deepEqual(result, { status: 'retry', message: ADMIN_AUTH_RETRY_MESSAGE });
  }
  for (const code of ['auth/id-token-revoked', 'auth/user-disabled', 'auth/user-token-expired']) {
    assert.equal(retryableAdminAuthMessage({ code }), '');
    const result = await verifyAdminSession({ ...user, getIdTokenResult: async () => { throw Object.assign(new Error('raw Firebase error'), { code }); } });
    assert.equal(result.status, 'rejected');
    assert.doesNotMatch(result.message, /raw Firebase error/);
  }
});
