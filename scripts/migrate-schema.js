// Brings stored records up to the current schema version. Dry run by default: prints what would change and writes nothing.
// Add --apply to write. Safe to repeat: records already at the current version are skipped.
// Back up first (gcloud firestore export) before running with --apply against a real project.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CURRENT_MEMBERSHIP_VERSION, CURRENT_ORDER_VERSION, ORDER_MIGRATIONS, planUpgrade } from '../src/utils/schema.js';
import { householdForPerson, HOUSEHOLD_MEMBER_FIELDS, memberIsJunior, householdGroupKey } from '../src/utils/households.js';
import { allocateRecordIds } from '../src/utils/recordIds.js';
import { legacyTerms, termId } from '../src/utils/membershipTerms.js';
import { discountCodeUpgrade } from '../src/utils/discountCodes.js';
import { productUpgrade } from '../src/utils/catalogue.js';
import { PRODUCTS } from '../src/constants/products.js';
import { subscriberMembershipIds } from '../src/utils/stripeReports.js';
import { LEGACY_AUDIT_COLLECTIONS, legacyAuditEntry } from '../src/utils/auditLog.js';

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
const count = (description, amount = 1) => tally.set(description, (tally.get(description) || 0) + amount);
const sameItem = (a, b) => a.orderRef === b.orderRef && a.productId === b.productId && (a.lineId || '') === (b.lineId || '');

/** Version 4: the record's privileges and purchase history become membership terms, and its orders name the member. */
const termWrites = async (document) => {
  const fields = document.data();
  const refs = [...new Set((fields.history || []).map((entry) => entry?.orderRef).filter((ref) => typeof ref === 'string' && ref && !ref.includes('/')))];
  const orderDocuments = refs.length ? await db.getAll(...refs.map((ref) => db.collection('orders').doc(ref))) : [];
  const orders = new Map(orderDocuments.filter((order) => order.exists).map((order) => [order.id, order.data()]));
  const stripeMode = process.env.STRIPE_SECRET_KEY?.includes('_live_') ? 'live' : 'test';
  const plan = legacyTerms(document.id, fields, orders, stripeMode);
  const writes = [];
  for (const term of plan.terms) {
    const reference = db.collection('membershipTerms').doc(termId(document.id, term.clubYear));
    const existing = (await reference.get()).data();
    // Terms written by purchases made after this release are kept; only what they lack is added.
    const { items, ...membership } = term;
    const missing = items.filter((item) => !(existing?.items || []).some((held) => sameItem(held, item)));
    const fields = { membershipId: document.id, clubYear: term.clubYear, updatedAt: Timestamp.now(),
      ...(existing?.source || !('source' in membership) ? {} : membership),
      ...(missing.length ? { items: FieldValue.arrayUnion(...missing) } : {}) };
    if (existing && !missing.length && (existing.source || !('source' in membership))) continue;
    count('Write membershipTerms documents');
    writes.push(() => batch.set(reference, fields, { merge: true }));
  }
  for (const ref of plan.orderRefs.filter((id) => orders.has(id) && !(orders.get(id).membershipIds || []).includes(document.id))) {
    count('Link orders to their members (membershipIds)');
    writes.push(() => batch.update(db.collection('orders').doc(ref), { membershipIds: FieldValue.arrayUnion(document.id) }));
  }
  const memberSet = { ...(plan.stripeMembership || {}), ...(plan.keyAccess ? { keyAccess: plan.keyAccess } : {}) };
  if (plan.stripeMembership?.stripeMembershipSubscriptionId) count('Record the recurring membership subscription from old orders');
  if (plan.keyAccess) count('Record key access from key hire bought before it was tracked');
  return { writes, memberSet };
};

for (const [groupKey, group] of groups) {
  const existingIds = [...new Set(group.map((document) => document.data().householdId).filter(Boolean))];
  if (existingIds.length > 1) throw new Error(`Members in ${groupKey} already reference different households.`);
  const preferred = group.find((document) => document.data().junior !== true && document.data().householdId)
    || group.find((document) => document.data().junior !== true) || group[0];
  const fields = preferred.data();
  const householdId = existingIds[0] || (apply ? (await allocateRecordIds(db, 'households'))[0] : `dry-run-${preferred.id}`);
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
    const terms = plan && plan.from < 4 ? await termWrites(document) : { writes: [], memberSet: {} };
    if (!apply) continue;
    for (const write of terms.writes) {
      write();
      pending += 1;
      await commitIfFull();
    }
    const set = { ...(plan?.set || {}), ...terms.memberSet, householdId };
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

// Orders are read after the member pass so they include the membershipIds it links.
const orderDocuments = (await db.collection('orders').get()).docs;
const orderTally = new Map();
let ordersChanged = 0;
batch = db.batch();
pending = 0;
for (const document of orderDocuments) {
  const plan = planUpgrade(document.data(), ORDER_MIGRATIONS);
  if (!plan) continue;
  ordersChanged += 1;
  plan.descriptions.forEach((description) => orderTally.set(description, (orderTally.get(description) || 0) + 1));
  if (!apply) continue;
  batch.update(document.ref, { ...plan.set, ...Object.fromEntries(plan.remove.map((key) => [key, FieldValue.delete()])) });
  pending += 1;
  await commitIfFull();
}
if (apply && pending) await batch.commit();

console.log(`${orderDocuments.length} orders read, ${ordersChanged} ${apply ? 'upgraded' : 'would be upgraded'} to version ${CURRENT_ORDER_VERSION}.`);
for (const [description, count] of orderTally) console.log(`  ${count} x ${description}`);

// The remaining collections have no schema version: each pass converts whatever is still in the old shape.
let otherChanges = 0;
const pass = async (title, work) => {
  const passTally = new Map();
  batch = db.batch();
  pending = 0;
  const write = async (description, change, operations = 1) => {
    passTally.set(description, (passTally.get(description) || 0) + 1);
    otherChanges += 1;
    if (!apply) return;
    change(batch);
    pending += operations;
    await commitIfFull();
  };
  const read = await work(write);
  if (apply && pending) await batch.commit();
  console.log(`${title}: ${read} read, ${[...passTally.values()].reduce((sum, value) => sum + value, 0)} ${apply ? 'changes made' : 'changes would be made'}.`);
  for (const [description, amount] of passTally) console.log(`  ${amount} x ${description}`);
};
const updateWith = ({ set, remove }) => ({ ...set, ...Object.fromEntries(remove.map((key) => [key, FieldValue.delete()])) });
const changes = ({ set, remove }) => Object.keys(set).length > 0 || remove.length > 0;

// Purchases are looked up from orders (email, membershipIds, vouchers) and discountCodes (orderRef, email) instead.
await pass('Customer records (removed)', async (write) => {
  const customers = (await db.collection('customers').get()).docs;
  for (const document of customers) await write('Delete customers documents', (writer) => writer.delete(document.ref));
  return customers.length;
});

await pass('Discount codes', async (write) => {
  const codes = (await db.collection('discountCodes').get()).docs;
  for (const document of codes) {
    const upgrade = discountCodeUpgrade(document.data());
    if (changes(upgrade)) await write('Replace used/active flags and discountType with status and type', (writer) => writer.update(document.ref, updateWith(upgrade)));
  }
  return codes.length;
});

// sortOrder follows the order the shop showed: starter products first, then saved-only products by id.
await pass('Products', async (write) => {
  const products = (await db.collection('products').get()).docs;
  const starterIds = PRODUCTS.map((product) => product.id);
  const displayOrder = [...starterIds, ...products.map((document) => document.id).filter((id) => !starterIds.includes(id)).sort()];
  for (const document of products) {
    const upgrade = productUpgrade({ ...document.data(), id: document.id }, displayOrder.indexOf(document.id));
    if (changes(upgrade)) await write('Add active, sortOrder, pricingMode and allowMonthly', (writer) => writer.update(document.ref, updateWith(upgrade)));
  }
  return products.length;
});

// Mirrored subscribers keep the members they pay for instead of copies of the payer's name and email.
await pass('Stripe mirror', async (write) => {
  const subscriptions = (await db.collection('stripeSubscriptions').get()).docs;
  const customers = (await db.collection('stripeCustomers').get()).docs;
  const byCustomer = new Map();
  const mirrorUpdate = (fields, membershipIds) => ({ membershipIds: [...new Set([...(fields.membershipIds || []), ...membershipIds])],
    ...Object.fromEntries(['name', 'email'].filter((key) => key in fields).map((key) => [key, FieldValue.delete()])) });
  const needsUpgrade = (fields) => !Array.isArray(fields.membershipIds) || 'name' in fields || 'email' in fields;
  for (const document of subscriptions) {
    const fields = document.data();
    const membershipIds = needsUpgrade(fields) ? await subscriberMembershipIds(db, { id: fields.id, orderRef: fields.orderRef || '' },
      String(fields.email || '').trim().toLowerCase()) : fields.membershipIds;
    byCustomer.set(fields.clubCustomerId, [...(byCustomer.get(fields.clubCustomerId) || []), ...membershipIds]);
    if (needsUpgrade(fields)) await write('Replace stripeSubscriptions names and emails with membershipIds', (writer) => writer.update(document.ref, mirrorUpdate(fields, membershipIds)));
  }
  for (const document of customers) {
    const fields = document.data();
    if (!needsUpgrade(fields)) continue;
    const email = String(fields.email || '').trim().toLowerCase();
    const fromOrders = email ? (await db.collection('orders').where('email', '==', email).get()).docs.flatMap((order) => order.data().membershipIds || []) : [];
    await write('Replace stripeCustomers names and emails with membershipIds', (writer) => writer.update(document.ref,
      mirrorUpdate(fields, [...(byCustomer.get(document.id) || []), ...fromOrders])));
  }
  return subscriptions.length + customers.length;
});

await pass('Audit log', async (write) => {
  let read = 0;
  for (const collection of LEGACY_AUDIT_COLLECTIONS) {
    const entries = (await db.collection(collection).get()).docs;
    read += entries.length;
    for (const document of entries) {
      const { id, entry } = legacyAuditEntry(collection, document.id, document.data());
      await write(`Move ${collection} entries to auditLog`, (writer) => writer.set(db.collection('auditLog').doc(id), entry).delete(document.ref), 2);
    }
  }
  return read;
});

if (!apply && (changed || ordersChanged || otherChanges)) console.log('Dry run only. Re-run with --apply to write.');
