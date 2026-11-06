import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageCopy } from '../constants/pageContent.js';
import { pageDraftFingerprint, pageDraftStatus, savePageDraftBatch, unsavedPageIds } from './pageDrafts.js';

const page = (welcome1) => getPageCopy('home', { welcome1 });
const status = (drafts, saved, published) => pageDraftStatus(drafts, saved, { home: published });

test('opening an unchanged page does not create unsaved or unpublished changes', () => {
  const published = page('Published');
  assert.deepEqual(status({}, { home: published }, published), { unsavedIds: [], unpublishedIds: [], uncheckedIds: [] });
});

test('restored browser previews matching published content are clean without a browser saved marker', () => {
  const published = page('Published');
  assert.deepEqual(status({ home: { welcome1: 'Published' } }, { home: published }, published),
    { unsavedIds: [], unpublishedIds: [], uncheckedIds: [] });
});

test('a restored draft already saved to GitHub is unpublished, not unsaved', () => {
  const saved = page('Saved draft');
  assert.deepEqual(status({ home: saved }, { home: saved }, page('Published')),
    { unsavedIds: [], unpublishedIds: ['home'], uncheckedIds: [] });
});

test('new browser edits can coexist with an older saved unpublished draft', () => {
  assert.deepEqual(status({ home: page('New browser edit') }, { home: page('Saved draft') }, page('Published')),
    { unsavedIds: ['home'], unpublishedIds: ['home'], uncheckedIds: [] });
});

test('reverting browser edits to the saved draft clears only the unsaved state', () => {
  const saved = page('Saved draft');
  assert.deepEqual(status({ home: saved }, { home: saved }, page('Published')).unsavedIds, []);
  assert.deepEqual(status({ home: page('Published') }, { home: saved }, page('Published')).unsavedIds, ['home']);
});

test('saved content awaiting deployment remains unpublished until the live page catches up', () => {
  const saved = page('Merged draft');
  assert.deepEqual(status({ home: saved }, { home: saved }, page('Old live page')).unpublishedIds, ['home']);
  assert.deepEqual(status({ home: saved }, { home: saved }, saved),
    { unsavedIds: [], unpublishedIds: [], uncheckedIds: [] });
});

test('discarding a browser preview does not discard its saved unpublished version', () => {
  assert.deepEqual(status({}, { home: page('Saved draft') }, page('Published')),
    { unsavedIds: [], unpublishedIds: ['home'], uncheckedIds: [] });
});

test('unverified saved status is not guessed to be either unsaved or unpublished', () => {
  assert.deepEqual(status({ home: page('Restored draft') }, null, page('Published')),
    { unsavedIds: [], unpublishedIds: [], uncheckedIds: ['home'] });
});

test('published content must finish loading before declaring a saved draft unpublished', () => {
  const saved = page('Saved draft');
  assert.deepEqual(pageDraftStatus({ home: saved }, { home: saved }, {}),
    { unsavedIds: [], unpublishedIds: [], uncheckedIds: ['home'] });
});

test('a browser draft uses published content as its baseline when no separate saved draft exists', () => {
  assert.deepEqual(status({ home: page('Local edit') }, {}, page('Published')),
    { unsavedIds: ['home'], unpublishedIds: [], uncheckedIds: [] });
});

test('fingerprints ignore object-key order but preserve array order and changed field values', () => {
  const first = { banner: { imageUrl: '/photo.webp', enabled: true }, tiles: [{ id: 'one' }, { id: 'two' }] };
  const reordered = { tiles: [{ id: 'one' }, { id: 'two' }], banner: { enabled: true, imageUrl: '/photo.webp' } };
  assert.equal(pageDraftFingerprint(first), pageDraftFingerprint(reordered));
  assert.notEqual(pageDraftFingerprint(first), pageDraftFingerprint({ ...first, tiles: [...first.tiles].reverse() }));
  assert.notEqual(pageDraftFingerprint(first), pageDraftFingerprint({ ...first, banner: { ...first.banner, enabled: false } }));
});

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
