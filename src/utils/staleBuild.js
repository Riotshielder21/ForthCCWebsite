const RELOAD_KEY = 'fcc-stale-build-reload';
// Browser wording for a lazy page whose code was removed by a newer deploy.
const STALE_BUILD = /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script/i;

/** Reloads once to pick up the current deploy; a recent attempt means reloading would loop, so leave the error shown. */
export function reloadForNewBuild(error, storage = globalThis.sessionStorage, reload = () => globalThis.location.reload(), now = Date.now()) {
  if (!STALE_BUILD.test(error?.message || '')) return false;
  try {
    const last = storage.getItem(RELOAD_KEY);
    if (last && now - Number(last) < 30000) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}
