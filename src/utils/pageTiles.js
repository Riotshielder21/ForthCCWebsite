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

export const defaultTileLayout = (pageId) => Object.entries(PAGE_TILE_GROUPS[pageId] || {})
  .flatMap(([group, ids]) => ids.map((id) => ({ id, group, type: 'existing' })));

export const currentTileLayout = (pageId, saved) => Array.isArray(saved) ? saved : defaultTileLayout(pageId);

export const safeTileUrl = (value, image = false) => {
  if (!value) return '';
  try {
    const url = new URL(value, 'https://forthcanoeclub.co.uk');
    if (url.protocol === 'https:' || (!image && url.protocol === 'mailto:')) return value;
  } catch {
    return '';
  }
  return '';
};

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
    return result;
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
    if (tile.type === 'existing') {
      if (!existingIds.has(tile.id)) throw new Error('Unknown existing tile.');
      return { id: tile.id, group: tile.group, type: tile.type, ...validatedPresentation(tile) };
    }
    const result = { id: tile.id, group: tile.group, type: tile.type, ...validatedPresentation(tile) };
    for (const key of ['eyebrow', 'title', 'description', 'url', 'action', 'imageUrl', 'alt']) {
      const value = tile[key] ?? '';
      if (typeof value !== 'string' || value.length > 20000) throw new Error(`Invalid tile ${key}.`);
      if ((key === 'url' || key === 'imageUrl') && value && !safeTileUrl(value, key === 'imageUrl')) {
        throw new Error(`Tile ${key} must be a secure URL${key === 'url' ? ' or email link' : ''}.`);
      }
      result[key] = value;
    }
    return result;
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