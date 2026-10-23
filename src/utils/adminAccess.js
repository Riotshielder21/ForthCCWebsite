export const ADMIN_DOMAIN = 'forthcanoeclub.co.uk';

export const isClubEmail = (email) => typeof email === 'string' && email.toLowerCase().endsWith(`@${ADMIN_DOMAIN}`);

/** Checks a request to grant or remove admin access. Admins cannot remove themselves, so at least one always remains. */
export const validateAdminChange = (body = {}, actorEmail = '') => {
  const action = body.action;
  if (action !== 'grant' && action !== 'revoke') return { error: 'Choose to approve or remove admin access.' };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
  if (!isClubEmail(email)) return { error: `Only @${ADMIN_DOMAIN} accounts can be admins.` };
  if (action === 'revoke' && email === String(actorEmail).toLowerCase()) return { error: 'You cannot remove your own admin access.' };
  return { value: { action, email } };
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
  const providers = (user.providerData || []).map((provider) => provider.providerId);
  if (!providers.includes('google.com') && !(allowPasswordAccounts && providers.includes('password'))) {
    return 'That account has not signed in with Google. Ask them to sign in once at /admin with Google, then approve them.';
  }
  return '';
};
