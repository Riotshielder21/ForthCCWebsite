import { validateContentLinks, validateContentButton, safeTileUrl } from './contentLinks.js';
import { validateImagePlaceholder, validateImageSources } from './responsiveImages.js';
export { safeTileUrl } from './contentLinks.js';

export const TILE_TYPES = ['text', 'image', 'link'];
export const TILE_APPEARANCES = ['default', 'white', 'grey'];
export const TILE_WIDTHS = ['default', 'standard', 'wide'];

const validatedPresentation = (tile, allowWidth = true) => {
  const result = {};
  if (tile.appearance !== undefined) {
    if (!TILE_APPEARANCES.includes(tile.appearance)) throw new Error('Invalid tile appearance.');
    result.appearance = tile.appearance;
  }
  if (tile.width !== undefined && allowWidth) {
    if (!TILE_WIDTHS.includes(tile.width)) throw new Error('Invalid tile width.');
    result.width = tile.width;
  }
  return result;
};

export const tileAppearanceClass = (tile) => ({ white: 'main_tile_white', grey: 'main_tile_grey_override' })[tile.appearance] || '';
export const tileIsWide = (tile, templateWide = false) => tile.width === 'wide' || (tile.width !== 'standard' && templateWide);

export const PAGE_TILE_GROUPS = {
  home: { intro: ['welcome', 'start'], mission: ['mission'], quick: ['quick1', 'quick2', 'quick3'], supporters: ['supporters'], location: ['location'] },
  beginners: { hero: ['hero'], tiles: ['open', 'club', 'courses', 'essentials'] },
  disciplines: { hero: ['hero'], tiles: ['slalom', 'polo', 'sprint', 'whitewater', 'touring', 'surf', 'canoe', 'paddleboarding'] },
  about: { hero: ['hero'], tiles: ['tile1', 'tile2', 'tile3', 'tile4'] },
  'access-project': { hero: ['hero'], tiles: ['tile1', 'tile2', 'tile3', 'tile4'] },
  contact: { hero: ['hero'], tiles: ['address', 'email', 'social'], support: ['support'] }
};

// Pages that can show a photo banner under the navigation. The shop (membership) has none.
export const BANNER_PAGES = ['home', 'beginners', 'disciplines', 'about', 'access-project', 'contact'];
export const BANNER_FOCUS = { top: '25%', center: '50%', bottom: '78%' };
const EMPTY_BANNER = { imageUrl: '', alt: '', credit: '', focus: 'center' };
export const DEFAULT_BANNERS = {
  home: {
    imageUrl: '/images/banners/home-canal.webp',
    alt: 'The canal on a summer day, with a green narrowboat, a red-roofed boathouse and a sandstone church tower',
    credit: 'Forth Canoe Club',
    focus: 'bottom'
  }
};

export const getBanner = (pageId, saved) => BANNER_PAGES.includes(pageId)
  ? { ...EMPTY_BANNER, ...(saved ?? DEFAULT_BANNERS[pageId]) }
  : undefined;

// Only an uploaded image has stored sizes and a preview; they are dropped when there is no image link.
const validatedImageExtras = (imageUrl, sources, placeholder, names = ['sources', 'placeholder']) => {
  if (!imageUrl) return {};
  const validSources = validateImageSources(sources);
  const validPlaceholder = validateImagePlaceholder(placeholder);
  return { ...(validSources.length ? { [names[0]]: validSources } : {}), ...(validPlaceholder ? { [names[1]]: validPlaceholder } : {}) };
};
const TILE_IMAGE_FIELDS = ['imageSources', 'imagePlaceholder'];

export const validateBanner = (pageId, banner) => {
  if (!BANNER_PAGES.includes(pageId)) throw new Error('This page cannot have a banner.');
  if (!banner || typeof banner !== 'object' || Array.isArray(banner)) throw new Error('Invalid banner.');
  const limits = { imageUrl: 2000, alt: 300, credit: 120 };
  const result = Object.fromEntries(Object.entries(limits).map(([key, limit]) => {
    const value = banner[key] ?? '';
    if (typeof value !== 'string' || value.length > limit) throw new Error(`Invalid banner ${key}.`);
    if (key === 'imageUrl' && value && !safeTileUrl(value, true)) throw new Error('The banner image must be a secure URL.');
    return [key, value.trim()];
  }));
  const focus = banner.focus ?? 'center';
  if (!Object.hasOwn(BANNER_FOCUS, focus)) throw new Error('Invalid banner focus.');
  return { ...result, focus, ...validatedImageExtras(result.imageUrl, banner.sources, banner.placeholder) };
};

export const defaultTileLayout = (pageId) => Object.entries(PAGE_TILE_GROUPS[pageId] || {})
  .flatMap(([group, ids]) => ids.map((id) => ({ id, group, type: 'existing' })));

export const currentTileLayout = (pageId, saved) => Array.isArray(saved) ? saved : defaultTileLayout(pageId);

export const getSupporterTiles = (saved, legacy = '') => saved ?? legacy.split('\n').map((line, index) => {
  const [name, url = ''] = line.split('|').map((part) => part.trim());
  return { id: `supporter-${index + 1}`, name, url, imageUrl: '', alt: '' };
}).filter((tile) => tile.name);

export const validateSupporterTiles = (tiles) => {
  if (!Array.isArray(tiles) || tiles.length > 100) throw new Error('Invalid supporter tiles. Maximum 100 items.');
  const seen = new Set();
  return tiles.map((tile) => {
    if (!tile || typeof tile.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(tile.id) || seen.has(tile.id)) {
      throw new Error('Invalid supporter tile identity.');
    }
    seen.add(tile.id);
    const result = { id: tile.id, ...validatedPresentation(tile, false) };
    for (const key of ['name', 'url', 'imageUrl', 'alt']) {
      const value = tile[key] ?? '';
      if (typeof value !== 'string' || value.length > 20000) throw new Error(`Invalid supporter ${key}.`);
      if ((key === 'url' || key === 'imageUrl') && value && !safeTileUrl(value, key === 'imageUrl')) {
        throw new Error(`Invalid supporter ${key}. Use a secure URL.`);
      }
      result[key] = value;
    }
    return { ...result, ...validatedImageExtras(result.imageUrl, tile.imageSources, tile.imagePlaceholder, TILE_IMAGE_FIELDS) };
  });
};

export const validateTileLayout = (pageId, input) => {
  if (!Array.isArray(input) || input.length > 100 || !PAGE_TILE_GROUPS[pageId]) {
    throw new Error('Invalid tile layout. Pages can contain up to 100 tiles.');
  }
  const tiles = currentTileLayout(pageId, input);
  const existingIds = new Set(defaultTileLayout(pageId).map((tile) => tile.id));
  const seen = new Set();
  return tiles.map((tile) => {
    if (!tile || typeof tile !== 'object' || typeof tile.id !== 'string' || typeof tile.group !== 'string'
      || !/^[a-zA-Z0-9-]{1,100}$/.test(tile.id) || seen.has(tile.id)
      || !Object.hasOwn(PAGE_TILE_GROUPS[pageId], tile.group)
      || !['existing', ...TILE_TYPES].includes(tile.type)) {
      throw new Error('Invalid tile identity, group, or type.');
    }
    seen.add(tile.id);
    const button = tile.button === undefined ? {} : { button: validateContentButton(tile.button) };
    if (tile.type === 'existing') {
      if (!existingIds.has(tile.id)) throw new Error('Unknown existing tile.');
      return { id: tile.id, group: tile.group, type: tile.type, ...validatedPresentation(tile), ...button };
    }
    const result = { id: tile.id, group: tile.group, type: tile.type, ...validatedPresentation(tile), ...button };
    for (const key of ['eyebrow', 'title', 'description', 'url', 'action', 'imageUrl', 'alt']) {
      const value = tile[key] ?? '';
      if (typeof value !== 'string' || value.length > 20000) throw new Error(`Invalid tile ${key}.`);
      if ((key === 'url' || key === 'imageUrl') && value && !safeTileUrl(value, key === 'imageUrl')) {
        throw new Error(`Tile ${key} must be a secure URL${key === 'url' ? ' or email link' : ''}.`);
      }
      result[key] = value;
    }
    validateContentLinks(result.description);
    return { ...result, ...validatedImageExtras(result.imageUrl, tile.imageSources, tile.imagePlaceholder, TILE_IMAGE_FIELDS) };
  });
};

export const moveTile = (tiles, activeId, targetId) => {
  const active = tiles.find((tile) => tile.id === activeId);
  const target = tiles.find((tile) => tile.id === targetId);
  if (!active || !target || activeId === targetId) return tiles;
  const remaining = tiles.filter((tile) => tile.id !== activeId);
  const movingForward = active.group === target.group
    && tiles.findIndex((tile) => tile.id === activeId) < tiles.findIndex((tile) => tile.id === targetId);
  const targetIndex = remaining.findIndex((tile) => tile.id === targetId) + (movingForward ? 1 : 0);
  remaining.splice(targetIndex, 0, { ...active, group: target.group });
  return remaining;
};
