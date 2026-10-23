import fs from 'node:fs';
import path from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';
import { CHECKOUT_POLICY_KEYS, POLICY_DEFINITIONS, planPolicyUpdates } from '../utils/policies.js';
import { PRE_LIVE_VERSION } from '../utils/live.js';
import { rateLimit } from './rateLimit.js';

/** Published page content for the pages policies read from: local build output when present, otherwise the hosted website. */
export const loadPublishedPages = async ({ distDirectory, siteUrl, pageIds }) => {
  const pages = {};
  for (const id of pageIds) {
    if (!/^[a-z0-9-]+$/i.test(id)) continue;
    try {
      pages[id] = JSON.parse(fs.readFileSync(path.join(distDirectory, 'content', 'pages', `${id}.json`), 'utf8'));
      continue;
    } catch { /* not built locally */ }
    if (!siteUrl) continue;
    try {
      const response = await fetch(`${siteUrl.replace(/\/$/, '')}/content/pages/${id}.json`, { signal: AbortSignal.timeout(5000) });
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) pages[id] = await response.json();
    } catch { /* an unreachable page is skipped rather than blocking the release */ }
  }
  return pages;
};

/**
 * Records each tracked policy's wording as a new numbered version when it changed since the last one.
 * Run after every release; safe to repeat and safe if two instances start together.
 */
export const syncPolicies = async (db, { distDirectory, siteUrl, recordedBy = 'release', source = 'release', definitions = POLICY_DEFINITIONS, pages } = {}) => {
  const current = new Map((await db.collection('policies').get()).docs.map((document) => [document.id, { version: document.data().currentVersion || 0, hash: document.data().currentHash || '' }]));
  const pageIds = [...new Set(definitions.map((definition) => definition.page).filter(Boolean))];
  const plan = planPolicyUpdates(definitions, current, pages ?? await loadPublishedPages({ distDirectory, siteUrl, pageIds }));
  const recorded = [];
  for (const step of plan.filter((entry) => entry.action !== 'keep')) {
    const { definition } = step;
    const reference = db.collection('policies').doc(definition.key);
    const identity = { policyKey: definition.key, name: definition.name, kind: definition.kind, field: definition.field };
    if (step.action === 'register') {
      await reference.set({ ...identity, currentVersion: 0, currentHash: '', createdAt: Timestamp.now(), schemaVersion: 2 }, { merge: true });
      recorded.push({ key: definition.key, version: 0 });
      continue;
    }
    const version = await db.runTransaction(async (transaction) => {
      const latest = (await transaction.get(reference)).data();
      if (latest?.currentHash === step.hash) return null;
      const next = (latest?.currentVersion || 0) + 1;
      transaction.set(db.collection('policyVersions').doc(`${definition.key}@${next}`), {
        ...identity, version: next, text: step.text, hash: step.hash, supersedesVersion: next > 1 ? next - 1 : null,
        effectiveFrom: Timestamp.now(), recordedBy, source, schemaVersion: 2
      });
      transaction.set(reference, { ...identity, currentVersion: next, currentHash: step.hash, updatedAt: Timestamp.now(), schemaVersion: 2 }, { merge: true });
      return next;
    });
    if (version) recorded.push({ key: definition.key, version });
  }
  return recorded;
};

/** The version of each checkout policy a new order shows, kept on the order and on the member's consent record. Before the site is live nothing is versioned. */
export const currentCheckoutPolicies = async (db, live = true) => {
  if (!live) return Object.fromEntries(Object.entries(CHECKOUT_POLICY_KEYS).map(([name, key]) => [name, { policyKey: key, version: PRE_LIVE_VERSION }]));
  const documents = await db.getAll(...Object.values(CHECKOUT_POLICY_KEYS).map((key) => db.collection('policies').doc(key)));
  const byKey = new Map(documents.map((document) => [document.id, document.data()?.currentVersion || 0]));
  return Object.fromEntries(Object.entries(CHECKOUT_POLICY_KEYS).map(([name, key]) => [name, { policyKey: key, version: byKey.get(key) || 0 }]));
};

export const registerPolicyRoutes = (app, { requireAdmin, db, distDirectory, siteUrl, live }) => {
  app.get('/api/admin/policies', rateLimit(30, 60 * 1000), async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.set('Cache-Control', 'no-store');
    try {
      const [policies, versions] = await Promise.all([db().collection('policies').get(), db().collection('policyVersions').orderBy('effectiveFrom', 'desc').limit(200).get()]);
      const toDate = (value) => value?.toDate?.().toISOString() || null;
      res.json({
        live,
        policies: policies.docs.map((document) => ({ ...document.data(), id: document.id, updatedAt: toDate(document.data().updatedAt), createdAt: toDate(document.data().createdAt) })),
        versions: versions.docs.map((document) => ({ ...document.data(), id: document.id, effectiveFrom: toDate(document.data().effectiveFrom) }))
      });
    } catch (error) {
      console.error('Could not load policies:', error.message);
      res.status(500).json({ error: 'Could not load policies.' });
    }
  });

  app.post('/api/admin/policies/sync', rateLimit(5, 60 * 1000), async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.set('Cache-Control', 'no-store');
    if (!live) return res.json({ live, recorded: [], message: 'Wording changes are only versioned when WEBSITE_ISLIVE=true.' });
    try {
      res.json({ recorded: await syncPolicies(db(), { distDirectory, siteUrl, recordedBy: admin.uid, source: 'admin' }) });
    } catch (error) {
      console.error('Policy sync failed:', error.message);
      res.status(500).json({ error: 'Could not record policy versions.' });
    }
  });
};
