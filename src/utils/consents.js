import { DISCLAIMER_TEXT, PHOTO_CONSENT_TEXT, invalidatePersonVerification } from './checkout.js';

/**
 * Consents someone gave before, used to tick checkout boxes in advance, and the photo and video consent records kept on
 * membership records. A box is only ticked in advance for an answer given to the wording in force now.
 */

const usableVersion = (version) => (Number.isInteger(version) && version > 0) || (typeof version === 'string' && version !== '');
const answersCurrent = (record, policy) => usableVersion(policy?.version) && record?.version === policy.version;

/** True when two `{ noticeId: version }` maps hold the same notices at the same versions. */
export const sameNoticeVersions = (a, b) => {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
};

/**
 * What checkout may tick in advance for a matched record: answers only, never the record. `policies` comes from
 * currentCheckoutPolicies and `noticeVersions` maps each published notice to its version. `notices` is that map when
 * the record holds an agreement to every one of them, otherwise null. The `...Changed` flags mean an earlier wording
 * was agreed, so checkout can say why the box is no longer ticked.
 */
export const consentPrefill = (member, policies, noticeVersions) => {
  const consents = member?.consents || {};
  const disclaimer = answersCurrent(consents.disclaimer, policies?.disclaimer);
  const photo = consents.photoVideo;
  const photoConsent = photo?.accepted === true && answersCurrent(photo, policies?.photoVideo);
  return {
    disclaimer,
    disclaimerChanged: !disclaimer && Boolean(consents.disclaimer) && usableVersion(policies?.disclaimer?.version),
    photoConsent,
    photoChanged: !photoConsent && photo?.accepted === true && usableVersion(policies?.photoVideo?.version),
    notices: agreedToNotices(consents.notices?.versions, noticeVersions)
  };
};

/** The current `{ noticeId: version }` map when `[{ noticeId, version }]` agreed to every notice in it, otherwise null. */
const agreedToNotices = (entries, noticeVersions) => {
  const agreed = new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry?.noticeId, entry?.version]));
  const current = noticeVersions && typeof noticeVersions === 'object' ? noticeVersions : null;
  return current && Object.entries(current).every(([id, version]) => agreed.get(id) === version) ? { ...current } : null;
};

const millis = (value) => typeof value?.toMillis === 'function' ? value.toMillis() : null;

/**
 * What a retry of a failed order may tick in advance for one of its people: the answers given on that order where
 * the wording is still current. A photo answer recorded on the person's membership record after the order was made,
 * such as a withdrawal in My details, replaces the order's.
 */
export const retryConsentPrefill = ({ person, order, member, policies, noticeVersions }) => {
  const recorded = member ? consentPrefill(member, policies, noticeVersions) : null;
  const disclaimerCurrent = answersCurrent(order?.policyVersions?.disclaimer, policies?.disclaimer);
  const photoCurrent = answersCurrent(order?.policyVersions?.photoVideo, policies?.photoVideo);
  const disclaimer = (person?.disclaimerAccepted === true && disclaimerCurrent) || recorded?.disclaimer === true;
  const photoAt = millis(member?.consents?.photoVideo?.recordedAt);
  const orderedAt = millis(order?.createdAt);
  const newerPhoto = Boolean(recorded) && photoAt !== null && (orderedAt === null || photoAt > orderedAt);
  const photoConsent = newerPhoto ? recorded.photoConsent : person?.photoConsent === true && photoCurrent;
  return {
    disclaimer,
    disclaimerChanged: !disclaimer && ((person?.disclaimerAccepted === true && usableVersion(policies?.disclaimer?.version)) || recorded?.disclaimerChanged === true),
    photoConsent,
    photoChanged: newerPhoto ? recorded.photoChanged : !photoConsent && person?.photoConsent === true && usableVersion(policies?.photoVideo?.version),
    notices: agreedToNotices(order?.noticeAgreement?.versions, noticeVersions) || recorded?.notices || null
  };
};

/** Ticks what a matched person agreed to before; boxes they ticked themselves stay ticked. */
export const applyConsentPrefill = (person, prefill) => prefill && typeof prefill === 'object' ? {
  ...person, prefill,
  disclaimerAccepted: person.disclaimerAccepted === true || prefill.disclaimer === true,
  photoConsent: person.photoConsent === true || prefill.photoConsent === true
} : person;

/**
 * One photo and video consent answer: the wording version answered, who answered, where, and the notice versions in
 * force. Every record has the same fields, so a newer answer replaces every part of the last.
 */
export const photoConsentRecord = ({ policy, accepted, at, by, source, orderRef = null, notices = [] }) => ({
  policyKey: policy?.policyKey || 'photo-video-consent', version: policy?.version ?? 0, accepted: accepted === true,
  recordedAt: at, by, source, orderRef: orderRef || null,
  notices: (Array.isArray(notices) ? notices : []).map(({ noticeId, version }) => ({ noticeId, version }))
});

/** `[{ noticeId, version }]` from a `{ noticeId: version }` map, to record the notices in force with an answer. */
export const noticeVersionEntries = (versions) => Object.entries(versions && typeof versions === 'object' ? versions : {})
  .map(([noticeId, version]) => ({ noticeId, version }));

/** An answer is a change when there was none before, or it differs in the answer or the wording version answered. */
export const photoConsentChanged = (previous, record) => !previous || previous.accepted !== record.accepted || previous.version !== record.version;

/**
 * Entries to add to `consents.photoVideoHistory` for a new answer. The first change also keeps the answer recorded
 * before histories were kept, so the history shows every answer since.
 */
export const photoHistoryAdditions = (consents, record) => {
  const previous = consents?.photoVideo;
  if (!photoConsentChanged(previous, record)) return [];
  return [...(previous && !Array.isArray(consents?.photoVideoHistory) ? [previous] : []), record];
};

/** 32-bit FNV-1a of the wording with line endings and outer whitespace ignored; the same in the browser and on the server. */
export const wordingFingerprint = (text) => {
  const value = String(text ?? '').replace(/\r\n/g, '\n').trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
};

/** Fingerprints of the consent wording this build shows, sent with a checkout so a page loaded before a change is caught. */
export const checkoutWording = () => ({ disclaimer: wordingFingerprint(DISCLAIMER_TEXT), photoVideo: wordingFingerprint(PHOTO_CONSENT_TEXT) });

export const wordingMatches = (sent) => {
  if (!sent || typeof sent !== 'object') return false;
  return Object.entries(checkoutWording()).every(([key, fingerprint]) => sent[key] === fingerprint);
};

/**
 * A checkout saved before the consent wording changed loses its ticks, and returning people verify again so they are
 * offered only answers given to the new wording.
 */
export const draftForCurrentWording = (draft) => !draft || wordingMatches(draft.wording) ? draft : {
  ...draft,
  people: (Array.isArray(draft.people) ? draft.people : []).map((person) => ({
    ...(person?.returning ? invalidatePersonVerification(person) : person), prefill: null, disclaimerAccepted: false, photoConsent: false
  }))
};
