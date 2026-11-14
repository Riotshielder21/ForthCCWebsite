import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { freezePreLiveNotices, noticeHash, noticePdf, publishNotice, reorderNotices, savePreLiveNotice } from './notices.js';

const DELETE = FieldValue.delete();

// Just enough of Firestore for the notice functions: documents, whole-collection reads, transactions and batches.
const fakeDb = () => {
  const store = new Map();
  let autoId = 0;
  const apply = (path, data, merge) => {
    const next = merge ? { ...(store.get(path) || {}) } : {};
    for (const [key, value] of Object.entries(data)) {
      if (value?.isEqual?.(DELETE)) delete next[key];
      else next[key] = value;
    }
    store.set(path, next);
  };
  const doc = (collection, id) => ({
    kind: 'doc', path: `${collection}/${id}`, id,
    get: async () => ({ id, exists: store.has(`${collection}/${id}`), data: () => store.get(`${collection}/${id}`) })
  });
  const collection = (name) => ({
    kind: 'collection',
    doc: (id = `auto${autoId += 1}`) => doc(name, id),
    get: async () => ({
      docs: [...store.entries()].filter(([path]) => path.startsWith(`${name}/`))
        .map(([path, data]) => ({ id: path.slice(name.length + 1), exists: true, data: () => data }))
    })
  });
  const writer = () => ({
    set: (reference, data, options) => apply(reference.path, data, options?.merge),
    update: (reference, data) => {
      if (!store.has(reference.path)) throw new Error(`No document ${reference.path}`);
      apply(reference.path, data, true);
    }
  });
  return {
    store,
    collection,
    runTransaction: async (fn) => fn({ get: (reference) => reference.get(), ...writer() }),
    batch: () => ({ ...writer(), commit: async () => {} })
  };
};

const admin = { uid: 'admin-1', email: 'admin@example.org' };
const at = (day) => Timestamp.fromDate(new Date(`2026-05-${String(day).padStart(2, '0')}T12:00:00Z`));

test('publishing new wording creates numbered versions and keeps every old one', async () => {
  const db = fakeDb();
  assert.deepEqual(await publishNotice(db, 'privacy-notice', { title: 'Privacy notice', body: 'We hold your name.' }, admin, at(1)), { version: 1, changed: true });
  assert.deepEqual(await publishNotice(db, 'privacy-notice', { title: 'Privacy notice', body: 'We hold your name.  \n' }, admin, at(2)), { version: 1, changed: false });
  assert.deepEqual(await publishNotice(db, 'privacy-notice', { title: 'Privacy notice', body: 'We hold your name and email.' }, admin, at(3)), { version: 2, changed: true });

  const notice = db.store.get('notices/privacy-notice');
  assert.equal(notice.currentVersion, 2);
  assert.equal(notice.currentHash, noticeHash('Privacy notice', 'We hold your name and email.'));
  assert.equal(notice.order, 0);
  assert.ok(notice.createdAt.isEqual(at(1)));
  assert.equal(notice.publishedBy, undefined, 'admin identity stays out of the public notice');
  assert.equal(db.store.get('noticeVersions/privacy-notice@1').body, 'We hold your name.');
  const second = db.store.get('noticeVersions/privacy-notice@2');
  assert.deepEqual([second.supersedesVersion, second.publishedBy, second.publishedAt.isEqual(at(3))], [1, admin, true]);

  await publishNotice(db, 'terms', { title: 'Terms', body: 'Be nice.' }, admin, at(4));
  assert.equal(db.store.get('notices/terms').order, 1);
});

test('publishing rejects bad IDs and wording with a 400', async () => {
  const db = fakeDb();
  await assert.rejects(publishNotice(db, 'Bad ID', { title: 'T', body: 'B' }, admin), { status: 400 });
  await assert.rejects(publishNotice(db, 'ok', { title: '', body: 'B' }, admin), { status: 400 });
  assert.equal(db.store.size, 0);
});

test('pre-live edits replace working version 1 without building history; launch freezes the last edit', async () => {
  const db = fakeDb();
  assert.deepEqual(await savePreLiveNotice(db, 'terms', { title: 'Terms', body: 'First draft.' }, admin, at(1)),
    { version: 1, changed: true, preLive: true });
  assert.deepEqual(await savePreLiveNotice(db, 'terms', { title: 'Terms', body: 'Revised draft.' }, admin, at(2)),
    { version: 1, changed: true, preLive: true });
  assert.equal(db.store.get('notices/terms').currentVersion, 1);
  assert.equal(db.store.get('noticeVersions/terms@1').body, 'Revised draft.');
  assert.equal((await noticePdf(db.store.get('noticeVersions/terms@1'))).subarray(0, 5).toString(), '%PDF-');
  assert.equal(await freezePreLiveNotices(db, at(3)), 1);
  assert.equal(db.store.get('notices/terms').preLive, false);
  assert.equal(db.store.get('noticeVersions/terms@1').body, 'Revised draft.');
  assert.equal('preLive' in db.store.get('noticeVersions/terms@1'), false);
  assert.deepEqual(await publishNotice(db, 'terms', { title: 'Terms', body: 'Live change.' }, admin, at(4)),
    { version: 2, changed: true });
});

test('pre-live saving cannot reset a notice with published history', async () => {
  const db = fakeDb();
  await publishNotice(db, 'terms', { title: 'Terms', body: 'First version.' }, admin, at(1));
  await publishNotice(db, 'terms', { title: 'Terms', body: 'Second version.' }, admin, at(2));
  await assert.rejects(savePreLiveNotice(db, 'terms', { title: 'Terms', body: 'Changed before launch.' }, admin, at(3)),
    { status: 409 });
  assert.equal(db.store.get('notices/terms').currentVersion, 2);
  assert.equal(db.store.get('noticeVersions/terms@1').body, 'First version.');
  assert.equal(db.store.get('noticeVersions/terms@2').body, 'Second version.');
});

test('reordering needs each known notice once', async () => {
  const db = fakeDb();
  await publishNotice(db, 'a', { title: 'A', body: 'A' }, admin, at(1));
  await publishNotice(db, 'b', { title: 'B', body: 'B' }, admin, at(1));
  await reorderNotices(db, ['b', 'a'], at(2));
  assert.deepEqual([db.store.get('notices/b').order, db.store.get('notices/a').order], [0, 1]);
  await assert.rejects(reorderNotices(db, ['a', 'a']), { status: 400 });
  await assert.rejects(reorderNotices(db, ['a', 'c']), { status: 400 });
  await assert.rejects(reorderNotices(db, []), { status: 400 });
});

test('each version prints as a PDF', async () => {
  const pdf = await noticePdf({
    title: 'Privacy notice', version: 2, publishedAt: at(3),
    body: '## Who we are\nForth Canoe Club, see [contact](/contact).\n\n- Name\n- Email\n\n1. First\n2. Second\n\n' + 'Long paragraph. '.repeat(600)
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 2000);
});
