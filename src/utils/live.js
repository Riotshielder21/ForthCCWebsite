/** Live mode: once WEBSITE_ISLIVE is true the site is collecting real customers' data and the record keeping below applies. */
export const isLive = (env = process.env) => String(env.WEBSITE_ISLIVE ?? '').trim().toLowerCase() === 'true';

/** What consent records hold for the wording version before the site is live. */
export const PRE_LIVE_VERSION = 'pre-live';

/** Policies that must be written and recorded before real customers' data is collected. */
export const REQUIRED_LIVE_POLICIES = [
  ['privacy-notice', 'privacy notice'],
  ['data-retention', 'data retention policy'],
  ['first-aid-and-safety', 'first aid and safety statement'],
  ['participation-disclaimer', 'participation disclaimer']
];

/**
 * Warnings for a live site that is not ready to hold real data. Advisory only: they are logged at start up,
 * checkout is not blocked. `currentVersions` maps policy key to its current version number.
 */
export const liveReadinessProblems = ({ env = process.env, currentVersions = {} } = {}) => {
  if (!isLive(env)) return [];
  const problems = [];
  if (!String(env.AUDIT_LOOKUP_SECRET || '').trim()) problems.push('AUDIT_LOOKUP_SECRET is not set, so deletions are refused and GDPR erasure cannot find earlier deletions.');
  for (const [key, label] of REQUIRED_LIVE_POLICIES) {
    if (!(currentVersions[key] > 0)) problems.push(`The ${label} has no recorded wording yet.`);
  }
  return problems;
};
