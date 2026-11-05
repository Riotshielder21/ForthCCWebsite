import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContentLinks, validateContentLinks, replaceContentLink, validateContentButton } from './contentLinks.js';
import { getPageCopy, validatePageFields } from '../constants/pageContent.js';
import { validateTileLayout } from './pageTiles.js';
import { safeTileUrl } from './contentLinks.js';

test('plain text, newlines and multiple inline links retain their order and ranges', () => {
  const text = 'Try [beginners](/?page=beginners).\n[Email us](mailto:hello@example.com)';
  const parts = parseContentLinks(text);
  assert.deepEqual(parts.map(({ text, url }) => ({ text, ...(url ? { url } : {}) })), [
    { text: 'Try ' }, { text: 'beginners', url: '/?page=beginners' },
    { text: '.\n' }, { text: 'Email us', url: 'mailto:hello@example.com' }
  ]);
  assert.equal(parts.map((part) => text.slice(part.start, part.end)).join(''), text);
  assert.equal(validateContentLinks(text), text);
  assert.equal(validateContentLinks('Original plain text\nSecond paragraph'), 'Original plain text\nSecond paragraph');
});

test('links can be added, edited, removed and inserted without losing surrounding text', () => {
  const added = replaceContentLink('Try beginners today.', 4, 13, 'beginners', '/?page=beginners');
  assert.equal(added, 'Try [beginners](/?page=beginners) today.');
  const link = parseContentLinks(added).find((part) => part.url);
  assert.equal(replaceContentLink(added, link.start, link.end, 'classes', 'https://example.com'),
    'Try [classes](https://example.com) today.');
  assert.equal(replaceContentLink(added, link.start, link.end, 'beginners', ''), 'Try beginners today.');
  assert.equal(replaceContentLink('Try ', 4, 4, 'classes', '/?page=beginners'), 'Try [classes](/?page=beginners)');
  assert.equal(replaceContentLink('', 0, 0, 'Details', 'https://example.com/a(b)'), '[Details](https://example.com/a%28b%29)');
});

test('unsafe links and invalid labels produce explicit validation errors', () => {
  for (const url of ['javascript:alert%281%29', 'data:text/html,test', 'http://example.com']) {
    assert.throws(() => validateContentLinks(`[test](${url})`), /Links must/);
    assert.throws(() => replaceContentLink('test', 0, 4, 'test', url));
  }
  for (const label of ['', '[]', 'two\nlines']) assert.throws(() => replaceContentLink('', 0, 0, label, '/'));
  assert.throws(() => replaceContentLink('', 0, 0, 'test', '/has space'));
});

test('existing and custom tiles round-trip independent buttons and inline links', () => {
  const button = { label: 'Beginners', url: '/?page=beginners' };
  for (const type of ['existing', 'text', 'image', 'link']) {
    const tile = { id: type === 'existing' ? 'welcome' : `new-${type}`, group: 'intro', type, button };
    if (type !== 'existing') tile.description = 'Try [classes](/?page=beginners)';
    const [saved] = validateTileLayout('home', [tile]);
    assert.deepEqual(saved.button, button);
    assert.deepEqual(getPageCopy('home', { tileLayout: [saved] }).tileLayout, [saved]);
    assert.equal(validateTileLayout('home', [{ ...tile, button: null }])[0].button, null);
    assert.equal(Object.hasOwn(validateTileLayout('home', [{ ...tile, button: undefined }])[0], 'button'), false);
  }
  assert.throws(() => validateContentButton({ label: 'Test', url: '' }));
  assert.throws(() => validateContentButton({ label: '', url: '/' }));
  assert.throws(() => validateContentButton({ label: 'Test', url: 'javascript:alert(1)' }));
  assert.throws(() => validateTileLayout('home', [{ id: 'new-text', group: 'intro', type: 'text', description: '[bad](javascript:evil)' }]));
});

test('published page fields keep defaults and validate links before saving', () => {
  const welcome1 = 'Come to [beginners](/?page=beginners) or [email](mailto:hello@example.com).';
  const fields = validatePageFields('home', { welcome1 });
  assert.equal(fields.welcome1, welcome1);
  assert.equal(getPageCopy('home', fields).welcome1, welcome1);
  assert.equal(fields.welcomeTitle, 'Welcome');
  assert.throws(() => validatePageFields('home', { welcome1: '[bad](javascript:evil)' }));
  assert.equal(validatePageFields('home', { start1Url: '/relative' }).start1Url, '/relative');
  assert.throws(() => validatePageFields('home', { start1Url: '//external.example' }));
  assert.throws(() => validatePageFields('home', { welcome1: 123 }));
  assert.throws(() => validatePageFields('home', { welcome1: 'a'.repeat(20001) }));
  assert.throws(() => validatePageFields('unknown', {}));
});

test('legacy split paragraphs migrate without losing saved text, links, or deletions', () => {
  const saved = { welcome4Before: 'Start with', welcome4Link: 'our classes', welcome4After: 'on Thursdays.' };
  const copy = getPageCopy('home', saved);
  assert.equal(copy.welcome4Text, 'Start with [our classes](/beginners) on Thursdays.');
  assert.equal(validatePageFields('home', saved).welcome4Text, copy.welcome4Text);
  assert.equal(getPageCopy('home', { ...saved, welcome4Text: 'Completely rewritten.' }).welcome4Text, 'Completely rewritten.');
  assert.equal(getPageCopy('home', { ...saved, welcome4Text: '' }).welcome4Text, '');
  assert.match(getPageCopy('home', { start1Url: 'https://example.com/map' }).start1Text, /\(https:\/\/example.com\/map\)/);
});

test('old club destinations stay local and the old Access Project timeline goes directly to its public board', () => {
  assert.equal(safeTileUrl('https://www.forthcanoeclub.co.uk/membership'), '/membership');
  assert.equal(safeTileUrl('/?page=contact'), '/contact-us');
  assert.equal(safeTileUrl('/images/photo.webp', true), '/images/photo.webp');
  assert.equal(safeTileUrl('https://new.forthcanoeclub.co.uk/images/photo.webp', true), '/images/photo.webp');
  assert.equal(getPageCopy('access-project', { timelineUrl: 'https://www.forthcanoeclub.co.uk/access-project' }).timelineUrl,
    'https://trello.com/b/4ABvVtTg/fcc-access-project');
});
