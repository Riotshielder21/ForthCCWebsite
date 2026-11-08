import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPerson, invalidatePersonVerification, DISCLAIMER_TEXT, PHOTO_CONSENT_TEXT } from './checkout.js';
import {
  applyConsentPrefill, checkoutWording, consentPrefill, draftForCurrentWording, photoConsentChanged, photoConsentRecord, photoHistoryAdditions,
  retryConsentPrefill, sameNoticeVersions, wordingFingerprint, wordingMatches
} from './consents.js';

const policies = { disclaimer: { policyKey: 'participation-disclaimer', version: 3 }, photoVideo: { policyKey: 'photo-video-consent', version: 2 } };
const notices = { 'privacy-notice': 2, 'code-of-conduct': 1 };
const agreedNotices = { versions: [{ noticeId: 'privacy-notice', version: 2, title: 'Privacy notice' }, { noticeId: 'code-of-conduct', version: 1, title: 'Code of conduct' }] };
const member = (consents) => ({ firstName: 'A', lastName: 'B', consents });

test('answers to the current wording are ticked in advance', () => {
  const prefill = consentPrefill(member({ disclaimer: { version: 3 }, photoVideo: { version: 2, accepted: true }, notices: agreedNotices }), policies, notices);
  assert.deepEqual(prefill, { disclaimer: true, disclaimerChanged: false, photoConsent: true, photoChanged: false, notices });
});

test('changed wording needs a fresh answer and says why', () => {
  const prefill = consentPrefill(member({ disclaimer: { version: 2 }, photoVideo: { version: 1, accepted: true } }), policies, notices);
  assert.equal(prefill.disclaimer, false);
  assert.equal(prefill.disclaimerChanged, true);
  assert.equal(prefill.photoConsent, false);
  assert.equal(prefill.photoChanged, true);
  const legacy = consentPrefill(member({ photoVideo: { accepted: true, legacyUnversioned: true, recordedAt: null, by: 'self' } }), policies, notices);
  assert.equal(legacy.photoConsent, false, 'unversioned consent is asked again');
  assert.equal(legacy.photoChanged, true);
});

test('a withdrawal or no answer is never ticked and is not reported as changed wording', () => {
  for (const consents of [{ photoVideo: { version: 2, accepted: false } }, { photoVideo: { version: 1, accepted: false } }, {}, undefined]) {
    const prefill = consentPrefill(member(consents), policies, notices);
    assert.equal(prefill.photoConsent, false);
    assert.equal(prefill.photoChanged, false);
    assert.equal(prefill.disclaimer, false);
    assert.equal(prefill.disclaimerChanged, false);
    assert.equal(prefill.notices, null);
  }
});

test('nothing is ticked while the current version is unknown, and pre-live answers only match pre-live', () => {
  const unsynced = { disclaimer: { version: 0 }, photoVideo: { version: 0 } };
  const prefill = consentPrefill(member({ disclaimer: { version: 0 }, photoVideo: { version: 0, accepted: true } }), unsynced, notices);
  assert.deepEqual([prefill.disclaimer, prefill.disclaimerChanged, prefill.photoConsent, prefill.photoChanged], [false, false, false, false]);
  const preLive = { disclaimer: { version: 'pre-live' }, photoVideo: { version: 'pre-live' } };
  assert.equal(consentPrefill(member({ disclaimer: { version: 'pre-live' } }), preLive, {}).disclaimer, true);
  assert.equal(consentPrefill(member({ disclaimer: { version: 'pre-live' } }), policies, {}).disclaimer, false);
});

test('notices are only ticked in advance when every published notice was agreed at its current version', () => {
  assert.equal(consentPrefill(member({ notices: agreedNotices }), policies, { ...notices, 'privacy-notice': 3 }).notices, null);
  assert.equal(consentPrefill(member({ notices: agreedNotices }), policies, { ...notices, 'new-notice': 1 }).notices, null);
  assert.deepEqual(consentPrefill(member({ notices: agreedNotices }), policies, { 'privacy-notice': 2 }).notices, { 'privacy-notice': 2 });
  assert.equal(consentPrefill(member({ notices: agreedNotices }), policies, null).notices, null);
  assert.equal(sameNoticeVersions({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameNoticeVersions({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(sameNoticeVersions({ a: 1 }, { a: 2 }), false);
  assert.equal(sameNoticeVersions(null, {}), false);
});

test('pre-fill keeps boxes the person ticked and clears with the verification it came from', () => {
  const person = { ...blankPerson('p'), returning: true, verifiedDob: '1990-01-01' };
  const prefilled = applyConsentPrefill(person, { disclaimer: true, photoConsent: false, photoChanged: true, notices: null });
  assert.equal(prefilled.disclaimerAccepted, true);
  assert.equal(prefilled.photoConsent, false);
  assert.equal(applyConsentPrefill({ ...person, photoConsent: true }, { disclaimer: false, photoConsent: false }).photoConsent, true);
  assert.equal(applyConsentPrefill(person, undefined), person);
  const cleared = invalidatePersonVerification({ ...prefilled, photoConsent: true });
  assert.deepEqual([cleared.prefill, cleared.disclaimerAccepted, cleared.photoConsent, cleared.verifiedDob], [null, false, false, '']);
  const typed = invalidatePersonVerification({ ...person, disclaimerAccepted: true });
  assert.equal(typed.disclaimerAccepted, true, 'boxes ticked without a pre-fill stay ticked');
});

test('photo consent records always have the same fields and keep only notice versions', () => {
  const at = new Date('2026-05-01T10:00:00Z');
  const record = photoConsentRecord({ policy: policies.photoVideo, accepted: true, at, by: 'guardian', source: 'checkout', orderRef: 'FCC-1',
    notices: [{ noticeId: 'privacy-notice', version: 2, title: 'Privacy notice' }] });
  assert.deepEqual(record, { policyKey: 'photo-video-consent', version: 2, accepted: true, recordedAt: at, by: 'guardian', source: 'checkout',
    orderRef: 'FCC-1', notices: [{ noticeId: 'privacy-notice', version: 2 }] });
  const withdrawn = photoConsentRecord({ policy: undefined, accepted: 'yes', at, by: 'self', source: 'my-details' });
  assert.deepEqual(Object.keys(withdrawn), Object.keys(record));
  assert.deepEqual([withdrawn.policyKey, withdrawn.version, withdrawn.accepted, withdrawn.orderRef, withdrawn.notices], ['photo-video-consent', 0, false, null, []]);
});

test('the history gains an entry only when the answer or wording version changes, keeping the answer before it', () => {
  const at = new Date('2026-05-01T10:00:00Z');
  const yes = photoConsentRecord({ policy: policies.photoVideo, accepted: true, at, by: 'self', source: 'checkout' });
  const no = { ...yes, accepted: false, source: 'my-details' };
  assert.equal(photoConsentChanged(undefined, yes), true);
  assert.equal(photoConsentChanged(yes, { ...yes, recordedAt: new Date() }), false);
  assert.equal(photoConsentChanged(yes, no), true);
  assert.equal(photoConsentChanged(yes, { ...yes, version: 3 }), true);
  assert.deepEqual(photoHistoryAdditions(undefined, yes), [yes]);
  assert.deepEqual(photoHistoryAdditions({ photoVideo: yes, photoVideoHistory: [yes] }, { ...yes, orderRef: 'FCC-2' }), []);
  assert.deepEqual(photoHistoryAdditions({ photoVideo: yes, photoVideoHistory: [yes] }, no), [no]);
  const legacy = { accepted: true, legacyUnversioned: true, recordedAt: null, by: 'self' };
  assert.deepEqual(photoHistoryAdditions({ photoVideo: legacy }, no), [legacy, no], 'the answer from before histories is kept');
});

test('wording fingerprints follow the wording, not its line endings or outer spaces', () => {
  assert.equal(wordingFingerprint('  Hello\r\nworld \n'), wordingFingerprint('Hello\nworld'));
  assert.notEqual(wordingFingerprint('Hello world'), wordingFingerprint('Hello world.'));
  assert.match(wordingFingerprint(''), /^[0-9a-f]{8}$/);
  assert.equal(wordingFingerprint('a'), 'e40c292c', 'standard 32-bit FNV-1a');
  assert.deepEqual(checkoutWording(), { disclaimer: wordingFingerprint(DISCLAIMER_TEXT), photoVideo: wordingFingerprint(PHOTO_CONSENT_TEXT) });
  assert.equal(wordingMatches(checkoutWording()), true);
  for (const sent of [undefined, null, 'x', {}, { ...checkoutWording(), disclaimer: '00000000' }, { disclaimer: checkoutWording().disclaimer }]) {
    assert.equal(wordingMatches(sent), false);
  }
});

test('a saved checkout from before the wording changed loses its ticks and returning people verify again', () => {
  const returning = { ...blankPerson('r'), returning: true, firstName: 'A', lastName: 'B', dob: '1990-01-01', verifiedDob: '1990-01-01',
    verifiedEmail: 'a@example.com', verifiedName: 'a b', disclaimerAccepted: true, photoConsent: true, prefill: { disclaimer: true, photoConsent: true } };
  const fresh = { ...blankPerson('n'), disclaimerAccepted: true, photoConsent: true };
  const current = { email: 'a@example.com', people: [returning, fresh], wording: checkoutWording() };
  assert.equal(draftForCurrentWording(current), current);
  assert.equal(draftForCurrentWording(null), null);
  const stale = draftForCurrentWording({ ...current, wording: { disclaimer: 'old', photoVideo: 'old' } });
  assert.deepEqual(stale.people.map((person) => [person.disclaimerAccepted, person.photoConsent, person.prefill]), [[false, false, null], [false, false, null]]);
  assert.equal(stale.people[0].verifiedDob, '');
  assert.equal(stale.people[1].firstName, fresh.firstName);
  assert.equal(draftForCurrentWording({ email: 'a@example.com', people: [fresh] }).people[0].disclaimerAccepted, false, 'drafts saved before fingerprints were kept count as stale');
});

test('a retry offers the failed order\'s answers while their wording is current, unless the record has a newer answer', () => {
  const at = (millis) => ({ toMillis: () => millis });
  const order = { createdAt: at(1000), policyVersions: policies, noticeAgreement: agreedNotices };
  const person = { id: 'p1', disclaimerAccepted: true, photoConsent: true };
  assert.deepEqual(retryConsentPrefill({ person, order, policies, noticeVersions: notices }),
    { disclaimer: true, disclaimerChanged: false, photoConsent: true, photoChanged: false, notices });
  const newer = { ...policies, photoVideo: { ...policies.photoVideo, version: 3 } };
  const changed = retryConsentPrefill({ person, order, policies: newer, noticeVersions: { ...notices, 'privacy-notice': 3 } });
  assert.deepEqual([changed.photoConsent, changed.photoChanged, changed.disclaimer, changed.notices], [false, true, true, null], 'changed wording or notices are asked again');

  const withdrawn = member({ disclaimer: { version: 3 }, photoVideo: { version: 2, accepted: false, recordedAt: at(2000) } });
  const later = retryConsentPrefill({ person, order, member: withdrawn, policies, noticeVersions: notices });
  assert.deepEqual([later.photoConsent, later.photoChanged], [false, false], 'a withdrawal after the order wins');
  const earlier = member({ photoVideo: { version: 2, accepted: false, recordedAt: at(500) } });
  assert.equal(retryConsentPrefill({ person, order, member: earlier, policies, noticeVersions: notices }).photoConsent, true, 'the order is newer than that answer');
  const given = member({ photoVideo: { version: 2, accepted: true, recordedAt: at(2000) } });
  assert.equal(retryConsentPrefill({ person: { ...person, photoConsent: false }, order, member: given, policies, noticeVersions: notices }).photoConsent, true);

  const unticked = retryConsentPrefill({ person: { id: 'p1' }, order: { createdAt: at(1000), policyVersions: policies }, member: member({ disclaimer: { version: 3 } }), policies, noticeVersions: notices });
  assert.equal(unticked.disclaimer, true, 'the record\'s current disclaimer counts too');
  assert.equal(unticked.notices, null, 'no notice agreement on either');
  const stale = retryConsentPrefill({ person, order: { ...order, policyVersions: { ...policies, disclaimer: { version: 2 } } }, policies, noticeVersions: notices });
  assert.deepEqual([stale.disclaimer, stale.disclaimerChanged], [false, true]);
  assert.deepEqual(retryConsentPrefill({ person, order: { createdAt: at(1000) }, member: member({ notices: agreedNotices }), policies, noticeVersions: notices }).notices, notices,
    'the record\'s notice agreement is used when the order has none');
});
