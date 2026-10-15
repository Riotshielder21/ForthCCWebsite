import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKOUT_POLICY_KEYS, POLICY_DEFINITIONS, planPolicyUpdates, policyHash, resolvePolicyText } from './policies.js';

const fixed = [
  { key: 'a', name: 'A', kind: 'disclaimer', field: 'text', text: () => 'Wording A' },
  { key: 'b', name: 'B', kind: 'privacy', field: 'text', text: () => '' },
  { key: 'c', name: 'C', kind: 'safety', page: 'safety', field: 'statement' }
];

test('hashing ignores line endings and outer whitespace but not wording', () => {
  assert.equal(policyHash('  Hello\r\nworld \n'), policyHash('Hello\nworld'));
  assert.notEqual(policyHash('Hello world'), policyHash('Hello  world'));
});

test('wording is read from code or from the published page field', () => {
  assert.equal(resolvePolicyText(fixed[0]), 'Wording A');
  assert.equal(resolvePolicyText(fixed[2], { safety: { statement: ' Be safe. ' } }), 'Be safe.');
  assert.equal(resolvePolicyText(fixed[2], {}), '');
});

test('new wording becomes version 1, unchanged wording is kept and edits become the next version', () => {
  const first = planPolicyUpdates(fixed, new Map(), { safety: { statement: 'Be safe.' } });
  assert.deepEqual(first.map((step) => step.action), ['version', 'register', 'version']);
  assert.deepEqual([first[0].version, first[0].supersedes], [1, null]);

  const current = new Map([['a', { version: 1, hash: policyHash('Wording A') }], ['b', { version: 0, hash: '' }], ['c', { version: 2, hash: policyHash('Be safe.') }]]);
  assert.deepEqual(planPolicyUpdates(fixed, current, { safety: { statement: 'Be safe.' } }).map((step) => step.action), ['keep', 'keep', 'keep']);
  const edited = planPolicyUpdates(fixed, current, { safety: { statement: 'Be very safe.' } });
  assert.deepEqual([edited[2].action, edited[2].version, edited[2].supersedes], ['version', 3, 2]);
});

test('the checkout consents are tracked policies', () => {
  const keys = new Set(POLICY_DEFINITIONS.map((definition) => definition.key));
  for (const key of Object.values(CHECKOUT_POLICY_KEYS)) assert.ok(keys.has(key), key);
  const real = planPolicyUpdates(POLICY_DEFINITIONS, new Map());
  assert.deepEqual(real.filter((step) => step.action === 'version').map((step) => step.definition.key).sort(), ['participation-disclaimer', 'photo-video-consent']);
});
