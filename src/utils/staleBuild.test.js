import test from 'node:test';
import assert from 'node:assert/strict';
import { reloadForNewBuild } from './staleBuild.js';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('a page whose code was removed by a deploy reloads once, without looping', () => {
  const storage = memoryStorage();
  let reloads = 0;
  const reload = () => { reloads += 1; };
  const stale = new TypeError('Failed to fetch dynamically imported module: https://club.test/assets/NoticesPage-old.js');
  assert.equal(reloadForNewBuild(stale, storage, reload, 1000), true);
  assert.equal(reloadForNewBuild(stale, storage, reload, 5000), false);
  assert.equal(reloads, 1);
  assert.equal(reloadForNewBuild(stale, storage, reload, 60000), true);
  assert.equal(reloadForNewBuild(new Error('Importing a module script failed.'), memoryStorage(), reload, 0), true);
  assert.equal(reloadForNewBuild(new Error('Cannot read properties of undefined'), memoryStorage(), reload, 0), false);
  assert.equal(reloads, 3);
});
