import { Firestore, Timestamp } from '@google-cloud/firestore';
import { execFileSync } from 'node:child_process';
import { google } from 'googleapis';

const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error('Set GCLOUD_PROJECT to the intended Firebase project.');
const apply = process.argv.includes('--apply');
const authClient = process.argv.includes('--gcloud') ? new google.auth.OAuth2() : undefined;
if (authClient) authClient.setCredentials({
  access_token: execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim(),
  expiry_date: Date.now() + 55 * 60 * 1000
});
const db = new Firestore({ projectId, ...(authClient ? { authClient } : {}) });

for (const collection of ['emailCodes', 'emailSessions']) {
  let cursor;
  let count = 0;
  do {
    let query = db.collection(collection).orderBy('__name__').limit(400);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const batch = db.batch();
    for (const document of page.docs) {
      const data = document.data();
      if (data.ttlAt instanceof Timestamp) continue;
      if (!Number.isFinite(data.expiresAt)) throw new Error(`${collection} contains an invalid expiry; migration stopped.`);
      const expiresAt = collection === 'emailCodes'
        ? Math.max(data.expiresAt, (data.windowStart || 0) + 60 * 60 * 1000) : data.expiresAt;
      batch.update(document.ref, { ttlAt: Timestamp.fromMillis(expiresAt) }, { lastUpdateTime: document.updateTime });
      count += 1;
    }
    if (apply) await batch.commit();
    cursor = page.docs.at(-1);
  } while (cursor);
  console.log(`${collection}: ${count} ${apply ? 'updated' : 'would be updated (dry run)'}.`);
}
