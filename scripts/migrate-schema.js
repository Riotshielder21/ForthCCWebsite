// Brings stored records up to the current schema version. Dry run by default: prints what would change and writes nothing.
// Add --apply to write. Safe to repeat: records already at the current version are skipped.
// Back up first (gcloud firestore export) before running with --apply against a real project.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CURRENT_MEMBERSHIP_VERSION, planUpgrade } from '../src/utils/schema.js';
import { householdForPerson, HOUSEHOLD_MEMBER_FIELDS, memberIsJunior, householdGroupKey } from '../src/utils/households.js';
import crypto from 'node:crypto';

const apply = process.argv.includes('--apply');
initializeApp(process.env.GCLOUD_PROJECT ? { projectId: process.env.GCLOUD_PROJECT } : undefined);
const db = getFirestore();

const documents = (await db.collection('memberships').get()).docs;
const groups = new Map();
for (const document of documents) {
  const fields = document.data();
  const groupingKey = householdGroupKey({ ...fields, id: document.id });
  const group = groups.get(groupingKey) || [];
  group.push(document);
  groups.set(groupingKey, group);
}

let changed = 0;
let batch = db.batch();
let pending = 0;
const tally = new Map();
const commitIfFull = async () => {
  if (pending < 400) return;
  await batch.commit();
  batch = db.batch();
  pending = 0;
};

for (const [groupKey, group] of groups) {
  const existingIds = [...new Set(group.map((document) => document.data().householdId).filter(Boolean))];
  if (existingIds.length > 1) throw new Error(`Members in ${groupKey} already reference different households.`);
  const preferred = group.find((document) => document.data().junior !== true && document.data().householdId)
    || group.find((document) => document.data().junior !== true) || group[0];
  const fields = preferred.data();
  const householdId = existingIds[0] || `HH-${crypto.createHash('sha256').update(groupKey).digest('hex').slice(0, 32)}`;
  const householdRef = db.collection('households').doc(householdId);
  const householdExists = (await householdRef.get()).exists;
  if (!householdExists) {
    const household = householdForPerson(fields, householdId, Timestamp.now());
    if (memberIsJunior(fields) && ![household.contactName, household.email, household.phone, household.address, household.postcode].every(Boolean)) {
      throw new Error(`Under-18 member ${preferred.id} has incomplete parent/guardian details. Correct the record before applying this migration.`);
    }
    changed += 1;
    tally.set('Create household records', (tally.get('Create household records') || 0) + 1);
    if (apply) {
      const { id: _id, ...householdFields } = household;
      batch.set(householdRef, householdFields, { merge: true });
      pending += 1;
      await commitIfFull();
    }
  }
  for (const document of group) {
    const plan = planUpgrade(document.data());
    const current = document.data();
    const mustLink = current.householdId !== householdId;
    const mustClean = HOUSEHOLD_MEMBER_FIELDS.some((key) => key in current);
    if (!plan && !mustLink && !mustClean) continue;
    changed += 1;
    plan?.descriptions.forEach((description) => tally.set(description, (tally.get(description) || 0) + 1));
    if (!apply) continue;
    const set = { ...(plan?.set || {}), householdId };
    const remove = new Set(plan?.remove || []);
    HOUSEHOLD_MEMBER_FIELDS.forEach((key) => { if (key in current) remove.add(key); });
    batch.update(document.ref, { ...set, ...Object.fromEntries([...remove].map((key) => [key, FieldValue.delete()])) });
    pending += 1;
    await commitIfFull();
  }
}
if (apply && pending) await batch.commit();

console.log(`${documents.length} member records read, ${changed} ${apply ? 'upgraded' : 'would be upgraded'} to version ${CURRENT_MEMBERSHIP_VERSION}.`);
for (const [description, count] of tally) console.log(`  ${count} x ${description}`);
if (!apply && changed) console.log('Dry run only. Re-run with --apply to write.');
