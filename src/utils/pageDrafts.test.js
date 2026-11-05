import test from 'node:test';
import assert from 'node:assert/strict';
import { pageDraftFingerprint, savePageDraftBatch, unsavedPageIds } from './pageDrafts.js';

test('unsaved pages compare local content with the last successfully saved content', () => {
  const drafts = { home: { title: 'Changed home' }, contact: { title: 'Changed contact' } };
  assert.deepEqual(unsavedPageIds(drafts, {}), ['home', 'contact']);
  assert.deepEqual(unsavedPageIds(drafts, { home: pageDraftFingerprint(drafts.home) }), ['contact']);
  assert.deepEqual(unsavedPageIds({}, { home: pageDraftFingerprint(drafts.home) }), []);
});

test('a page-draft batch saves every changed page and records each success', async () => {
  const content = { home: { title: 'Home' }, contact: { title: 'Contact' } };
  const calls = [];
  const saved = [];
  const results = await savePageDraftBatch(['home', 'contact'], content, 'token', async (pageId, page, token) => {
    calls.push({ pageId, page, token });
    return { branch: 'live/web-admin-edit', warning: pageId === 'contact' ? 'Rebase warning' : '' };
  }, (pageId, page) => saved.push({ pageId, page }));

  assert.deepEqual(calls, [
    { pageId: 'home', page: content.home, token: 'token' },
    { pageId: 'contact', page: content.contact, token: 'token' }
  ]);
  assert.deepEqual(saved, [
    { pageId: 'home', page: content.home },
    { pageId: 'contact', page: content.contact }
  ]);
  assert.deepEqual(results.map(({ pageId, warning }) => ({ pageId, warning })), [
    { pageId: 'home', warning: '' },
    { pageId: 'contact', warning: 'Rebase warning' }
  ]);
});

test('a failed page-draft batch records earlier successes without marking the failed page saved', async () => {
  const saved = [];
  await assert.rejects(savePageDraftBatch(['home', 'contact'], { home: {}, contact: {} }, 'token', async (pageId) => {
    if (pageId === 'contact') throw new Error('Save failed');
    return { branch: 'drafts' };
  }, (pageId) => saved.push(pageId)), /Save failed/);
  assert.deepEqual(saved, ['home']);
});
