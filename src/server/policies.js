import fs from 'node:fs';
import path from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';
import { CHECKOUT_POLICY_KEYS, planPolicyUpdates, policyDefinitionsFor } from '../utils/policies.js';
import { mergeConsentWording } from '../utils/consentWordingStore.js';
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
      const response = await fetch(`${siteUrl.replace(/\/$/, '')}/content/pages/${id}.json`, {
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        pages[id] = await response.json();
      }
    } catch { /* an unreachable page is skipped rather than blocking the release */ }
  }

  return pages;
};

/** The wording of the two ticked statements: the code's defaults with any published edits laid over them. */
export const loadConsentWording = async (db) => {
  const snapshot = await db.collection('settings').doc('consentWording').get();
  return mergeConsentWording(snapshot.data());
};

/** Writes a policy and its numbered history together, using the transaction's current policy snapshot. */
export const recordPolicyVersion = (transaction, db, definition, latest, {
  pages = {},
  recordedBy = 'release',
  source = 'release'
} = {}) => {
  const current = new Map();
  if (latest) {
    current.set(definition.key, {
      version: latest.currentVersion || 0,
      hash: latest.currentHash || ''
    });
  }

  const [step] = planPolicyUpdates([definition], current, pages);
  if (step.action === 'keep') return null;

  const reference = db.collection('policies').doc(definition.key);
  const identity = {
    policyKey: definition.key,
    name: definition.name,
    kind: definition.kind,
    field: definition.field
  };
  const now = Timestamp.now();

  if (step.action === 'register') {
    transaction.set(reference, {
      ...identity,
      currentVersion: 0,
      currentHash: '',
      createdAt: now,
      schemaVersion: 2
    }, { merge: true });

    return 0;
  }

  transaction.set(db.collection('policyVersions').doc(`${definition.key}@${step.version}`), {
    ...identity,
    version: step.version,
    text: step.text,
    hash: step.hash,
    supersedesVersion: step.supersedes,
    effectiveFrom: now,
    recordedBy,
    source,
    schemaVersion: 2
  });
  transaction.set(reference, {
    ...identity,
    currentVersion: step.version,
    currentHash: step.hash,
    updatedAt: now,
    schemaVersion: 2
  }, { merge: true });

  return step.version;
};

/**
 * Records each tracked policy's wording as a new numbered version when it changed since the last one.
 * Run after every release; safe to repeat and safe if two instances start together.
 */
export const syncPolicies = async (db, {
  distDirectory,
  siteUrl,
  recordedBy = 'release',
  source = 'release',
  definitions,
  pages
} = {}) => {
  const usePublishedWording = !definitions;
  definitions ||= policyDefinitionsFor();

  const pageIds = [...new Set(definitions.map((definition) => definition.page).filter(Boolean))];
  const publishedPages = pages ?? await loadPublishedPages({ distDirectory, siteUrl, pageIds });
  const recorded = [];

  for (const definition of definitions) {
    const reference = db.collection('policies').doc(definition.key);
    const version = await db.runTransaction(async (transaction) => {
      let currentDefinition = definition;
      let latest;

      if (usePublishedWording && Object.values(CHECKOUT_POLICY_KEYS).includes(definition.key)) {
        // Read both documents together, avoiding a second read on a transaction aborted by contention.
        const [snapshot, policy] = await transaction.getAll(
          db.collection('settings').doc('consentWording'),
          reference
        );
        const wording = mergeConsentWording(snapshot.data());
        currentDefinition = policyDefinitionsFor(wording).find((entry) => entry.key === definition.key);
        latest = policy.data();
      } else {
        latest = (await transaction.get(reference)).data();
      }

      return recordPolicyVersion(transaction, db, currentDefinition, latest, {
        pages: publishedPages,
        recordedBy,
        source
      });
    });

    if (version !== null) recorded.push({ key: definition.key, version });
  }

  return recorded;
};

/** The version of each checkout policy a new order shows, kept on the order and on the member's consent record. Before the site is live nothing is versioned. */
export const currentCheckoutPolicies = async (db, live = true) => {
  if (!live) {
    return Object.fromEntries(Object.entries(CHECKOUT_POLICY_KEYS).map(([name, key]) => [
      name,
      { policyKey: key, version: PRE_LIVE_VERSION }
    ]));
  }

  const references = Object.values(CHECKOUT_POLICY_KEYS).map((key) => db.collection('policies').doc(key));
  const documents = await db.getAll(...references);
  const byKey = new Map(documents.map((document) => [document.id, document.data()?.currentVersion || 0]));

  return Object.fromEntries(Object.entries(CHECKOUT_POLICY_KEYS).map(([name, key]) => [
    name,
    { policyKey: key, version: byKey.get(key) || 0 }
  ]));
};

/** Wording and the versions attached to its answers, read at one point in time even during publication. */
export const loadCheckoutConsent = async (db, live = true) => {
  const wordingReference = db.collection('settings').doc('consentWording');
  const policyReferences = live
    ? Object.values(CHECKOUT_POLICY_KEYS).map((key) => db.collection('policies').doc(key))
    : [];

  return db.runTransaction(async (transaction) => {
    const [wording, ...policies] = await transaction.getAll(wordingReference, ...policyReferences);
    const versions = new Map(policies.map((document) => [document.id, document.data()?.currentVersion || 0]));

    return {
      wording: mergeConsentWording(wording.data()),
      policies: Object.fromEntries(Object.entries(CHECKOUT_POLICY_KEYS).map(([name, key]) => [
        name,
        { policyKey: key, version: live ? versions.get(key) || 0 : PRE_LIVE_VERSION }
      ]))
    };
  }, { readOnly: true });
};

export const registerPolicyRoutes = (app, { requireAdmin, db, distDirectory, siteUrl, live }) => {
  app.get('/api/admin/policies', rateLimit(30, 60 * 1000), async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    res.set('Cache-Control', 'no-store');
    try {
      const [policies, versions] = await Promise.all([
        db().collection('policies').get(),
        db().collection('policyVersions').orderBy('effectiveFrom', 'desc').limit(200).get()
      ]);
      const toDate = (value) => value?.toDate?.().toISOString() || null;

      res.json({
        live,
        policies: policies.docs.map((document) => ({
          ...document.data(),
          id: document.id,
          updatedAt: toDate(document.data().updatedAt),
          createdAt: toDate(document.data().createdAt)
        })),
        versions: versions.docs.map((document) => ({
          ...document.data(),
          id: document.id,
          effectiveFrom: toDate(document.data().effectiveFrom)
        }))
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
    if (!live) {
      return res.json({
        live,
        recorded: [],
        message: 'Wording changes are only versioned when WEBSITE_ISLIVE=true.'
      });
    }

    try {
      const recorded = await syncPolicies(db(), {
        distDirectory,
        siteUrl,
        recordedBy: admin.uid,
        source: 'admin'
      });
      res.json({ recorded });
    } catch (error) {
      console.error('Policy sync failed:', error.message);
      res.status(500).json({ error: 'Could not record policy versions.' });
    }
  });
};
