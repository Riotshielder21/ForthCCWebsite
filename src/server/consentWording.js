import { Timestamp } from 'firebase-admin/firestore';
import { CONSENT_KEYS, CONSENT_LIMITS, mergeConsentWording } from '../utils/consentWordingStore.js';
import { normaliseNoticeText } from '../utils/notices.js';
import { validateContentLinks } from '../utils/contentLinks.js';
import { CHECKOUT_POLICY_KEYS, policyDefinitionsFor } from '../utils/policies.js';
import { loadConsentWording, recordPolicyVersion } from './policies.js';
import { rateLimit } from './rateLimit.js';

const bad = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * Publishes new wording for the disclaimer or photo consent. Once the site is live a change is recorded as the next
 * policy version straight away, so people are asked to tick again; before launch it simply replaces the working text.
 */
export const publishConsentWording = async (db, key, input, admin, { live }) => {
  if (!CONSENT_KEYS.includes(key)) throw bad('Unknown statement.');

  const label = typeof input?.label === 'string' ? input.label.replace(/\s+/g, ' ').trim() : '';
  const body = typeof input?.body === 'string' ? normaliseNoticeText(input.body) : '';

  if (!label || label.length > CONSENT_LIMITS.label) {
    throw bad(`Write the statement beside the tick box, up to ${CONSENT_LIMITS.label} characters.`);
  }
  if (!body || body.length > CONSENT_LIMITS.body) {
    throw bad(`Write the full wording, up to ${CONSENT_LIMITS.body.toLocaleString('en-GB')} characters.`);
  }
  try {
    validateContentLinks(body);
  } catch (error) {
    throw bad(error.message);
  }

  const wordingReference = db.collection('settings').doc('consentWording');
  const policyKey = CHECKOUT_POLICY_KEYS[key];
  const policyReference = db.collection('policies').doc(policyKey);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(wordingReference);
    const wording = mergeConsentWording(snapshot.data());
    const before = wording[key];
    const changed = before.label !== label || before.body !== body;
    let version = null;

    if (live) {
      const policy = await transaction.get(policyReference);
      const definition = policyDefinitionsFor({ ...wording, [key]: { label, body } })
        .find((entry) => entry.key === policyKey);

      // Even an unchanged save repairs a missing version left by an earlier partial publication.
      version = recordPolicyVersion(transaction, db, definition, policy.data(), {
        recordedBy: admin.uid,
        source: 'admin'
      });
    }

    if (changed) {
      transaction.set(wordingReference, {
        [key]: { label, body },
        updatedAt: Timestamp.now(),
        updatedBy: { uid: admin.uid, email: admin.email || '' }
      }, { merge: true });
    }

    if (!changed && version === null) return { changed: false, live };
    return { changed, live, version };
  });
};

export const registerConsentWordingRoutes = (app, { requireAdmin, db, live }) => {
  app.get('/api/consent-wording', rateLimit(60, 60 * 1000), async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const wording = await loadConsentWording(db());
      const statements = Object.fromEntries(CONSENT_KEYS.map((key) => [
        key,
        { label: wording[key].label, body: wording[key].body }
      ]));
      res.json(statements);
    } catch (error) {
      console.error('Could not load consent wording:', error.message);
      res.status(500).json({ error: 'Could not load the wording.' });
    }
  });

  app.put('/api/admin/consent-wording/:key', rateLimit(20, 60 * 1000), async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    res.set('Cache-Control', 'no-store');
    try {
      res.json(await publishConsentWording(db(), req.params.key, req.body, admin, { live: live() }));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      console.error('Could not publish consent wording:', error.message);
      res.status(500).json({ error: 'Could not publish the wording.' });
    }
  });
};
