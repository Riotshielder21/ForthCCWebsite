import test from 'node:test';
import assert from 'node:assert/strict';
import { contentDisposition, findSafeguardingPolicy, isPdf, safeguardingPolicyPath } from './safeguardingPolicies.js';

test('only allowlisted safeguarding policies resolve', () => {
  assert.equal(findSafeguardingPolicy('child-safeguarding-policy')?.title, 'Child Safeguarding Policy');
  assert.equal(findSafeguardingPolicy('../secrets'), null);
  assert.equal(findSafeguardingPolicy('constructor'), null);
});

test('policy paths distinguish opening from downloading', () => {
  assert.equal(safeguardingPolicyPath('adult-safeguarding-policy'), '/api/safeguarding-documents/adult-safeguarding-policy');
  assert.equal(safeguardingPolicyPath('adult-safeguarding-policy', { download: true }), '/api/safeguarding-documents/adult-safeguarding-policy?download=1');
});

test('content disposition opens inline or downloads with a safe filename', () => {
  assert.match(contentDisposition('Club “Policy”.pdf', false), /^inline; filename="Club Policy\.pdf"; filename\*=UTF-8''Club%20%E2%80%9CPolicy%E2%80%9D\.pdf$/);
  assert.match(contentDisposition('Policy.pdf', true), /^attachment; /);
});

test('PDF signature detection rejects HTML responses', () => {
  assert.equal(isPdf(new TextEncoder().encode('%PDF-1.7\n')), true);
  assert.equal(isPdf(new TextEncoder().encode('<!DOCTYPE html>')), false);
});
