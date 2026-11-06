import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageCopy } from '../constants/pageContent.js';
import { readContentDrafts } from './contentDrafts.js';

const branch = 'live/web-admin-edit';
const homePath = 'public/content/pages/home.json';
const file = (content) => ({ encoding: 'base64', content: Buffer.from(JSON.stringify(content)).toString('base64') });
const host = (overrides = {}) => {
  const responses = {
    '/git/ref/heads/main': [{ object: { sha: 'main-sha' } }],
    '/contents/public/content/pages?ref=main-sha': [[], 200],
    '/git/ref/heads/live%2Fweb-admin-edit': [{ object: { sha: 'draft-sha' } }],
    '/compare/main-sha...draft-sha': [{ files: [] }],
    ...overrides
  };
  const calls = [];
  return {
    calls,
    github: {
      url: (path) => path,
      request: async (path, options = {}) => {
        assert.equal(options.method || 'GET', 'GET', 'checking draft status must never write to GitHub');
        calls.push(path);
        assert.ok(Object.hasOwn(responses, path), `Unexpected GitHub request: ${path}`);
        const [body, status = 200] = responses[path];
        return Response.json(body, { status });
      }
    }
  };
};

test('a missing review branch uses main and default content as saved baselines', async () => {
  const remote = host({ '/git/ref/heads/live%2Fweb-admin-edit': [{ message: 'Not Found' }, 404] });
  const pages = await readContentDrafts(remote.github, branch, 'main');
  assert.deepEqual(pages.home, getPageCopy('home'));
  assert.ok(!remote.calls.some((path) => path.startsWith('/compare/')));
});

test('main supplies already-merged content even when the review branch is behind', async () => {
  const remote = host({
    '/contents/public/content/pages?ref=main-sha': [[{ type: 'file', path: homePath }]],
    '/contents/public/content/pages/home.json?ref=main-sha': [file({ welcome1: 'Already merged' })]
  });
  const pages = await readContentDrafts(remote.github, branch, 'main');
  assert.equal(pages.home.welcome1, 'Already merged');
  assert.ok(!remote.calls.includes('/contents/public/content/pages/home.json?ref=draft-sha'));
});

test('unmerged page changes override main while unrelated files are ignored', async () => {
  const remote = host({
    '/compare/main-sha...draft-sha': [{ files: [
      { filename: homePath, status: 'modified' },
      { filename: 'server.js', status: 'modified' },
      { filename: 'public/content/pages/unknown.json', status: 'added' }
    ] }],
    '/contents/public/content/pages/home.json?ref=draft-sha': [file({ welcome1: 'Saved, unpublished' })]
  });
  const pages = await readContentDrafts(remote.github, branch, 'main');
  assert.deepEqual(pages.home, getPageCopy('home', { welcome1: 'Saved, unpublished' }));
  assert.ok(remote.calls.every((path) => !path.includes('?ref=live')));
});

test('removing a saved page restores its default baseline without reading a missing file', async () => {
  const remote = host({
    '/contents/public/content/pages?ref=main-sha': [[{ type: 'file', path: homePath }]],
    '/contents/public/content/pages/home.json?ref=main-sha': [file({ welcome1: 'Old custom page' })],
    '/compare/main-sha...draft-sha': [{ files: [{ filename: homePath, status: 'removed' }] }]
  });
  assert.deepEqual((await readContentDrafts(remote.github, branch, 'main')).home, getPageCopy('home'));
});

test('GitHub permission errors are surfaced rather than treated as no saved drafts', async () => {
  const remote = host({ '/git/ref/heads/live%2Fweb-admin-edit': [{ message: 'Permission denied' }, 403] });
  await assert.rejects(readContentDrafts(remote.github, branch, 'main'), /Permission denied/);
});

test('failed reads of main are surfaced rather than using silent default baselines', async () => {
  const remote = host({ '/contents/public/content/pages?ref=main-sha': [{ message: 'Unavailable' }, 503] });
  await assert.rejects(readContentDrafts(remote.github, branch, 'main'), /Unavailable/);
});

test('truncated comparisons cannot misclassify unread saved drafts as clean', async () => {
  const remote = host({ '/compare/main-sha...draft-sha': [{ files: Array.from({ length: 300 }, () => ({ filename: 'other.js' })) }] });
  await assert.rejects(readContentDrafts(remote.github, branch, 'main'), /Too many changed files/);
});

test('malformed stored page content is reported explicitly', async () => {
  const remote = host({
    '/compare/main-sha...draft-sha': [{ files: [{ filename: homePath, status: 'modified' }] }],
    '/contents/public/content/pages/home.json?ref=draft-sha': [file(['not', 'a', 'page'])]
  });
  await assert.rejects(readContentDrafts(remote.github, branch, 'main'), /Invalid saved home draft content/);
});
