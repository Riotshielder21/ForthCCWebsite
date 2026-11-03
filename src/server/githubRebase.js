/**
 * Keeps the admin content branch up to date with the base branch through the GitHub API, which has no rebase endpoint.
 * The branch's own commits are replayed one by one on top of the base branch; a file is only copied across when the base
 * still has the version the commit started from, so nothing changed on the base is overwritten. Commits whose changes
 * are already on the base (for example after the review PR was merged) are dropped.
 *
 * Never throws: on any problem the branch is left exactly as it was and `{ status: 'failed', reason }` explains why, so
 * the save can go ahead and someone can rebase by hand.
 */
const call = async (github, path, options) => {
  const response = await github.request(github.url(path), options && { ...options, body: JSON.stringify(options.body) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub request failed (${response.status}).`);
  return body;
};

/** `Map(path → { sha, mode })` for every file in a tree. */
const readTree = async (github, treeSha) => {
  const tree = await call(github, `/git/trees/${treeSha}?recursive=1`);
  if (tree.truncated) throw new Error('The repository is too large to rebase through the GitHub API.');
  return new Map(tree.tree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, { sha: entry.sha, mode: entry.mode }]));
};

export const rebaseBranch = async (github, branch, base, committer) => {
  try {
    const encodedBranch = encodeURIComponent(branch);
    const comparison = await call(github, `/compare/${encodeURIComponent(base)}...${encodedBranch}`);
    if (!comparison.behind_by) return { status: 'up-to-date' };
    const headSha = comparison.commits.at(-1)?.sha || comparison.merge_base_commit.sha;
    const baseHead = await call(github, `/commits/${encodeURIComponent(base)}`);
    if (comparison.total_commits > comparison.commits.length) throw new Error('The branch has too many commits to rebase automatically.');

    let parent = baseHead.sha;
    let files = await readTree(github, baseHead.commit.tree.sha);
    const originals = new Map();
    const originalTree = async (sha) => {
      if (!originals.has(sha)) originals.set(sha, await readTree(github, (await call(github, `/git/commits/${sha}`)).tree.sha));
      return originals.get(sha);
    };
    let replayed = 0;
    for (const { sha } of comparison.commits) {
      const commit = await call(github, `/commits/${sha}`);
      if (commit.parents.length !== 1) throw new Error(`Commit ${sha.slice(0, 7)} is a merge commit.`);
      if (commit.files.length >= 300) throw new Error(`Commit ${sha.slice(0, 7)} changes too many files to rebase automatically.`);
      const before = await originalTree(commit.parents[0].sha);
      const after = await originalTree(sha);
      const changes = [];
      for (const file of commit.files) {
        const paths = file.previous_filename ? [file.previous_filename, file.filename] : [file.filename];
        for (const path of paths) {
          const current = files.get(path);
          const wanted = after.get(path);
          if (current?.sha === wanted?.sha && current?.mode === wanted?.mode) continue;
          const original = before.get(path);
          if (current?.sha !== original?.sha) throw new Error(`${path} was also changed on ${base}.`);
          changes.push({ path, mode: wanted?.mode || current.mode, type: 'blob', sha: wanted ? wanted.sha : null });
        }
      }
      if (!changes.length) continue;
      const parentTree = (await call(github, `/git/commits/${parent}`)).tree.sha;
      const tree = await call(github, '/git/trees', { method: 'POST', body: { base_tree: parentTree, tree: changes } });
      const created = await call(github, '/git/commits', { method: 'POST', body: {
        message: commit.commit.message, tree: tree.sha, parents: [parent], author: commit.commit.author, ...(committer ? { committer } : {})
      } });
      parent = created.sha;
      changes.forEach((change) => change.sha ? files.set(change.path, { sha: change.sha, mode: change.mode }) : files.delete(change.path));
      replayed += 1;
    }

    // Someone may have saved while this ran; their commit would be lost, so stop and let the next save try again.
    const current = await call(github, `/git/ref/heads/${encodedBranch}`);
    if (current.object.sha !== headSha) throw new Error(`${branch} changed during the rebase.`);
    await call(github, `/git/refs/heads/${encodedBranch}`, { method: 'PATCH', body: { sha: parent, force: true } });
    return { status: 'rebased', replayed, dropped: comparison.commits.length - replayed };
  } catch (error) {
    return { status: 'failed', reason: error.message };
  }
};

export const rebaseWarning = (rebase, branch, base) => rebase?.status === 'failed'
  ? `${branch} could not be rebased onto ${base} automatically (${rebase.reason}). The change was still saved; rebase the branch by hand before merging.`
  : '';
