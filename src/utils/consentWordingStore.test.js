import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONSENT_WORDING, getConsentWording, mergeConsentWording, setConsentWording } from './consentWordingStore.js';
import { checkoutWording, wordingMatches } from './consents.js';

test('published wording replaces the defaults and malformed entries are ignored', () => {
  const merged = mergeConsentWording({ disclaimer: { label: 'I agree', body: 'New text' }, photoVideo: { label: '', body: 42 } });
  assert.equal(merged.disclaimer.label, 'I agree');
  assert.equal(merged.disclaimer.id, DEFAULT_CONSENT_WORDING.disclaimer.id);
  assert.deepEqual(merged.photoVideo, DEFAULT_CONSENT_WORDING.photoVideo);
});

test('a wording change changes the fingerprints, so older pages are refused', () => {
  const before = checkoutWording();
  setConsentWording({ disclaimer: { label: 'Edited', body: 'Edited body' } });
  assert.equal(getConsentWording().disclaimer.label, 'Edited');
  assert.equal(wordingMatches(before), false);
  assert.equal(wordingMatches(checkoutWording()), true);
  setConsentWording(null);
  assert.equal(wordingMatches(before), true);
});
