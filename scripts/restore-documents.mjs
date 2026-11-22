// Copies documents from a restored database (a point-in-time clone or a restored backup) back into the live one.
// Dry run by default: prints what would change and writes nothing. Add --apply to write. Anyone erased since the restore
// point stays erased. See DEPLOYMENT.md → Backups and restore.
import { Firestore } from '@google-cloud/firestore';
import { execFileSync } from 'node:child_process';
import { google } from 'googleapis';
import { restorePlan } from '../src/utils/restorePlan.js';

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const options = (name) => process.argv.filter((_value, index) => process.argv[index - 1] === name);
const projectId = process.env.GCLOUD_PROJECT;
const from = process.argv.includes('--from') ? option('--from') : '';
const snapshotTime = process.argv.includes('--snapshot-time') ? option('--snapshot-time') : '';
const collections = options('--collection');
if (!projectId || !from || Number.isNaN(Date.parse(snapshotTime)) || (!collections.length && !process.argv.includes('--all'))) {
  console.error('Usage: GCLOUD_PROJECT=project [AUDIT_LOOKUP_SECRET=secret] node scripts/restore-documents.mjs --from DATABASE'
    + ' --snapshot-time ISO_TIME (--collection NAME ... | --all) [--overwrite-changed] [--gcloud] [--apply]');
  process.exit(1);
}
if (from === '(default)') throw new Error('Restore from a separate restored database, never from the live one.');
const apply = process.argv.includes('--apply');
const authClient = process.argv.includes('--gcloud') ? new google.auth.OAuth2() : undefined;
if (authClient) authClient.setCredentials({
  access_token: execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim(),
  expiry_date: Date.now() + 55 * 60 * 1000
});
const source = new Firestore({ projectId, databaseId: from, ...(authClient ? { authClient } : {}) });
const live = new Firestore({ projectId, ...(authClient ? { authClient } : {}) });

const names = collections.length ? collections : (await source.listCollections()).map((collection) => collection.id);
const restored = [];
for (const name of names) {
  for (const document of (await source.collection(name).get()).docs) restored.push({ path: document.ref.path, data: document.data() });
}
const current = new Map();
for (let start = 0; start < restored.length; start += 300) {
  const snapshots = await live.getAll(...restored.slice(start, start + 300).map(({ path }) => live.doc(path)));
  snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => current.set(snapshot.ref.path, { data: snapshot.data(), updateTime: snapshot.updateTime }));
}
const auditEntries = (await live.collection('auditLog').where('action', '==', 'gdpr-erasure').get()).docs.map((document) => document.data());
const plan = restorePlan({ restored, live: current, auditEntries, snapshotTime, secret: process.env.AUDIT_LOOKUP_SECRET,
  overwriteChanged: process.argv.includes('--overwrite-changed') });

const byCollection = (documents) => Object.entries(documents.reduce((counts, document) => {
  const collection = (document.path || document).split('/').at(-2);
  return { ...counts, [collection]: (counts[collection] || 0) + 1 };
}, {})).map(([collection, count]) => `${collection} ${count}`).join(', ') || 'none';
console.log(`Restoring from ${from} at ${snapshotTime}; erasures since then: ${plan.erasuresSince}.`);
console.log(`To write: ${byCollection(plan.write)}`);
console.log(`Unchanged: ${byCollection(plan.unchanged)}`);
console.log(`Kept out because the person was erased since: ${byCollection(plan.erased)}`);
console.log(`Changed since the restore point, left as they are (--overwrite-changed to replace): ${plan.changed.join(', ') || 'none'}`);
if (!apply) {
  console.log('Dry run only. Re-run with --apply to write.');
  process.exit(0);
}
for (let start = 0; start < plan.write.length; start += 400) {
  const batch = live.batch();
  plan.write.slice(start, start + 400).forEach(({ path, data }) => batch.set(live.doc(path), data));
  await batch.commit();
}
console.log(`Wrote ${plan.write.length} documents.`);
