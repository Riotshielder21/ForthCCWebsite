import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNoticeAgreement, noticeIdFromTitle, noticePlainText, noticeVersionMap, NOTICE_ID_PATTERN, parseNoticeBlocks, publishedNotices, validateNoticeInput
} from './notices.js';

test('notice IDs are slugs made from the title', () => {
  assert.equal(noticeIdFromTitle('Privacy Notice'), 'privacy-notice');
  assert.equal(noticeIdFromTitle('  Café & Boat-house Rules!  '), 'cafe-boat-house-rules');
  assert.equal(noticeIdFromTitle('x'.repeat(80)).length, 60);
  assert.ok(NOTICE_ID_PATTERN.test('data-retention'));
  assert.ok(!NOTICE_ID_PATTERN.test('-bad'));
  assert.ok(!NOTICE_ID_PATTERN.test('Bad'));
  assert.ok(!NOTICE_ID_PATTERN.test('a/b'));
});

test('notice input is cleaned and checked', () => {
  assert.deepEqual(validateNoticeInput({ title: '  Privacy   notice ', body: 'Line one  \r\nLine two\n\n' }), { title: 'Privacy notice', body: 'Line one\nLine two' });
  assert.throws(() => validateNoticeInput({ title: '', body: 'Text' }), /title/);
  assert.throws(() => validateNoticeInput({ title: 'T', body: '   ' }), /Write the notice/);
  assert.throws(() => validateNoticeInput({ title: 'T'.repeat(121), body: 'Text' }), /title/);
  assert.throws(() => validateNoticeInput({ title: 'T', body: 'x'.repeat(60001) }), /60,000/);
  assert.throws(() => validateNoticeInput({ title: 'T', body: '[bad](javascript:alert(1))' }));
  assert.throws(() => validateNoticeInput(null), /Invalid/);
});

test('notice text splits into headings, paragraphs and lists', () => {
  const blocks = parseNoticeBlocks([
    '## Who we are', 'Forth Canoe Club.', 'Second line.', '', '- one', '- two', '  continued', '1. first', '2) second', '### Rights', 'Ask us.'
  ].join('\n'));
  assert.deepEqual(blocks, [
    { type: 'heading', level: 2, text: 'Who we are' },
    { type: 'paragraph', text: 'Forth Canoe Club.\nSecond line.' },
    { type: 'list', ordered: false, items: ['one', 'two continued'] },
    { type: 'list', ordered: true, items: ['first', 'second'] },
    { type: 'heading', level: 3, text: 'Rights' },
    { type: 'paragraph', text: 'Ask us.' }
  ]);
});

test('links become plain text for the PDF', () => {
  assert.equal(noticePlainText('See [our page](/contact) or https://example.org.'), 'See our page (/contact) or https://example.org.');
});

const notices = [
  { id: 'terms', title: 'Terms', order: 1, currentVersion: 2 },
  { id: 'privacy-notice', title: 'Privacy', order: 0, currentVersion: 3 },
  { id: 'old', title: 'Old', order: 2, currentVersion: 1, archived: true },
  { id: 'draft', title: 'Draft', order: 3, currentVersion: 0 }
];

test('all published notices remain shown and agreed to, in order', () => {
  assert.deepEqual(publishedNotices(notices).map((notice) => notice.id), ['privacy-notice', 'terms', 'old']);
  assert.deepEqual(noticeVersionMap(notices), { 'privacy-notice': 3, terms: 2, old: 1 });
});

test('checkout agreement must match the current versions', () => {
  assert.deepEqual(checkNoticeAgreement([], undefined), { versions: [] });
  assert.equal(checkNoticeAgreement(notices, undefined).code, 'notices_required');
  assert.equal(checkNoticeAgreement(notices, {}).code, 'notices_required');
  assert.equal(checkNoticeAgreement(notices, ['terms']).code, 'notices_required');
  const changed = checkNoticeAgreement(notices, { 'privacy-notice': 2, terms: 2 });
  assert.equal(changed.code, 'notices_changed');
  assert.match(changed.error, /Privacy/);
  assert.equal(checkNoticeAgreement(notices, { terms: 2 }).code, 'notices_changed');
  assert.deepEqual(checkNoticeAgreement(notices, { 'privacy-notice': 3, terms: 2, old: 1 }), {
    versions: [
      { noticeId: 'privacy-notice', version: 3, title: 'Privacy' },
      { noticeId: 'terms', version: 2, title: 'Terms' },
      { noticeId: 'old', version: 1, title: 'Old' }
    ]
  });
});
