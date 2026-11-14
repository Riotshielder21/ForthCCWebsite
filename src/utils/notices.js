import { parseContentLinks, validateContentLinks } from './contentLinks.js';

/**
 * Club notices (privacy, data retention, terms of sale, …) shown on the Notices page. Before launch, edits replace the
 * working version 1; after launch, every change becomes a new numbered version. Checkout asks people to agree to the
 * current version of every published notice, and records exactly which versions they agreed to.
 */
export const NOTICE_LIMITS = { title: 120, body: 60000, notices: 50 };
export const NOTICE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export const noticeIdFromTitle = (title) => String(title || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

export const normaliseNoticeText = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();

/** Throws a readable error for anything an admin cannot publish; returns the cleaned title and body. */
export const validateNoticeInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid notice.');
  const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
  const body = typeof input.body === 'string' ? normaliseNoticeText(input.body) : '';
  if (!title || title.length > NOTICE_LIMITS.title) throw new Error(`Give the notice a title of up to ${NOTICE_LIMITS.title} characters.`);
  if (!body) throw new Error('Write the notice before publishing it.');
  if (body.length > NOTICE_LIMITS.body) throw new Error(`Notices can be up to ${NOTICE_LIMITS.body.toLocaleString('en-GB')} characters.`);
  validateContentLinks(body);
  return { title, body };
};

/**
 * Splits a notice into blocks. Blank lines separate paragraphs; `## ` and `### ` start headings; lines starting `- ` or
 * `1. ` make bulleted or numbered lists. Links use the site's usual `[text](destination)` form inside any block.
 */
export const parseNoticeBlocks = (text) => {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    if (list) blocks.push(list);
    paragraph = [];
    list = null;
  };
  for (const line of normaliseNoticeText(text).split('\n')) {
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() }); }
    else if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ||= { type: 'list', ordered, items: [] };
      list.items.push((bullet || numbered)[1].trim());
    } else if (list && /^\s+\S/.test(line)) list.items[list.items.length - 1] += ` ${line.trim()}`;
    else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
};

/** Plain text of a block's links, for formats that cannot hold a link (such as the PDF): `text (destination)`. */
export const noticePlainText = (text) => parseContentLinks(text)
  .map((part) => part.url ? (part.text === part.url ? part.url : `${part.text} (${part.url})`) : part.text).join('');

export const sortNotices = (notices) => [...notices].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));

/** Notices shown on the page and agreed to at checkout. Notices stay published; changes are new versions. */
export const publishedNotices = (notices) => sortNotices(notices.filter((notice) => notice.currentVersion > 0));

/** `{ noticeId: version }` for the notices someone must agree to now. */
export const noticeVersionMap = (notices) => Object.fromEntries(publishedNotices(notices).map((notice) => [notice.id, notice.currentVersion]));

/**
 * Checks what checkout sent against the current notices. Returns the versions to record, or an error when the person
 * did not agree or agreed to wording that has since changed (including a notice added while they were checking out).
 */
export const checkNoticeAgreement = (notices, agreed) => {
  const current = publishedNotices(notices);
  if (!current.length) return { versions: [] };
  if (!agreed || typeof agreed !== 'object' || Array.isArray(agreed) || !Object.keys(agreed).length) {
    return { error: 'Agree to the club notices before continuing to payment.', code: 'notices_required' };
  }
  const changed = current.filter((notice) => agreed[notice.id] !== notice.currentVersion);
  if (changed.length) {
    return { error: `The club notices have been updated (${changed.map((notice) => notice.title).join(', ')}). Read them again and tick to agree.`, code: 'notices_changed' };
  }
  return { versions: current.map((notice) => ({ noticeId: notice.id, version: notice.currentVersion, title: notice.title })) };
};
