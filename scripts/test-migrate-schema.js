// Runs scripts/migrate-schema.js against old-shape records in the Firestore emulator: dry run, apply, then a repeat run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { clubYearDates } from '../src/utils/clubYear.js';
import { CURRENT_MEMBERSHIP_VERSION } from '../src/utils/schema.js';

const PROJECT = 'demo-fcc-migration-tests';
assertLocalFirebase({ ...process.env, GCLOUD_PROJECT: PROJECT });
const db = getFirestore(initializeApp({ projectId: PROJECT }, 'migration-tests'));
const COLLECTIONS = ['memberships', 'households', 'orders', 'membershipTerms', 'counters'];

const clear = async () => {
  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
};

const migrate = async (...args) => {
  const env = { ...process.env, GCLOUD_PROJECT: PROJECT };
  delete env.STRIPE_SECRET_KEY;
  const child = spawn(process.execPath, ['scripts/migrate-schema.js', ...args], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, output);
  return output;
};

const at = (iso) => Timestamp.fromDate(new Date(iso));
const household = { contactName: 'Old Shape', contactRelationship: 'Self', email: 'old@example.test', phone: '1', address: '1 Old Road', postcode: 'EH1 1AA' };

await clear();
try {
  await db.collection('households').doc('H-OLD').set(household);
  await db.collection('orders').doc('OLD-1').set({
    status: 'paid', email: 'old@example.test', paidAt: at('2025-04-01T10:00:00Z'), total: '230',
    people: [{ id: 'p1', membershipId: 'OLD-M1', lineIds: ['m1', 'b1'] }],
    items: [{ lineId: 'm1', id: 'membership-adult', name: 'Adult membership', category: 'MEMBERSHIP', membershipTier: 'adult', price: 80 },
      { lineId: 'b1', id: 'boat-hire', name: 'Boat hire', category: 'SERVICES', type: 'yearly-service', price: 150 }]
  });
  await db.collection('orders').doc('OLD-2').set({
    status: 'paid', email: 'old@example.test', paidAt: at('2026-03-05T10:00:00Z'), total: '0', stripeSubscriptionId: 'sub_old', stripeMode: 'test',
    people: [{ id: 'p1', membershipId: 'OLD-M1', lineIds: ['m2', 'k1'] }],
    items: [{ lineId: 'm2', id: 'membership-adult', name: 'Adult membership', category: 'MEMBERSHIP', type: 'subscription', membershipTier: 'adult', clubYear: 2026, monthly: true, price: 0 },
      { lineId: 'k1', id: 'keyhire', name: 'Key hire', category: 'SERVICES', type: 'yearly-service', clubYear: 2026, price: 10 }]
  });
  await db.collection('memberships').doc('OLD-M1').set({
    schemaVersion: 3, householdId: 'H-OLD', firstName: 'Old', lastName: 'Shape', dob: '1980-01-01', source: 'website', membershipTier: 'adult',
    status: 'active', clubYears: [2025, 2026], validUntil: Timestamp.fromDate(clubYearDates(2026).end),
    privileges: [
      { productId: 'boat-hire', name: 'Boat hire', type: 'yearly-service', orderRef: 'OLD-1', lineId: 'b1', grantedAt: at('2025-04-01T10:00:00Z') },
      { productId: 'keyhire', name: 'Key hire', type: 'yearly-service', orderRef: 'OLD-2', lineId: 'k1', clubYear: 2026, grantedAt: at('2026-03-05T10:00:00Z') }
    ],
    history: [
      { orderRef: 'OLD-1', paidAt: at('2025-04-01T10:00:00Z'), items: [{ id: 'membership-adult' }, { id: 'boat-hire' }] },
      { orderRef: 'OLD-2', paidAt: at('2026-03-05T10:00:00Z'), items: [{ id: 'membership-adult' }, { id: 'keyhire' }] }
    ]
  });
  // A record already on the current version is left alone.
  await db.collection('memberships').doc('NEW-M2').set({ schemaVersion: CURRENT_MEMBERSHIP_VERSION, householdId: 'H-OLD', firstName: 'New', lastName: 'Shape',
    dob: '1982-02-02', source: 'website', status: 'active' });

  const dry = await migrate();
  assert.match(dry, /1 would be upgraded/);
  assert.match(dry, /Write membershipTerms documents/);
  assert.equal((await db.collection('membershipTerms').get()).size, 0, 'a dry run writes nothing');
  assert.ok((await db.collection('memberships').doc('OLD-M1').get()).data().privileges, 'a dry run keeps the old fields');

  await migrate('--apply');
  const member = (await db.collection('memberships').doc('OLD-M1').get()).data();
  assert.equal(member.schemaVersion, CURRENT_MEMBERSHIP_VERSION);
  assert.equal('privileges' in member, false);
  assert.equal('history' in member, false);
  assert.equal(member.stripeMembershipSubscriptionId, 'sub_old', 'the recurring membership subscription is recorded from the old order');
  assert.equal(member.keyAccess.source, 'purchase', 'key hire bought before key access was tracked still grants the code');
  assert.equal(member.status, 'active');
  assert.equal(member.validUntil.toMillis(), clubYearDates(2026).end.getTime(), 'the current term stays on the member');

  const terms = new Map((await db.collection('membershipTerms').get()).docs.map((document) => [document.id, document.data()]));
  assert.deepEqual([...terms.keys()].sort(), ['OLD-M1_2025', 'OLD-M1_2026']);
  const first = terms.get('OLD-M1_2025');
  assert.deepEqual([first.membershipId, first.clubYear, first.tier, first.source, first.orderRef], ['OLD-M1', 2025, 'adult', 'website', 'OLD-1']);
  assert.equal(first.start.toMillis(), new Date('2025-04-01T10:00:00Z').getTime());
  assert.equal(first.end.toMillis(), clubYearDates(2025).end.getTime());
  assert.deepEqual(first.items.map((item) => item.productId), ['boat-hire']);
  const second = terms.get('OLD-M1_2026');
  assert.equal(second.orderRef, 'OLD-2');
  assert.deepEqual(second.items.map((item) => [item.productId, item.lineId]), [['keyhire', 'k1']]);
  for (const ref of ['OLD-1', 'OLD-2']) {
    assert.deepEqual((await db.collection('orders').doc(ref).get()).data().membershipIds, ['OLD-M1'], `${ref} names its member`);
  }
  assert.equal((await db.collection('memberships').doc('NEW-M2').get()).data().schemaVersion, CURRENT_MEMBERSHIP_VERSION);

  const repeat = await migrate('--apply');
  assert.match(repeat, /0 upgraded/, 'a repeat run finds nothing to do');
  assert.equal((await db.collection('membershipTerms').doc('OLD-M1_2025').get()).data().items.length, 1, 'no duplicate entitlements');
  console.log('PASS: schema migration converts old-shape members to membership terms, links orders, and is safe to repeat.');
} finally {
  await clear();
}
