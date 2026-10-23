// Grants or removes the website `admin` claim using the Firebase Admin SDK.
//   node scripts/grant-admin.js name@forthcanoeclub.co.uk          # approve
//   node scripts/grant-admin.js name@forthcanoeclub.co.uk --revoke # remove
//   node scripts/grant-admin.js --list                             # show current admins
// Uses FIREBASE_SERVICE_ACCOUNT_PATH or ./google-service-account.json, the same credentials as server.js.
// With LOCAL_FIREBASE_EMULATORS=true (load .env.emulator) it talks to the local emulators instead.
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { adminCandidateProblem, isClubEmail } from '../src/utils/adminAccess.js';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const list = args.includes('--list');
const email = args.find((arg) => !arg.startsWith('--'))?.trim().toLowerCase();
if (!list && !email) {
  console.error('Usage: node scripts/grant-admin.js <email> [--revoke] | --list');
  process.exit(1);
}

const fail = (message) => { console.error(message); process.exit(1); };
const local = process.env.LOCAL_FIREBASE_EMULATORS === 'true';
let projectId;
if (local) {
  projectId = assertLocalFirebase(process.env);
  initializeApp({ projectId });
} else {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', 'google-service-account.json');
  if (!fs.existsSync(path)) fail(`Service account key not found at ${path}. Set FIREBASE_SERVICE_ACCOUNT_PATH.`);
  const credentials = JSON.parse(fs.readFileSync(path, 'utf8'));
  projectId = credentials.project_id;
  initializeApp({ credential: cert(credentials) });
}
const auth = getAuth();
console.log(`Project: ${projectId}${local ? ' (emulator)' : ''}`);

if (list) {
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) if (user.customClaims?.admin === true) console.log(`  ${user.email}`);
    pageToken = page.pageToken;
  } while (pageToken);
  process.exit(0);
}

if (!isClubEmail(email)) fail('Only @forthcanoeclub.co.uk accounts can be admins.');
const user = await auth.getUserByEmail(email).catch((error) => {
  if (error.code === 'auth/user-not-found') fail(`${email} has no account yet. Ask them to sign in once at /admin with Google.`);
  throw error;
});
if (!revoke) {
  const problem = adminCandidateProblem(user, { allowPasswordAccounts: local });
  if (problem) fail(problem);
} else if (user.customClaims?.admin !== true) fail(`${email} is not an admin.`);

const { admin: _previous, ...otherClaims } = user.customClaims || {};
await auth.setCustomUserClaims(user.uid, revoke ? otherClaims : { ...otherClaims, admin: true });
if (revoke) await auth.revokeRefreshTokens(user.uid);
await getFirestore().collection('adminAccessAudit').add({
  action: revoke ? 'revoke' : 'grant', email, uid: user.uid, by: 'scripts/grant-admin.js', at: Timestamp.now()
});
console.log(revoke ? `${email} is no longer an admin and has been signed out.` : `${email} is now an admin. They need to sign out and in again.`);
