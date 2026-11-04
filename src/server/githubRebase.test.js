import test from 'node:test';
import assert from 'node:assert/strict';
import { rebaseBranch, rebaseWarning } from './githubRebase.js';

/** A tiny in-memory Git host speaking the parts of the GitHub REST API the rebase uses. */
const fakeGitHub = () => {
  let next = 0;
  const id = (prefix) => `${prefix}${String(next++).padStart(4, '0')}`;
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const refs = new Map();
  const blob = (text) => { const sha = `b-${text}`; blobs.set(sha, text); return sha; };
  const tree = (files) => { const sha = id('t'); trees.set(sha, new Map(files)); return sha; };
  const commit = (parent, changes, message = 'change') => {
    const files = new Map(parent ? trees.get(commits.get(parent).tree) : []);
    for (const [path, text] of Object.entries(changes)) text === null ? files.delete(path) : files.set(path, { sha: blob(text), mode: '100644' });
    const sha = id('c');
    commits.set(sha, { tree: tree(files), parents: parent ? [parent] : [], message, author: { name: 'Admin' } });
    return sha;
  };
  const ancestors = (sha) => { const list = []; for (let at = sha; at; at = commits.get(at).parents[0]) list.push(at); return list; };
  const filesOf = (sha) => trees.get(commits.get(sha).tree);
  const changed = (sha) => {
    const before = commits.get(sha).parents[0] ? filesOf(commits.get(sha).parents[0]) : new Map();
    const after = filesOf(sha);
    return [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path)?.sha !== after.get(path)?.sha)
      .map((filename) => ({ filename }));
  };
  const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const request = async (url, options = {}) => {
    const path = decodeURIComponent(url.replace('https://api.github.com/repos/o/r', ''));
    const body = options.body ? JSON.parse(options.body) : null;
    let match;
    if ((match = path.match(/^\/compare\/(.+)\.\.\.(.+)$/))) {
      const base = ancestors(refs.get(match[1]));
      const head = ancestors(refs.get(match[2]));
      const mergeBase = head.find((sha) => base.includes(sha));
      const ahead = head.slice(0, head.indexOf(mergeBase)).reverse();
      return respond({ behind_by: base.indexOf(mergeBase), ahead_by: ahead.length, total_commits: ahead.length, commits: ahead.map((sha) => ({ sha })), merge_base_commit: { sha: mergeBase } });
    }
    if ((match = path.match(/^\/git\/trees\/([^?]+)\?recursive=1$/))) {
      return respond({ truncated: false, tree: [...trees.get(match[1])].map(([entry, file]) => ({ path: entry, type: 'blob', ...file })) });
    }
    if (path === '/git/trees') {
      const files = new Map(trees.get(body.base_tree));
      body.tree.forEach((entry) => entry.sha ? files.set(entry.path, { sha: entry.sha, mode: entry.mode }) : files.delete(entry.path));
      return respond({ sha: tree(files) });
    }
    if (path === '/git/commits') {
      const sha = id('c');
      commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message, author: body.author });
      return respond({ sha });
    }
    if ((match = path.match(/^\/git\/commits\/(.+)$/))) return respond({ sha: match[1], tree: { sha: commits.get(match[1]).tree } });
    if ((match = path.match(/^\/commits\/(.+)$/))) {
      const sha = refs.get(match[1]) || match[1];
      const record = commits.get(sha);
      return respond({ sha, parents: record.parents.map((parent) => ({ sha: parent })), files: changed(sha), commit: { message: record.message, author: record.author, tree: { sha: record.tree } } });
    }
    if ((match = path.match(/^\/git\/refs?\/heads\/(.+)$/))) {
      if (options.method === 'PATCH') refs.set(match[1], body.sha);
      return respond({ object: { sha: refs.get(match[1]) } });
    }
    return respond({ message: `Unhandled ${path}` }, 404);
  };
  const read = (ref) => Object.fromEntries([...filesOf(refs.get(ref))].map(([path, file]) => [path, blobs.get(file.sha)]));
  const messages = (ref, count) => ancestors(refs.get(ref)).slice(0, count).map((sha) => commits.get(sha).message);
  return { github: { url: (path) => `https://api.github.com/repos/o/r${path}`, request }, refs, commit, read, messages };
};

test('content commits are replayed on top of main, keeping main\'s other changes', async () => {
  const host = fakeGitHub();
  const root = host.commit(null, { 'server.js': 'v1', 'pages/home.json': 'home1', 'pages/about.json': 'about1' });
  host.refs.set('edit', host.commit(host.commit(root, { 'pages/home.json': 'home2' }, 'Update home'), { 'pages/about.json': 'about2' }, 'Update about'));
  host.refs.set('main', host.commit(root, { 'server.js': 'v2' }));
  assert.deepEqual(await rebaseBranch(host.github, 'edit', 'main'), { status: 'rebased', replayed: 2, dropped: 0 });
  assert.deepEqual(host.read('edit'), { 'server.js': 'v2', 'pages/home.json': 'home2', 'pages/about.json': 'about2' });
  assert.deepEqual(host.messages('edit', 3), ['Update about', 'Update home', 'change']);
  assert.deepEqual(await rebaseBranch(host.github, 'edit', 'main'), { status: 'up-to-date' });
});

test('commits already merged into main are dropped', async () => {
  const host = fakeGitHub();
  const root = host.commit(null, { 'pages/home.json': 'home1' });
  host.refs.set('edit', host.commit(root, { 'pages/home.json': 'home2' }));
  host.refs.set('main', host.commit(host.commit(root, { 'pages/home.json': 'home2' }, 'Squash merge'), { 'server.js': 'new' }));
  assert.deepEqual(await rebaseBranch(host.github, 'edit', 'main'), { status: 'rebased', replayed: 0, dropped: 1 });
  assert.equal(host.refs.get('edit'), host.refs.get('main'));
});

test('a conflicting change on main leaves the branch untouched and explains why', async () => {
  const host = fakeGitHub();
  const root = host.commit(null, { 'pages/home.json': 'home1' });
  const edit = host.commit(root, { 'pages/home.json': 'admin' });
  host.refs.set('edit', edit);
  host.refs.set('main', host.commit(root, { 'pages/home.json': 'developer' }));
  const result = await rebaseBranch(host.github, 'edit', 'main');
  assert.deepEqual(result, { status: 'failed', reason: 'pages/home.json was also changed on main.' });
  assert.equal(host.refs.get('edit'), edit);
  assert.match(rebaseWarning(result, 'edit', 'main'), /could not be rebased onto main automatically \(pages\/home\.json was also changed on main\.\)\. The change was still saved/);
  assert.equal(rebaseWarning({ status: 'rebased' }, 'edit', 'main'), '');
});

test('API failures are reported rather than thrown', async () => {
  const github = { url: (path) => path, request: async () => ({ ok: false, status: 502, json: async () => ({ message: 'Bad gateway' }) }) };
  assert.deepEqual(await rebaseBranch(github, 'edit', 'main'), { status: 'failed', reason: 'Bad gateway' });
});
