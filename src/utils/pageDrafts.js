export const pageDraftFingerprint = (content) => JSON.stringify(content);

export const unsavedPageIds = (drafts, savedFingerprints) => Object.keys(drafts)
  .filter((pageId) => pageDraftFingerprint(drafts[pageId]) !== savedFingerprints[pageId]);

export const savePageDraftBatch = async (pageIds, contentByPage, token, savePage, onSaved = () => {}) => {
  const results = [];
  for (const pageId of pageIds) {
    const result = await savePage(pageId, contentByPage[pageId], token);
    onSaved(pageId, contentByPage[pageId], result);
    results.push({ pageId, ...result });
  }
  return results;
};
