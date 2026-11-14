import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Timestamp } from 'firebase-admin/firestore';
import { NOTICE_ID_PATTERN, NOTICE_LIMITS, noticePlainText, parseNoticeBlocks, publishedNotices, validateNoticeInput } from '../utils/notices.js';
import { rateLimit } from './rateLimit.js';

/** Hash of the wording people agree to: the title and the text. Only a change to either makes a new version. */
export const noticeHash = (title, body) => createHash('sha256').update(`${title}\n\n${body}`).digest('hex');

const toIso = (value) => value?.toDate?.().toISOString() || null;
const noticeFromDocument = (document) => ({ ...document.data(), id: document.id });

export const loadNotices = async (db) => (await db.collection('notices').get()).docs.map(noticeFromDocument);

/** The published notices checkout asks people to agree to. */
export const loadCurrentNotices = async (db) => publishedNotices(await loadNotices(db));

/**
 * Publishes a notice's wording. Changed wording becomes the next numbered version, kept for good alongside who published
 * it and when; unchanged wording keeps the current version. A new notice goes to the end of the list.
 */
export const publishNotice = async (db, id, input, admin, now = Timestamp.now()) => {
  if (!NOTICE_ID_PATTERN.test(id)) throw Object.assign(new Error('Invalid notice ID.'), { status: 400 });
  let title;
  let body;
  try { ({ title, body } = validateNoticeInput(input)); }
  catch (error) { throw Object.assign(error, { status: 400 }); }
  const hash = noticeHash(title, body);
  const notices = db.collection('notices');
  const reference = notices.doc(id);
  return db.runTransaction(async (transaction) => {
    const all = (await transaction.get(notices)).docs;
    const existing = all.find((document) => document.id === id)?.data();
    if (!existing && all.length >= NOTICE_LIMITS.notices) {
      throw Object.assign(new Error(`There can be up to ${NOTICE_LIMITS.notices} notices.`), { status: 400 });
    }
    const order = existing ? existing.order : Math.max(-1, ...all.map((document) => document.data().order ?? 0)) + 1;
    const publishedBy = { uid: admin.uid, email: admin.email || '' };
    if (existing?.currentHash === hash) {
      if (existing.preLive) {
        transaction.set(db.collection('noticeVersions').doc(`${id}@1`), {
          noticeId: id, version: 1, title: existing.title, body: existing.body, hash: existing.currentHash,
          supersedesVersion: null, publishedAt: now, publishedBy: { uid: 'site-launch', email: 'Pre-launch draft' }, schemaVersion: 1
        });
        transaction.update(reference, { preLive: false, archived: false, publishedAt: now, updatedAt: now });
      }
      return { version: existing.currentVersion, changed: false };
    }
    if (existing?.preLive && existing.currentVersion === 1) {
      transaction.set(db.collection('noticeVersions').doc(`${id}@1`), {
        noticeId: id, version: 1, title: existing.title, body: existing.body,
        hash: existing.currentHash || noticeHash(existing.title, existing.body), supersedesVersion: null,
        publishedAt: now, publishedBy: { uid: 'site-launch', email: 'Pre-launch draft' }, schemaVersion: 1
      });
    }
    const version = (existing?.currentVersion || 0) + 1;
    transaction.set(db.collection('noticeVersions').doc(`${id}@${version}`), {
      noticeId: id, version, title, body, hash, supersedesVersion: version > 1 ? version - 1 : null, publishedAt: now, publishedBy, schemaVersion: 1
    });
    transaction.set(reference, {
      title, body, order, archived: false, preLive: false, currentVersion: version, currentHash: hash, publishedAt: now, updatedAt: now, schemaVersion: 1,
      ...(existing ? {} : { createdAt: now })
    }, { merge: true });
    return { version, changed: true };
  });
};

/** Pre-live edits replace the working version 1; they do not create an immutable version history. */
export const savePreLiveNotice = async (db, id, input, admin, now = Timestamp.now()) => {
  if (!NOTICE_ID_PATTERN.test(id)) throw Object.assign(new Error('Invalid notice ID.'), { status: 400 });
  let title;
  let body;
  try { ({ title, body } = validateNoticeInput(input)); }
  catch (error) { throw Object.assign(error, { status: 400 }); }
  const hash = noticeHash(title, body);
  const notices = db.collection('notices');
  const reference = db.collection('notices').doc(id);
  return db.runTransaction(async (transaction) => {
    const all = (await transaction.get(notices)).docs;
    const existing = all.find((document) => document.id === id)?.data();
    if (existing && existing.currentVersion > 1) {
      throw Object.assign(new Error('This notice already has published versions and cannot be returned to pre-launch editing.'), { status: 409 });
    }
    if (!existing && all.length >= NOTICE_LIMITS.notices) throw Object.assign(new Error(`There can be up to ${NOTICE_LIMITS.notices} notices.`), { status: 400 });
    const order = existing ? existing.order : Math.max(-1, ...all.map((document) => document.data().order ?? 0)) + 1;
    const publishedBy = { uid: admin.uid, email: admin.email || '' };
    const version = 1;
    if (existing?.preLive && existing.currentHash === hash) {
      transaction.update(reference, { archived: false, updatedAt: now });
      return { version, changed: false, preLive: true };
    }
    transaction.set(db.collection('noticeVersions').doc(`${id}@${version}`), {
      noticeId: id, version, title, body, hash, supersedesVersion: null, publishedAt: now, publishedBy, schemaVersion: 1, preLive: true
    });
    transaction.set(reference, {
      title, body, order, currentVersion: version, currentHash: hash, publishedAt: now, updatedAt: now,
      createdAt: existing?.createdAt || now, schemaVersion: 1, archived: false, preLive: true
    });
    return { version, changed: existing?.currentHash !== hash, preLive: true };
  });
};

/** Freeze the latest editable version 1 as the live site's first immutable notice version. */
export const freezePreLiveNotices = async (db, now = Timestamp.now()) => {
  const notices = await loadNotices(db);
  const drafts = notices.filter((notice) => notice.preLive && notice.currentVersion === 1);
  if (!drafts.length) return 0;
  const batch = db.batch();
  for (const notice of drafts) {
    const publishedBy = { uid: 'site-launch', email: 'Pre-launch draft' };
    batch.set(db.collection('noticeVersions').doc(`${notice.id}@1`), {
      noticeId: notice.id, version: 1, title: notice.title, body: notice.body,
      hash: notice.currentHash || noticeHash(notice.title, notice.body), supersedesVersion: null,
      publishedAt: now, publishedBy, schemaVersion: 1
    });
    batch.update(db.collection('notices').doc(notice.id), { preLive: false, archived: false, publishedAt: now, updatedAt: now });
  }
  await batch.commit();
  return drafts.length;
};

export const reorderNotices = async (db, ids, now = Timestamp.now()) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > NOTICE_LIMITS.notices * 4 || new Set(ids).size !== ids.length
    || ids.some((id) => typeof id !== 'string' || !NOTICE_ID_PATTERN.test(id))) {
    throw Object.assign(new Error('Send each notice ID once, in the new order.'), { status: 400 });
  }
  const known = new Set((await db.collection('notices').get()).docs.map((document) => document.id));
  if (ids.some((id) => !known.has(id))) throw Object.assign(new Error('Unknown notice in the new order.'), { status: 400 });
  const batch = db.batch();
  ids.forEach((id, order) => batch.update(db.collection('notices').doc(id), { order, updatedAt: now }));
  await batch.commit();
};

const longDate = (timestamp) => timestamp.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

/** A printable copy of exactly one version, so the club can show what someone agreed to. */
export const noticePdf = (version) => new Promise((resolve, reject) => {
  const document = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, info: {
    Title: `${version.title} (version ${version.version})`, Author: 'Forth Canoe Club', Subject: 'Forth Canoe Club notice'
  } });
  const chunks = [];
  document.on('data', (chunk) => chunks.push(chunk));
  document.on('end', () => resolve(Buffer.concat(chunks)));
  document.on('error', reject);
  document.font('Helvetica-Bold').fontSize(20).fillColor('#002147').text(version.title);
  document.moveDown(0.3).font('Helvetica').fontSize(10).fillColor('#64748b')
    .text(`Forth Canoe Club  ·  Version ${version.version}  ·  Published ${longDate(version.publishedAt)}`);
  document.moveDown(1.2).fillColor('#0f172a');
  for (const block of parseNoticeBlocks(version.body)) {
    if (block.type === 'heading') {
      document.moveDown(0.4).font('Helvetica-Bold').fontSize(block.level === 2 ? 14 : 12).text(noticePlainText(block.text)).moveDown(0.3);
    } else if (block.type === 'list') {
      document.font('Helvetica').fontSize(11).list(block.items.map(noticePlainText), {
        listType: block.ordered ? 'numbered' : 'bullet', bulletRadius: 2, textIndent: 16, bulletIndent: 6, paragraphGap: 3
      }).moveDown(0.6);
    } else {
      document.font('Helvetica').fontSize(11).text(noticePlainText(block.text), { paragraphGap: 2, lineGap: 1.5 }).moveDown(0.6);
    }
  }
  const pages = document.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    document.switchToPage(pages.start + index);
    const bottom = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    document.font('Helvetica').fontSize(8).fillColor('#64748b').text(
      `${version.title} · version ${version.version} · page ${index + 1} of ${pages.count}`,
      document.page.margins.left, document.page.height - 36, { width: document.page.width - document.page.margins.left - document.page.margins.right, align: 'center' }
    );
    document.page.margins.bottom = bottom;
  }
  document.end();
});

export const registerNoticeRoutes = (app, { requireAdmin, db, live = () => true }) => {
  const fail = (res, error, fallback) => {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error(`${fallback}:`, error.message);
    return res.status(500).json({ error: `${fallback}.` });
  };

  app.get('/api/notices/mode', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ live: live() });
  });

  app.get('/api/notices/:id/pdf', rateLimit(30, 60 * 1000), async (req, res) => {
    const { id } = req.params;
    const requested = req.query.version === undefined ? null : Number(req.query.version);
    if (!NOTICE_ID_PATTERN.test(id) || (requested !== null && (!Number.isInteger(requested) || requested < 1))) {
      return res.status(400).json({ error: 'Invalid notice or version.' });
    }
    try {
      const notice = await db().collection('notices').doc(id).get();
      const versionNumber = requested ?? (notice.exists ? notice.data().currentVersion : 0);
      const version = versionNumber > 0 ? await db().collection('noticeVersions').doc(`${id}@${versionNumber}`).get() : null;
      if (!version?.exists) return res.status(404).json({ error: 'That notice version is not published.' });
      const pdf = await noticePdf(version.data());
      // A numbered version never changes; the current version can be replaced by the next one.
      res.set('Cache-Control', requested ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="forth-canoe-club-${id}-v${versionNumber}.pdf"`);
      res.send(pdf);
    } catch (error) {
      fail(res, error, 'Could not create the notice PDF');
    }
  });

  app.get('/api/admin/notices/:id/versions', rateLimit(30, 60 * 1000), async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    res.set('Cache-Control', 'no-store');
    if (!NOTICE_ID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Invalid notice ID.' });
    try {
      const versions = await db().collection('noticeVersions').where('noticeId', '==', req.params.id).get();
      const notice = await db().collection('notices').doc(req.params.id).get();
      if (!live() || (notice.exists && notice.data().preLive)) return res.json({ versions: [] });
      res.json({ versions: versions.docs.map((document) => {
        const { version, title, publishedAt, publishedBy, supersedesVersion } = document.data();
        return { version, title, publishedAt: toIso(publishedAt), publishedBy: publishedBy?.email || '', supersedesVersion };
      }).sort((a, b) => b.version - a.version) });
    } catch (error) {
      fail(res, error, 'Could not load the notice versions');
    }
  });

  app.put('/api/admin/notices/:id', rateLimit(20, 60 * 1000), async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await (live() ? publishNotice(db(), req.params.id, req.body, admin) : savePreLiveNotice(db(), req.params.id, req.body, admin)));
    } catch (error) {
      fail(res, error, 'Could not publish the notice');
    }
  });

  app.put('/api/admin/notices-order', rateLimit(30, 60 * 1000), async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    res.set('Cache-Control', 'no-store');
    try {
      await reorderNotices(db(), req.body?.ids);
      res.json({ success: true });
    } catch (error) {
      fail(res, error, 'Could not reorder the notices');
    }
  });
};
