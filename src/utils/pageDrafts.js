import { getPageCopy } from '../constants/pageContent.js';

export const pageDraftFingerprint = (content) => JSON.stringify(content, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
    : value);

export const unsavedPageIds = (drafts, savedFingerprints) => Object.keys(drafts)
  .filter((pageId) => pageDraftFingerprint(drafts[pageId]) !== savedFingerprints[pageId]);

export const pageDraftStatus = (drafts, savedDrafts, publishedPages) => {
  const unsavedIds = [];
  const unpublishedIds = [];
  const uncheckedIds = [];
  const fingerprint = (pageId, content) => pageDraftFingerprint(getPageCopy(pageId, content));

  for (const [pageId, content] of Object.entries(drafts)) {
    if (savedDrafts === null || (!Object.hasOwn(savedDrafts, pageId) && !Object.hasOwn(publishedPages, pageId))) {
      uncheckedIds.push(pageId);
      continue;
    }
    const saved = Object.hasOwn(savedDrafts, pageId) ? savedDrafts[pageId] : publishedPages[pageId];
    if (fingerprint(pageId, content) !== fingerprint(pageId, saved)) unsavedIds.push(pageId);
  }
  for (const [pageId, content] of Object.entries(savedDrafts || {})) {
    if (!Object.hasOwn(publishedPages, pageId)) {
      if (!uncheckedIds.includes(pageId)) uncheckedIds.push(pageId);
      continue;
    }
    if (fingerprint(pageId, content) !== fingerprint(pageId, publishedPages[pageId])) unpublishedIds.push(pageId);
  }
  return { unsavedIds, unpublishedIds, uncheckedIds };
};

export const savePageDraftBatch = async (pageIds, contentByPage, token, savePage, onSaved = () => {}) => {
  const results = [];
  for (const pageId of pageIds) {
    const result = await savePage(pageId, contentByPage[pageId], token);
    onSaved(pageId, contentByPage[pageId], result);
    results.push({ pageId, ...result });
  }
  return results;
};
