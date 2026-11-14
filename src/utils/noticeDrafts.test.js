import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTICE_DRAFTS } from '../constants/noticeDrafts.js';
import { DISCLAIMER, PHOTO_CONSENT, tickWording } from '../constants/consentWording.js';
import { DISCLAIMER_TEXT, PHOTO_CONSENT_TEXT } from './checkout.js';
import { NOTICE_ID_PATTERN, NOTICE_LIMITS, validateNoticeInput } from './notices.js';
import { parseContentLinks, validateContentLinks } from './contentLinks.js';
import { PUBLIC_ROUTES, pagePath } from './routes.js';

const statements = [DISCLAIMER, PHOTO_CONSENT];
const ids = new Set([...NOTICE_DRAFTS, ...statements].map((item) => item.id));

test('every drafted notice can be published as it stands', () => {
  assert.equal(ids.size, NOTICE_DRAFTS.length + statements.length, 'IDs are unique');
  assert.ok(NOTICE_DRAFTS.length <= NOTICE_LIMITS.notices);
  for (const draft of NOTICE_DRAFTS) {
    assert.ok(NOTICE_ID_PATTERN.test(draft.id), draft.id);
    assert.deepEqual(validateNoticeInput(draft), { title: draft.title, body: draft.body }, draft.id);
    assert.doesNotMatch(draft.body, /\[COMMITTEE|\*\*|TODO/, `${draft.id} has no review markers or unsupported bold`);
  }
  for (const id of ['privacy-notice', 'data-retention', 'terms-of-sale', 'first-aid-and-safety', 'copyright', 'cookies-and-analytics', 'data-analytics']) assert.ok(ids.has(id), id);
});

test('links in the notices and ticked statements go to real notices and pages', () => {
  const paths = new Set(Object.values(PUBLIC_ROUTES).map((route) => route.path).concat(pagePath('my-details')));
  for (const item of [...NOTICE_DRAFTS, ...statements]) {
    validateContentLinks(item.body);
    for (const { url } of parseContentLinks(item.body).filter((part) => part.url?.startsWith('/'))) {
      const [path, hash] = url.split('#');
      assert.ok(paths.has(path), `${item.id} links to ${url}`);
      if (path === '/notices' && hash) assert.ok(ids.has(hash), `${item.id} links to notice ${hash}`);
    }
  }
});

test('the recorded tick wording is the statement beside the box and the full text behind it', () => {
  assert.equal(DISCLAIMER_TEXT, tickWording(DISCLAIMER));
  assert.equal(PHOTO_CONSENT_TEXT, tickWording(PHOTO_CONSENT));
  assert.ok(DISCLAIMER_TEXT.startsWith(DISCLAIMER.label) && DISCLAIMER_TEXT.endsWith(DISCLAIMER.body));
  assert.match(PHOTO_CONSENT.label, /^Optional/);
  assert.match(PHOTO_CONSENT.body, /never affects booking/);
  assert.match(DISCLAIMER.label, /parent or guardian/);
});

test('website analytics notice explains the opt-in separately from club statistics', () => {
  const notice = NOTICE_DRAFTS.find(({ id }) => id === 'cookies-and-analytics');
  const dataAnalytics = NOTICE_DRAFTS.find(({ id }) => id === 'data-analytics');
  assert.match(notice.body, /Google Analytics for Firebase is optional/);
  assert.match(notice.body, /Google may use cookies or similar browser storage/);
  assert.match(notice.body, /We do not send purchase events or membership details/);
  assert.match(dataAnalytics.body, /separate from the anonymous club statistics/);
  assert.doesNotMatch(notice.body, /does not identify you|kept for no more than 14 months/);
});
