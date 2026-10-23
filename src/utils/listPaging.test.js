import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminListPageSize, listPage } from './listPaging.js';

test('admin lists show seven to ten items according to browser height', () => {
  for (const [height, expected] of [[375, 7], [640, 7], [720, 7], [752, 8], [816, 9], [880, 10], [1440, 10]]) {
    assert.equal(adminListPageSize(height), expected);
  }
});

test('paging replaces each batch without skipping or repeating items', () => {
  for (const pageSize of [7, 8, 9, 10]) {
    const visited = [];
    let page = listPage(32, pageSize, 0);
    assert.equal(page.hasPrevious, false);
    while (true) {
      visited.push(...Array.from({ length: page.end - page.start }, (_, index) => page.start + index));
      if (!page.hasMore) break;
      page = listPage(32, pageSize, page.start + pageSize);
    }
    assert.deepEqual(visited, Array.from({ length: 32 }, (_, index) => index));
    assert.deepEqual(listPage(32, pageSize, page.start - pageSize),
      { start: page.start - pageSize, end: page.start, hasPrevious: page.start > pageSize, hasMore: true });
  }
});

test('empty, short and exact-size lists have no paging controls', () => {
  for (const count of [0, 1, 7]) {
    assert.deepEqual(listPage(count, 7, 0), { start: 0, end: count, hasPrevious: false, hasMore: false });
  }
});

test('removal and resizing clamp to a populated page', () => {
  assert.deepEqual(listPage(15, 7, 21), { start: 14, end: 15, hasPrevious: true, hasMore: false });
  assert.deepEqual(listPage(14, 7, 14), { start: 7, end: 14, hasPrevious: true, hasMore: false });
  assert.deepEqual(listPage(0, 7, 14), { start: 0, end: 0, hasPrevious: false, hasMore: false });
  assert.deepEqual(listPage(25, 10, 14), { start: 10, end: 20, hasPrevious: true, hasMore: true });
  assert.deepEqual(listPage(25, 7, 20), { start: 14, end: 21, hasPrevious: true, hasMore: true });
});
