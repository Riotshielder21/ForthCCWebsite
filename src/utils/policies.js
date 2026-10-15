import { createHash } from 'node:crypto';
import { DISCLAIMER_TEXT, PHOTO_CONSENT_TEXT } from './checkout.js';

/**
 * Wording the club must be able to prove it showed: consent, disclaimers and policies tied to GDPR, retention and safety.
 * Text comes from code or, with `page` and `field`, from a published website page so edits made in the editor are caught
 * at the next release. An empty text is a placeholder that is recorded once someone writes it.
 */
export const POLICY_DEFINITIONS = [
  { key: 'participation-disclaimer', name: 'Participation and safety disclaimer', kind: 'disclaimer', field: 'text', text: () => DISCLAIMER_TEXT },
  { key: 'photo-video-consent', name: 'Photo and video consent', kind: 'consent', field: 'text', text: () => PHOTO_CONSENT_TEXT },
  { key: 'privacy-notice', name: 'Privacy notice', kind: 'privacy', field: 'text', text: () => '' },
  { key: 'data-retention', name: 'Data retention policy', kind: 'retention', field: 'text', text: () => '' },
  { key: 'first-aid-and-safety', name: 'First aid and safety statement', kind: 'safety', field: 'text', text: () => '' }
];

/** Keys the checkout shows to every new member and records against their consents. */
export const CHECKOUT_POLICY_KEYS = { disclaimer: 'participation-disclaimer', photoVideo: 'photo-video-consent' };

const normaliseText = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim();

/** Hash of the wording with line endings and outer whitespace ignored, so only real changes make a new version. */
export const policyHash = (text) => createHash('sha256').update(normaliseText(text)).digest('hex');

/** The wording currently published for a policy, read from its website page when it has one. */
export const resolvePolicyText = (definition, pages = {}) => normaliseText(definition.page ? pages[definition.page]?.[definition.field] : definition.text());

/**
 * What to write for each policy. `current` maps policy key to its latest `{ version, hash }`.
 * Policies without wording yet are only registered; changed wording becomes the next version.
 */
export const planPolicyUpdates = (definitions, current, pages = {}) => definitions.map((definition) => {
  const text = resolvePolicyText(definition, pages);
  const latest = current.get(definition.key);
  if (!text) return { definition, action: latest ? 'keep' : 'register' };
  const hash = policyHash(text);
  if (latest?.hash === hash) return { definition, action: 'keep' };
  return { definition, action: 'version', version: (latest?.version || 0) + 1, supersedes: latest?.version || null, text, hash };
});
