// One-off: copy the legacy JustGo member register (artifacts/<app>/public/data/members) into the single
// memberships collection. Dry run by default; add --apply to write. Safe to repeat: it merges and never
// overwrites fields a record already has.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { reportDate } from '../src/utils/adminReports.js';

const apply = process.argv.includes('--apply');
const appId = process.env.FCC_APP_ID || 'forth-canoe-default';
initializeApp(process.env.GCLOUD_PROJECT ? { projectId: process.env.GCLOUD_PROJECT } : undefined);
const db = getFirestore();

const legacy = await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('members').get();
const existing = new Map();
for (const document of (await db.collection('memberships').get()).docs) {
  const { scaNumber } = document.data();
  if (scaNumber) existing.set(String(scaNumber), document);
}

let created = 0;
let merged = 0;
let batch = db.batch();
let pending = 0;
for (const document of legacy.docs) {
  const old = document.data();
  const scaNumber = String(old.scaId || document.id);
  const parts = String(old.name || '').trim().split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts.pop() : '';
  const firstName = parts.join(' ');
  const expiry = reportDate(old.expiry);
  const target = existing.get(scaNumber);
  const current = target?.data() || {};
  const fields = {
    scaNumber, justgoSyncStatus: 'synced', renewalMethod: 'justgo', updatedAt: Timestamp.now(),
    ...(!current.validUntil && expiry ? { validUntil: Timestamp.fromDate(new Date(expiry)) } : {}),
    ...(!current.status ? { status: !expiry || new Date(expiry) >= new Date() ? 'active' : 'expired' } : {}),
    ...(!current.firstName && firstName ? { firstName } : {}),
    ...(!current.lastName && lastName ? { lastName } : {}),
    ...(!current.email && old.email ? { email: String(old.email).trim().toLowerCase() } : {}),
    ...(!target ? { source: 'justgo', createdAt: Timestamp.now() } : {})
  };
  fields.searchName = `${fields.firstName || current.firstName || ''} ${fields.lastName || current.lastName || ''}`.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  if (target) merged += 1; else created += 1;
  if (apply) {
    batch.set(target?.ref || db.collection('memberships').doc(`sca-${scaNumber}`), fields, { merge: true });
    pending += 1;
    if (pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
}
if (apply && pending) await batch.commit();
console.log(`${apply ? 'Migrated' : 'Dry run:'} ${legacy.size} legacy members (${created} new records, ${merged} merged into existing).${apply ? '' : ' Re-run with --apply to write.'}`);
process.exit(0);
