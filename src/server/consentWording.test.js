import test from 'node:test';
import assert from 'node:assert/strict';
import { publishConsentWording } from './consentWording.js';
import { loadConsentWording, syncPolicies } from './policies.js';
import { policyHash } from '../utils/policies.js';
import { tickWording } from '../constants/consentWording.js';

const admin = { uid: 'editor-1', email: 'editor@example.test' };
const statement = { label: 'I agree', body: 'The updated participation wording.' };
const policyPath = 'policies/participation-disclaimer';

// Stage transaction writes so a failed commit leaves every document unchanged.
const fakeDb = () => {
  const store = new Map();
  const apply = (path, data, options) => {
    store.set(path, options?.merge ? { ...store.get(path), ...data } : data);
  };
  const db = {
    store,
    failCommit: false,
    collection: (name) => ({
      doc: (id) => ({
        path: `${name}/${id}`,
        get: async () => ({ data: () => store.get(`${name}/${id}`) }),
        set: async (data, options) => apply(`${name}/${id}`, data, options)
      })
    }),
    runTransaction: async (work) => {
      const writes = [];
      let writing = false;
      const result = await work({
        get: async (reference) => {
          assert.equal(writing, false, 'Firestore requires all reads before writes');
          return reference.get();
        },
        set: (reference, data, options) => {
          writing = true;
          writes.push([reference.path, data, options]);
        }
      });

      if (db.failCommit) throw new Error('Commit failed');
      for (const write of writes) apply(...write);
      return result;
    }
  };
  return db;
};

test('live publication saves wording and history together; an identical retry creates no version', async () => {
  const db = fakeDb();
  const photoVideo = { label: 'Keep my choice', body: 'Existing photo wording.' };
  db.store.set('settings/consentWording', { photoVideo });
  const result = await publishConsentWording(db, 'disclaimer', statement, admin, { live: true });

  assert.deepEqual(result, { changed: true, live: true, version: 1 });
  assert.equal((await loadConsentWording(db)).disclaimer.body, statement.body);
  assert.deepEqual(db.store.get('settings/consentWording').photoVideo, photoVideo);
  const first = db.store.get('policyVersions/participation-disclaimer@1');
  assert.equal(first.text, tickWording(statement));
  assert.equal(first.hash, db.store.get(policyPath).currentHash);
  assert.equal(first.recordedBy, admin.uid);
  assert.equal(first.source, 'admin');

  assert.deepEqual(await publishConsentWording(db, 'disclaimer', statement, admin, { live: true }), {
    changed: false,
    live: true
  });
  assert.equal(db.store.get(policyPath).currentVersion, 1);
  assert.equal(db.store.size, 3, 'an unchanged save adds no history');

  await publishConsentWording(db, 'disclaimer', { ...statement, body: 'A later edit.' }, admin, { live: true });
  assert.equal(db.store.get(policyPath).currentVersion, 2);
  assert.deepEqual(db.store.get('policyVersions/participation-disclaimer@1'), first);
  assert.equal(db.store.get('policyVersions/participation-disclaimer@2').supersedesVersion, 1);
});

test('a failed live publication leaves wording and versions untouched and can be retried', async () => {
  const db = fakeDb();
  await publishConsentWording(db, 'disclaimer', statement, admin, { live: true });
  const before = new Map(db.store);
  const edited = { ...statement, body: 'This edit must not be partially saved.' };
  db.failCommit = true;

  await assert.rejects(publishConsentWording(db, 'disclaimer', edited, admin, { live: true }), /Commit failed/);
  assert.deepEqual(db.store, before);

  db.failCommit = false;
  assert.equal((await publishConsentWording(db, 'disclaimer', edited, admin, { live: true })).version, 2);
  assert.equal(db.store.get('policyVersions/participation-disclaimer@2').text, tickWording(edited));
});

test('an unchanged save repairs a version left behind by a previous partial publication', async () => {
  const db = fakeDb();
  db.store.set('settings/consentWording', { disclaimer: statement });
  db.store.set(policyPath, { currentVersion: 3, currentHash: policyHash('Earlier text') });

  assert.deepEqual(await publishConsentWording(db, 'disclaimer', statement, admin, { live: true }), {
    changed: false,
    live: true,
    version: 4
  });
  assert.equal(db.store.get('policyVersions/participation-disclaimer@4').text, tickWording(statement));
  assert.equal((await publishConsentWording(db, 'disclaimer', statement, admin, { live: true })).version, undefined);
});

test('pre-live edits replace working wording without creating policy history', async () => {
  const db = fakeDb();
  await publishConsentWording(db, 'disclaimer', statement, admin, { live: false });
  const edited = { label: '  I   accept  ', body: 'A revised draft.' };
  await publishConsentWording(db, 'disclaimer', edited, admin, { live: false });

  assert.equal(db.store.size, 1);
  assert.deepEqual(db.store.get('settings/consentWording').disclaimer, {
    label: 'I accept',
    body: edited.body
  });
  assert.deepEqual(await publishConsentWording(db, 'disclaimer', edited, admin, { live: false }), {
    changed: false,
    live: false
  });
});

test('invalid statement input is rejected without changing stored wording', async () => {
  const db = fakeDb();
  for (const [key, input] of [
    ['unknown', statement],
    ['disclaimer', { ...statement, label: '' }],
    ['photoVideo', { ...statement, body: '' }],
    ['disclaimer', { ...statement, body: '[Unsafe](javascript:alert(1))' }]
  ]) {
    await assert.rejects(publishConsentWording(db, key, input, admin, { live: true }), { status: 400 });
  }
  assert.equal(db.store.size, 0);
});

test('release sync versions published wording once and does not reset registered or current policies', async () => {
  const db = fakeDb();
  db.store.set('settings/consentWording', { disclaimer: statement });

  const first = await syncPolicies(db);
  assert.equal(first.find((entry) => entry.key === 'participation-disclaimer').version, 1);
  assert.equal(db.store.get('policyVersions/participation-disclaimer@1').text, tickWording(statement));
  assert.equal(db.store.get('policies/privacy-notice').currentVersion, 0);
  assert.deepEqual(await syncPolicies(db), []);

  await publishConsentWording(db, 'disclaimer', { ...statement, body: 'Published after release.' }, admin, { live: true });
  assert.deepEqual(await syncPolicies(db), []);
  assert.equal(db.store.get(policyPath).currentVersion, 2);
});

test('release sync still supports supplied definitions and published page text', async () => {
  const db = fakeDb();
  const definitions = [{
    key: 'privacy-notice',
    name: 'Privacy notice',
    kind: 'privacy',
    page: 'privacy',
    field: 'statement'
  }];
  const options = { definitions, pages: { privacy: { statement: 'Our privacy wording.' } } };

  assert.deepEqual(await syncPolicies(db, options), [{ key: 'privacy-notice', version: 1 }]);
  assert.equal(db.store.get('policyVersions/privacy-notice@1').text, 'Our privacy wording.');
  assert.deepEqual(await syncPolicies(db, options), []);
});
