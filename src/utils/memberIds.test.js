import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateMemberIds, formatMemberId, membershipNumberFor } from './memberIds.js';

test('member IDs are short, padded club numbers', () => {
  assert.equal(formatMemberId(1), 'M0001');
  assert.equal(formatMemberId(250), 'M0250');
  assert.equal(formatMemberId(12345), 'M12345');
  assert.throws(() => formatMemberId(0));
});

test('membership numbers use 4 to 8 digit Paddle Scotland numbers only', () => {
  assert.equal(membershipNumberFor('1234'), 'FCC-1234');
  assert.equal(membershipNumberFor(' 12345678 '), 'FCC-12345678');
  assert.equal(membershipNumberFor('123'), '');
  assert.equal(membershipNumberFor('123456789'), '');
  assert.equal(membershipNumberFor('TEST-1'), '');
  assert.equal(membershipNumberFor(''), '');
});

const fakeDb = (counter, taken = []) => {
  const store = new Map([['counters/memberships', counter], ...taken.map((id) => [`memberships/${id}`, {}])]);
  const reference = (path) => ({ path });
  return {
    store,
    collection: (name) => ({ doc: (id) => reference(`${name}/${id}`) }),
    runTransaction: async (work) => work({
      get: async ({ path }) => ({ exists: store.has(path), data: () => store.get(path) }),
      getAll: async (...references) => references.map(({ path }) => ({ exists: store.has(path) })),
      set: ({ path }, value) => store.set(path, { ...store.get(path), ...value })
    })
  };
};

test('allocation continues the counter and skips IDs already in use', async () => {
  const db = fakeDb({ next: 7 }, ['M0008']);
  assert.deepEqual(await allocateMemberIds(db, 3), ['M0007', 'M0009', 'M0010']);
  assert.equal(db.store.get('counters/memberships').next, 11);
  assert.deepEqual(await allocateMemberIds(fakeDb(undefined), 1), ['M0001']);
  assert.deepEqual(await allocateMemberIds(db, 0), []);
});
