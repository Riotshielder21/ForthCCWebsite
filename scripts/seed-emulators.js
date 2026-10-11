import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { PRODUCTS } from '../src/constants/products.js';

const projectId = assertLocalFirebase(process.env);
initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();
const uid = 'local-club-admin';
try {
  await auth.getUser(uid);
  await auth.updateUser(uid, { password: 'local-test-password' });
} catch (error) {
  if (error.code !== 'auth/user-not-found') throw error;
  await auth.createUser({ uid, email: 'admin@forthcanoeclub.co.uk', password: 'local-test-password', emailVerified: true });
}
await auth.setCustomUserClaims(uid, { admin: true });
const batch = db.batch();
for (const product of PRODUCTS) {
  const { id, ...fields } = product;
  batch.set(db.collection('products').doc(id), fields);
}
const members = db.collection('artifacts').doc('forth-canoe-default').collection('public').doc('data').collection('members');
batch.set(members.doc('test-current'), { name: 'Test Current Member', email: 'member@example.com', scaId: 'TEST-1', status: 'Active', expiry: '01/03/2099', lastUpdated: Timestamp.now() });
batch.set(members.doc('test-expired'), { name: 'Test Expired Member', scaId: 'TEST-2', status: 'Active', expiry: '01/03/2020', lastUpdated: Timestamp.now() });
for (const [id, fields] of Object.entries({
  'TEST-MEMBERSHIP': { email: 'member@example.com', status: 'paid', total: '30', items: [{ name: 'Adult membership', category: 'MEMBERSHIP', type: 'annual-oneoff', price: 30 }] },
  'TEST-SUBSCRIPTION': { email: 'subscriber@example.com', status: 'paid', total: '25', stripeSubscriptionId: 'sub_local_test', items: [{ name: 'Monthly sessions', category: 'SUBSCRIPTIONS', type: 'subscription', price: 25 }] },
  'TEST-PENDING': { email: 'pending@example.com', status: 'pending', total: '85', items: [{ name: 'Kit hire', category: 'SERVICES', type: 'annual-oneoff', price: 85 }] }
})) batch.set(db.collection('orders').doc(id), { ...fields, createdAt: Timestamp.now() });
await batch.commit();
console.log('Seeded local demo products, members, orders and test admin. No production services contacted.');