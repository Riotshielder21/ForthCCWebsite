import { requiredReason } from './auditLog.js';

export const ADMIN_DOMAIN = 'forthcanoeclub.co.uk';

export const isClubEmail = (email) => {
  if (typeof email !== 'string' || /\s/.test(email)) return false;
  const parts = email.toLowerCase().split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1] === ADMIN_DOMAIN;
};

const RETRYABLE_AUTH_CODES = new Set(['auth/network-request-failed', 'auth/timeout', 'auth/too-many-requests']);
export const ADMIN_AUTH_RETRY_MESSAGE = 'Firebase could not refresh your admin session. Check your connection and retry. Local page edits have been kept in this browser.';
export const retryableAdminAuthMessage = (error) => RETRYABLE_AUTH_CODES.has(error?.code) ? ADMIN_AUTH_RETRY_MESSAGE : '';

export const verifyAdminSession = async (user, forceRefresh = false) => {
  if (!user || user.isAnonymous) return { status: 'rejected', message: 'Sign in with an approved website editor account.' };
  try {
    const token = await user.getIdTokenResult(forceRefresh);
    if (token.claims.admin === true && isClubEmail(user.email)) return { status: 'approved', user };
    return { status: 'rejected', message: 'This account is not an approved website editor.' };
  } catch (error) {
    const retryMessage = retryableAdminAuthMessage(error);
    if (retryMessage) return { status: 'retry', message: retryMessage };
    return { status: 'rejected', message: 'Your admin session has expired or been revoked. Sign in again.' };
  }
};

/**
 * Checks a request to grant or remove admin access. Admins cannot remove themselves, so at least one always remains,
 * and removing someone needs a reason.
 */
export const validateAdminChange = (body = {}, actorEmail = '') => {
  const action = body.action;
  if (action !== 'grant' && action !== 'revoke') return { error: 'Choose to approve or remove admin access.' };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
  if (!isClubEmail(email)) return { error: `Only @${ADMIN_DOMAIN} accounts can be admins.` };
  if (action === 'revoke' && email === String(actorEmail).toLowerCase()) return { error: 'You cannot remove your own admin access.' };
  if (action === 'grant') return { value: { action, email } };
  const reason = requiredReason(body);
  return reason ? { value: { action, email, reason } } : { error: 'Enter a reason for removing admin access (up to 1000 characters).' };
};

/**
 * Only an account that has signed in with Google (so the email is proven to belong to the club Workspace)
 * can be approved. The local emulators use a password account instead.
 */
export const adminCandidateProblem = (user, { allowPasswordAccounts = false } = {}) => {
  if (!user) return 'No account found. Ask them to sign in once at /admin with Google, then approve them.';
  if (!isClubEmail(user.email)) return `Only @${ADMIN_DOMAIN} accounts can be admins.`;
  if (user.disabled) return 'That account is disabled.';
  if (!user.emailVerified) return 'That account has not verified its email address.';
  const providers = user.providerData || [];
  const hasGoogle = providers.some((provider) => provider.providerId === 'google.com');
  const hasLocalPassword = allowPasswordAccounts && providers.some((provider) => provider.providerId === 'password');
  if (!hasGoogle && !hasLocalPassword) {
    return 'That account has not signed in with Google. Ask them to sign in once at /admin with Google, then approve them.';
  }
  return '';
};
