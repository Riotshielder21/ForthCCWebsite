import { PAGE_CONTENT, validatePageFields } from '../constants/pageContent.js';
import { BANNER_PAGES, validateBanner, validateTileLayout, validateSupporterTiles } from '../utils/pageTiles.js';
import { readContentDrafts } from './contentDrafts.js';
import { rebaseBranch, rebaseWarning } from './githubRebase.js';
import { rateLimit } from './rateLimit.js';

const publishingSettings = () => ({
  repository: process.env.GITHUB_REPOSITORY || 'Riotshielder21/ForthCCWebsite',
  branch: process.env.GITHUB_CONTENT_BRANCH || 'live/web-admin-edit',
  base: process.env.GITHUB_BRANCH || 'main',
  token: process.env.GITHUB_CONTENT_TOKEN
});

const contentCommitter = () => ({
  name: 'FCC Website Content Manager',
  email: process.env.GITHUB_COMMIT_EMAIL || 'website@forthcanoeclub.co.uk'
});

const createGitHubClient = (repository, token) => {
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
  return {
    url: (path) => `https://api.github.com/repos/${encodedRepository}${path}`,
    request: (url, options = {}) => fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers }
    })
  };
};

const ensureGitHubBranch = async (github, branch, base) => {
  const branchRef = await github.request(github.url(`/git/ref/heads/${encodeURIComponent(branch)}`));
  if (branchRef.ok) return;
  if (branchRef.status !== 404) {
    const error = await branchRef.json().catch(() => ({}));
    throw new Error(error.message || 'Could not read content branch.');
  }

  const baseRef = await github.request(github.url(`/git/ref/heads/${encodeURIComponent(base)}`));
  const baseData = await baseRef.json();
  if (!baseRef.ok) throw new Error(baseData.message || 'Could not read main branch.');

  const createRef = await github.request(github.url('/git/refs'), {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseData.object.sha })
  });
  if (!createRef.ok) {
    const error = await createRef.json();
    throw new Error(error.message || 'Could not create the content review branch.');
  }
};

const validatePublishedContent = (pageId, content) => {
  const validated = validatePageFields(pageId, content);
  if (content.tileLayout !== undefined) {
    validated.tileLayout = validateTileLayout(pageId, content.tileLayout);
  }
  if (pageId === 'home' && content.supporterTiles !== undefined) {
    validated.supporterTiles = validateSupporterTiles(content.supporterTiles);
  }
  if (BANNER_PAGES.includes(pageId) && content.banner !== undefined) {
    validated.banner = validateBanner(pageId, content.banner);
  }
  return validated;
};

/** Saves website page drafts to GitHub and opens review requests; publishing still happens through a merged PR. */
export const registerPagePublishingRoutes = (app, { requireAdmin, notifyReviewRequested }) => {
  const loadDrafts = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!await requireAdmin(req, res)) return;
      const { repository, branch, base, token } = publishingSettings();
      if (!token) {
        return res.status(503).json({ error: 'GitHub publishing is not configured on the API server.' });
      }
      const pages = await readContentDrafts(createGitHubClient(repository, token), branch, base);
      res.json({ branch, pages });
    } catch (error) {
      console.error('Could not check saved page drafts:', error.message);
      res.status(500).json({ error: error.message || 'Could not check saved page drafts.' });
    }
  };

  const savePageDraft = async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const { pageId, content = {} } = req.body;
      const page = PAGE_CONTENT[pageId];
      const { repository, branch, base, token } = publishingSettings();
      if (!token) {
        return res.status(503).json({ error: 'GitHub publishing is not configured on the API server.' });
      }
      if (!page || !content || typeof content !== 'object' || Array.isArray(content)) {
        return res.status(400).json({ error: 'Unknown page or invalid content.' });
      }

      let publishedContent;
      try {
        publishedContent = validatePublishedContent(pageId, content);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      const github = createGitHubClient(repository, token);
      await ensureGitHubBranch(github, branch, base);
      const rebase = await rebaseBranch(github, branch, base, contentCommitter());
      if (rebase.status === 'failed') console.warn('Content branch rebase failed:', rebase.reason);

      const path = `public/content/pages/${pageId}.json`;
      const endpoint = github.url(`/contents/${path}`);
      const currentResponse = await github.request(`${endpoint}?ref=${encodeURIComponent(branch)}`);
      let sha;
      if (currentResponse.ok) {
        sha = (await currentResponse.json()).sha;
      } else if (currentResponse.status !== 404) {
        const errorBody = await currentResponse.json().catch(() => ({}));
        throw new Error(errorBody.message || 'GitHub could not read the current page file.');
      }

      const update = await github.request(endpoint, {
        method: 'PUT',
        body: JSON.stringify({
          message: `Update page content: ${page.label}`,
          content: Buffer.from(`${JSON.stringify(publishedContent, null, 2)}\n`).toString('base64'),
          branch,
          ...(sha ? { sha } : {}),
          committer: contentCommitter()
        })
      });
      const result = await update.json();
      if (!update.ok) throw new Error(result.message || 'GitHub could not save the page file.');

      res.json({
        success: true,
        branch,
        commit: result.commit.sha,
        url: result.content.html_url,
        rebase: rebase.status,
        warning: rebaseWarning(rebase, branch, base)
      });
    } catch (error) {
      console.error('GitHub page draft save failed:', error.message);
      res.status(500).json({ error: error.message || 'Could not save page draft.' });
    }
  };

  const createReviewRequest = async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const { repository, branch, base, token } = publishingSettings();
      if (!token) {
        return res.status(503).json({ error: 'GitHub publishing is not configured on the API server.' });
      }

      const github = createGitHubClient(repository, token);
      const rebase = await rebaseBranch(github, branch, base, contentCommitter());
      if (rebase.status === 'failed') console.warn('Content branch rebase failed:', rebase.reason);
      const comparisonUrl = github.url(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`);
      const compareResponse = await github.request(comparisonUrl);
      const comparison = await compareResponse.json();
      if (!compareResponse.ok) throw new Error(comparison.message || 'Could not compare the draft branch with main.');
      if (comparison.ahead_by === 0) {
        return res.status(409).json({ error: 'There are no saved changes to review.' });
      }

      const owner = repository.split('/')[0];
      const pullsUrl = github.url(`/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${branch}`)}`);
      const pullsResponse = await github.request(pullsUrl);
      const pulls = await pullsResponse.json();
      if (!pullsResponse.ok) throw new Error(pulls.message || 'Could not check for an existing review request.');

      let pullRequest = pulls[0];
      if (!pullRequest) {
        const createResponse = await github.request(github.url('/pulls'), {
          method: 'POST',
          body: JSON.stringify({
            title: 'Review website content updates',
            head: branch,
            base,
            body: `Website content changes are ready for review.\n\nRequested by ${admin.email}. Review the page changes, then approve and merge to publish them through the main-branch Firebase deployment.`
          })
        });
        pullRequest = await createResponse.json();
        if (!createResponse.ok) throw new Error(pullRequest.message || 'Could not create the content review pull request.');
      }

      const assignee = process.env.GITHUB_PR_ASSIGNEE || 'Riotshielder21';
      if (assignee) {
        const assignmentResponse = await github.request(github.url(`/issues/${pullRequest.number}`), {
          method: 'PATCH',
          body: JSON.stringify({ assignees: [assignee] })
        });
        if (!assignmentResponse.ok) {
          console.warn('Could not assign content PR:', (await assignmentResponse.json()).message);
        }
      }

      const reviewers = (process.env.GITHUB_PR_REVIEWERS || 'Riotshielder21')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      if (reviewers.length) {
        const reviewerResponse = await github.request(github.url(`/pulls/${pullRequest.number}/requested_reviewers`), {
          method: 'POST',
          body: JSON.stringify({ reviewers })
        });
        if (!reviewerResponse.ok) {
          console.warn('Could not request content PR reviewers:', (await reviewerResponse.json()).message);
        }
      }

      const notificationSent = await notifyReviewRequested(pullRequest, admin.email);
      res.json({
        success: true,
        number: pullRequest.number,
        url: pullRequest.html_url,
        branch,
        assignee,
        notificationSent,
        rebase: rebase.status,
        warning: rebaseWarning(rebase, branch, base)
      });
    } catch (error) {
      console.error('GitHub content PR failed:', error.message);
      res.status(500).json({ error: error.message || 'Could not create content review request.' });
    }
  };

  app.get('/api/admin/page-drafts', rateLimit(30, 60 * 1000), loadDrafts);
  app.post('/api/admin/publish-page', rateLimit(10, 60 * 1000), savePageDraft);
  app.post('/api/admin/create-content-pr', rateLimit(5, 60 * 1000), createReviewRequest);
};
