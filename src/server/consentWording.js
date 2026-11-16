import { Timestamp } from 'firebase-admin/firestore';
import { CONSENT_KEYS, CONSENT_LIMITS } from '../utils/consentWordingStore.js';
import { normaliseNoticeText } from '../utils/notices.js';
import { validateContentLinks } from '../utils/contentLinks.js';
import { CHECKOUT_POLICY_KEYS } from '../utils/policies.js';
import { loadConsentWording, syncPolicies } from './policies.js';
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
  if (!label || label.length > CONSENT_LIMITS.label) throw bad(`Write the statement beside the tick box, up to ${CONSENT_LIMITS.label} characters.`);
  if (!body || body.length > CONSENT_LIMITS.body) throw bad(`Write the full wording, up to ${CONSENT_LIMITS.body.toLocaleString('en-GB')} characters.`);
  try { validateContentLinks(body); } catch (error) { throw bad(error.message); }
  const before = (await loadConsentWording(db))[key];
  if (before.label === label && before.body === body) return { changed: false, live };
  await db.collection('settings').doc('consentWording').set({
    [key]: { label, body }, updatedAt: Timestamp.now(), updatedBy: { uid: admin.uid, email: admin.email || '' }
  }, { merge: true });
  const recorded = live ? await syncPolicies(db, { recordedBy: admin.uid, source: 'admin' }) : [];
  return { changed: true, live, version: recorded.find((entry) => entry.key === CHECKOUT_POLICY_KEYS[key])?.version || null };
};

export const registerConsentWordingRoutes = (app, { requireAdmin, db, live }) => {
  app.get('/api/consent-wording', rateLimit(60, 60 * 1000), async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const wording = await loadConsentWording(db());
      res.json(Object.fromEntries(CONSENT_KEYS.map((key) => [key, { label: wording[key].label, body: wording[key].body }])));
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
