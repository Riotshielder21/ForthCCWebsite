import { getPageCopy, PAGE_CONTENT } from '../constants/pageContent.js';

const readJson = async (github, path) => {
  const response = await github.request(github.url(path));
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `Could not read saved drafts (${response.status}).`);
  return body;
};

const pageIdForPath = (path) => {
  const pageId = /^public\/content\/pages\/([a-z0-9-]+)\.json$/.exec(path)?.[1];
  return pageId && Object.hasOwn(PAGE_CONTENT, pageId) ? pageId : null;
};

const readPage = async (github, pageId, path, sha) => {
  const saved = await readJson(github, `/contents/${path}?ref=${encodeURIComponent(sha)}`);
  if (saved.encoding !== 'base64' || typeof saved.content !== 'string') throw new Error(`Invalid saved ${pageId} draft response.`);
  const content = JSON.parse(Buffer.from(saved.content, 'base64').toString('utf8'));
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error(`Invalid saved ${pageId} draft content.`);
  return getPageCopy(pageId, content);
};

export const readContentDrafts = async (github, branch, base) => {
  // Use main for unchanged files; a review branch can still contain old files after a merge.
  const baseReference = await readJson(github, `/git/ref/heads/${encodeURIComponent(base)}`);
  const baseSha = baseReference.object?.sha;
  if (typeof baseSha !== 'string') throw new Error('Invalid published-content branch response.');
  const directory = await github.request(github.url(`/contents/public/content/pages?ref=${encodeURIComponent(baseSha)}`));
  let files = [];
  if (directory.status !== 404) {
    const body = await directory.json();
    if (!directory.ok) throw new Error(body.message || 'Could not read published page files.');
    if (!Array.isArray(body)) throw new Error('Invalid published page files response.');
    files = body;
  }
  const savedPages = Object.fromEntries(Object.keys(PAGE_CONTENT).map((pageId) => [pageId, getPageCopy(pageId)]));
  for (const [pageId, content] of await Promise.all(files.filter((file) => file.type === 'file' && pageIdForPath(file.path))
    .map(async (file) => [pageIdForPath(file.path), await readPage(github, pageIdForPath(file.path), file.path, baseSha)]))) {
    savedPages[pageId] = content;
  }

  const reference = await github.request(github.url(`/git/ref/heads/${encodeURIComponent(branch)}`));
  if (reference.status === 404) return savedPages;
  const head = await reference.json();
  if (!reference.ok) throw new Error(head.message || 'Could not read the saved-draft branch.');
  if (typeof head.object?.sha !== 'string') throw new Error('Invalid saved-draft branch response.');

  const comparison = await readJson(github, `/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(head.object.sha)}`);
  if (!Array.isArray(comparison.files)) throw new Error('Invalid saved-draft comparison response.');
  if (comparison.files.length >= 300) throw new Error('Too many changed files to check saved drafts safely.');

  for (const file of comparison.files) {
    const previousPageId = pageIdForPath(file.previous_filename);
    if (file.status === 'renamed' && previousPageId) savedPages[previousPageId] = getPageCopy(previousPageId);
  }
  await Promise.all(comparison.files.map(async (file) => {
    const pageId = pageIdForPath(file.filename);
    if (!pageId) return;
    savedPages[pageId] = file.status === 'removed' ? getPageCopy(pageId)
      : await readPage(github, pageId, file.filename, head.object.sha);
  }));
  return savedPages;
};
