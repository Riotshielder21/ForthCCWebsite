import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BANNERS, getBanner, validateBanner, defaultTileLayout, moveTile, safeTileUrl, validateTileLayout, getSupporterTiles, validateSupporterTiles, tileAppearanceClass, tileIsWide } from './pageTiles.js';
import { getPageCopy, PAGE_CONTENT } from '../constants/pageContent.js';

test('controlled appearances and widths round-trip for existing and new tiles', () => {
  const tiles = [
    { id: 'tile1', group: 'tiles', type: 'existing', appearance: 'grey', width: 'wide' },
    { id: 'custom', group: 'tiles', type: 'text', appearance: 'white', width: 'standard' }
  ];
  const saved = validateTileLayout('about', tiles);
  assert.deepEqual(saved[0], tiles[0]);
  assert.equal(saved[1].appearance, 'white');
  assert.equal(saved[1].width, 'standard');
  assert.equal(tileAppearanceClass(saved[0]), 'main_tile_grey_override');
  assert.equal(tileIsWide(saved[0]), true);
  assert.equal(tileIsWide(saved[1], true), false);
  assert.equal(tileIsWide({}, true), true);
  assert.equal(tileAppearanceClass({}), '');
  for (const change of [{ appearance: 'arbitrary-css' }, { width: '999px' }]) {
    assert.throws(() => validateTileLayout('about', [{ ...tiles[0], ...change }]));
  }
  const [supporter] = validateSupporterTiles([{ id: 'sponsor', appearance: 'grey' }]);
  assert.equal(supporter.appearance, 'grey');
});

test('nested supporter tiles migrate placeholders and preserve logos, order and deletion', () => {
  const legacy = getSupporterTiles(undefined, 'First | https://example.com\nSecond | https://example.org');
  const tiles = [{ ...legacy[1], imageUrl: 'https://example.org/logo.png', alt: 'Second company' }, legacy[0]];
  assert.deepEqual(validateSupporterTiles(tiles), tiles);
  assert.deepEqual(getPageCopy('home', { supporterTiles: tiles }).supporterTiles, tiles);
  assert.deepEqual(getPageCopy('home', { supporterTiles: [] }).supporterTiles, []);
  assert.equal(validateSupporterTiles(tiles.slice(1)).length, 1);
  assert.throws(() => validateSupporterTiles([tiles[0], tiles[0]]));
  assert.throws(() => validateSupporterTiles([{ ...tiles[0], imageUrl: 'javascript:alert(1)' }]));
});

test('legacy layouts retain all tiles and allow deletion and an empty page', () => {
  const tiles = defaultTileLayout('home');
  assert.equal(tiles.length, 8);
  assert.deepEqual(validateTileLayout('home', tiles.slice(1)), tiles.slice(1));
  assert.deepEqual(validateTileLayout('home', []), []);
});

test('new tile types round-trip without losing content', () => {
  for (const type of ['text', 'image', 'link']) {
    const [tile] = validateTileLayout('about', [{ id: `new-${type}`, group: 'tiles', type, title: 'New title', description: 'First\nSecond', url: '/?page=beginners', imageUrl: 'https://example.com/image.jpg' }]);
    assert.equal(tile.type, type);
    assert.equal(tile.description, 'First\nSecond');
    assert.equal(tile.url, '/?page=beginners');
  }
});

test('reordering can move tiles between groups', () => {
  const tiles = defaultTileLayout('home');
  const moved = moveTile(tiles, 'quick3', 'welcome');
  assert.equal(moved[0].id, 'quick3');
  assert.equal(moved[0].group, 'intro');
  assert.equal(moved.length, tiles.length);
  assert.deepEqual(validateTileLayout('home', moved), moved);
  assert.equal(moveTile(tiles, 'missing', 'welcome'), tiles);
});

test('adjacent tiles reorder both forward and backward', () => {
  const tiles = defaultTileLayout('about');
  const forward = moveTile(tiles, 'tile1', 'tile2');
  assert.deepEqual(forward.filter((tile) => tile.group === 'tiles').map((tile) => tile.id), ['tile2', 'tile1', 'tile3', 'tile4']);
  assert.deepEqual(moveTile(forward, 'tile1', 'tile2'), tiles);
});

test('malformed layouts and executable URLs are rejected', () => {
  const tile = { id: 'new-tile', group: 'tiles', type: 'link' };
  for (const tiles of [[{ ...tile, url: 'javascript:alert(1)' }], [tile, tile], [{ ...tile, group: 'unknown' }], [{ ...tile, type: 'existing' }], [{ ...tile, id: undefined }], [{ ...tile, id: 123 }]]) {
    assert.throws(() => validateTileLayout('about', tiles));
  }
  assert.equal(safeTileUrl('data:text/html,test'), '');
  assert.equal(safeTileUrl('mailto:secretary@forthcanoeclub.co.uk'), 'mailto:secretary@forthcanoeclub.co.uk');
  assert.equal(safeTileUrl('mailto:secretary@forthcanoeclub.co.uk', true), '');
});

test('page content keeps saved layouts, defaults old content, and leaves the shop unchanged', () => {
  for (const pageId of Object.keys(PAGE_CONTENT).filter((id) => id !== 'membership')) {
    const copy = getPageCopy(pageId);
    assert.deepEqual(validateTileLayout(pageId, copy.tileLayout), copy.tileLayout);
    assert.deepEqual(getPageCopy(pageId, { tileLayout: [] }).tileLayout, []);
  }
  assert.equal(getPageCopy('home', { welcomeTitle: 'Edited' }).welcomeTitle, 'Edited');
  assert.equal(Object.hasOwn(getPageCopy('membership'), 'tileLayout'), false);
  for (const id of ['slalom', 'polo', 'sprint', 'whitewater', 'touring', 'surf', 'canoe', 'paddleboarding']) {
    assert.equal(typeof getPageCopy('disciplines')[`${id}Title`], 'string');
    assert.equal(typeof getPageCopy('disciplines')[`${id}Body`], 'string');
  }
});
test('volunteering has no generic page content or configurable tiles', () => {
  assert.equal(Object.hasOwn(PAGE_CONTENT, 'volunteering'), false);
  assert.deepEqual(defaultTileLayout('volunteering'), []);
  assert.throws(() => validateTileLayout('volunteering', [{ id: 'custom', group: 'ways', type: 'text' }]));
});

test('page banners: the home photo is the default, other pages start empty and the shop has none', () => {
  assert.equal(getPageCopy('home', {}).banner.imageUrl, DEFAULT_BANNERS.home.imageUrl);
  assert.equal(getPageCopy('home', {}).banner.credit, 'Forth Canoe Club');
  assert.deepEqual(getPageCopy('about', {}).banner, { imageUrl: '', alt: '', credit: '', focus: 'center' });
  assert.equal(getPageCopy('home', {}).banner.focus, 'bottom');
  assert.equal(getPageCopy('membership', {}).banner, undefined);
  assert.equal(getPageCopy('home', { banner: { imageUrl: '' } }).banner.imageUrl, '', 'an admin can remove the home photo');
  assert.equal(getBanner('membership', { imageUrl: 'https://example.com/a.webp' }), undefined);
});

test('page banners accept secure or site images and reject anything else', () => {
  assert.deepEqual(validateBanner('home', DEFAULT_BANNERS.home), DEFAULT_BANNERS.home);
  assert.deepEqual(validateBanner('contact', { imageUrl: 'https://firebasestorage.googleapis.com/x.webp', alt: ' Boats ', credit: 'Club' }),
    { imageUrl: 'https://firebasestorage.googleapis.com/x.webp', alt: 'Boats', credit: 'Club', focus: 'center' });
  assert.deepEqual(validateBanner('about', {}), { imageUrl: '', alt: '', credit: '', focus: 'center' });
  for (const banner of [{ imageUrl: 'javascript:alert(1)' }, { imageUrl: 'http://example.com/a.jpg' }, { imageUrl: 'data:image/png;base64,AAAA' },
    { alt: 'x'.repeat(301) }, { credit: 5 }, { focus: 'invalid' }, null, []]) {
    assert.throws(() => validateBanner('home', banner));
  }
  assert.throws(() => validateBanner('membership', DEFAULT_BANNERS.home), /cannot have a banner/);
});
