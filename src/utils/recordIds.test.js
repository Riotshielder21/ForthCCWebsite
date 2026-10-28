import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateRecordIds, formatRecordId, RECORD_ID_TYPES, reserveRecordIds } from './recordIds.js';

const fakeDb = (entries = []) => {
  const store = new Map(entries);
  const writes = [];
  const transaction = {
    get: async ({ path }) => ({ data: () => store.get(path) }),
    getAll: async (...refs) => refs.map(({ path }) => ({ exists: store.has(path) })),
    set: ({ path }, value) => { store.set(path, value); writes.push(path); }
  };
  const db = {
    collection: (collection) => ({ doc: (id) => ({ path: `${collection}/${id}` }) }),
    runTransaction: (work) => work(transaction)
  };
  return { db, store, writes, transaction };
};

test('record IDs have distinct prefixes, minimum padding, and grow without truncation', () => {
  for (const [type, { prefix, digits }] of Object.entries(RECORD_ID_TYPES)) {
    assert.equal(formatRecordId(type, 1), `${prefix}${'1'.padStart(digits, '0')}`);
    assert.equal(formatRecordId(type, 123456), `${prefix}123456`);
  }
  for (const number of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatRecordId('households', number));
  }
  assert.throws(() => formatRecordId('orders', 1));
});

test('allocation skips existing IDs and advances the persistent counter across reservations', async () => {
  const { db, store } = fakeDb([['counters/households', { next: 7 }], ['households/H00008', {}]]);
  assert.deepEqual(await allocateRecordIds(db, 'households', 3), ['H00007', 'H00009', 'H00010']);
  assert.deepEqual(await allocateRecordIds(db, 'households'), ['H00011']);
  assert.equal(store.get('counters/households').next, 12);
});

test('each staff-facing record type has an independent counter and checks its target collection', async () => {
  const { db, store } = fakeDb([['lists/V00001', {}], ['lists/L00001', {}]]);
  assert.deepEqual(await allocateRecordIds(db, 'volunteers'), ['V00002']);
  assert.deepEqual(await allocateRecordIds(db, 'lists'), ['L00002']);
  assert.deepEqual(await allocateRecordIds(db, 'forms'), ['F00001']);
  assert.deepEqual(await allocateRecordIds(db, 'formSubmissions'), ['R00001']);
  assert.deepEqual(await allocateRecordIds(db, 'products'), ['P00001']);
  assert.equal(store.get('counters/volunteers').next, 3);
});

test('transaction reservations defer writes until all other reads are complete', async () => {
  const { db, transaction, writes } = fakeDb();
  const reservation = await reserveRecordIds(db, transaction, 'households', 2);
  assert.deepEqual(reservation.ids, ['H00001', 'H00002']);
  assert.deepEqual(writes, []);
  reservation.save();
  assert.deepEqual(writes, ['counters/households']);
});

test('invalid requests and corrupt counters fail explicitly; zero reservations write nothing', async () => {
  const { db, writes } = fakeDb();
  assert.deepEqual(await allocateRecordIds(db, 'households', 0), []);
  assert.deepEqual(writes, []);
  for (const count of [-1, 51, 1.5]) await assert.rejects(allocateRecordIds(db, 'households', count));
  await assert.rejects(allocateRecordIds(db, 'orders'));
  for (const next of [0, -1, '1', 1.5]) {
    await assert.rejects(allocateRecordIds(fakeDb([['counters/households', { next }]]).db, 'households'));
  }
});
