// Creates (or resets) the emulator-only "local test admin" account used by the Admin sign-in button. No other data.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';

export const LOCAL_ADMIN = { uid: 'local-club-admin', email: 'admin@forthcanoeclub.co.uk', password: 'local-test-password' };

export const ensureLocalAdmin = async (auth) => {
  const { uid, email, password } = LOCAL_ADMIN;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password });
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    await auth.createUser({ uid, email, password, emailVerified: true });
  }
  await auth.setCustomUserClaims(uid, { admin: true });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  initializeApp({ projectId: assertLocalFirebase(process.env) });
  await ensureLocalAdmin(getAuth());
  console.log(`Local test admin ready: ${LOCAL_ADMIN.email}`);
}
