/**
 * Stock limits for merchandise (per size) and events (per ticket capacity).
 *
 * Each limited product has one stock record whose `holds` map is keyed by order reference:
 *   holds[orderRef] = { until: epochMillis | null, lines: { [stockKey]: quantity } }
 * `until: null` is a paid hold; otherwise it is a checkout reservation that lapses at `until`.
 */

/** A reservation outlives the one-hour Stripe Checkout session by a few minutes. */
export const HOLD_MINUTES = 65;
export const EVENT_KEY = 'all';

export const isMerchandise = (item) => item?.category === 'MERCHANDISE';

/** Stock key for one basket or order line: the size for merchandise, one pool for events. */
export const stockKey = (item) => isMerchandise(item) ? String(item.size || '') : EVENT_KEY;

/** Display name with the chosen size, as shown in baskets, receipts and reports. */
export const itemLabel = (item) => item?.size ? `${item.name} (${item.size})` : String(item?.name || item?.id || '');

/**
 * The limits an admin has configured, or null when the product is not limited.
 * Returns `{ [stockKey]: maxQuantity }`.
 */
export const productLimits = (product) => {
  if (isMerchandise(product)) {
    const limits = {};
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      const size = typeof variant?.size === 'string' ? variant.size.trim() : '';
      const stock = Number(variant?.stock);
      if (size && Number.isInteger(stock) && stock >= 0) limits[size] = stock;
    }
    return limits;
  }
  const capacity = Number(product?.capacity);
  return product?.category === 'EVENTS' && Number.isInteger(capacity) && capacity > 0 ? { [EVENT_KEY]: capacity } : null;
};

/** Quantities currently taken from each stock key by paid orders and unexpired reservations. */
export const usedQuantities = (holds = {}, now = Date.now()) => {
  const used = {};
  for (const hold of Object.values(holds)) {
    if (hold.until !== null && hold.until !== undefined && hold.until <= now) continue;
    for (const [key, quantity] of Object.entries(hold.lines || {})) used[key] = (used[key] || 0) + quantity;
  }
  return used;
};

/** `{ [stockKey]: remaining }` for a limited product, or null when it is unlimited. */
export const remainingStock = (product, holds, now = Date.now()) => {
  const limits = productLimits(product);
  if (!limits) return null;
  const used = usedQuantities(holds, now);
  return Object.fromEntries(Object.entries(limits).map(([key, max]) => [key, Math.max(0, max - (used[key] || 0))]));
};

export const isSoldOut = (remaining) => Boolean(remaining) && Object.values(remaining).every((quantity) => quantity <= 0);

/** Total wanted per stock key for one product's basket lines. */
export const wantedQuantities = (lines) => {
  const wanted = {};
  for (const line of lines) wanted[stockKey(line)] = (wanted[stockKey(line)] || 0) + 1;
  return wanted;
};

/** An error message when the wanted quantities cannot be supplied, otherwise null. */
export const stockProblem = (product, holds, wanted, now = Date.now()) => {
  const remaining = remainingStock(product, holds, now);
  if (!remaining) return null;
  for (const [key, quantity] of Object.entries(wanted)) {
    if (!(key in remaining)) return `${product.name}: choose an available size.`;
    if (quantity > remaining[key]) {
      const label = isMerchandise(product) ? `${product.name} (${key})` : product.name;
      return remaining[key] <= 0 ? `${label} is sold out.` : `Only ${remaining[key]} of ${label} left.`;
    }
  }
  return null;
};

/** Reservation for an order, replacing any expired holds so records do not accumulate. */
export const withHold = (holds = {}, orderRef, lines, now = Date.now(), until = now + HOLD_MINUTES * 60 * 1000) => {
  const live = Object.fromEntries(Object.entries(holds).filter(([, hold]) => hold.until === null || hold.until > now));
  return { ...live, [orderRef]: { until, lines } };
};

/** Validated stock fields to save with a product: sizes and stock for merchandise, capacity for events. */
export const cleanStockFields = (product) => {
  if (isMerchandise(product)) {
    const seen = new Set();
    const variants = [];
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      const size = String(variant?.size ?? '').trim();
      const blankStock = variant?.stock === '' || variant?.stock === undefined || Number(variant.stock) === 0;
      if (!size && blankStock) continue;
      const stock = Number(variant.stock);
      if (!size || size.length > 40 || !Number.isInteger(stock) || stock < 0) {
        throw new Error('Each size needs a name of up to 40 characters and a whole-number stock of 0 or more.');
      }
      if (seen.has(size)) throw new Error(`Size ${size} is listed twice.`);
      seen.add(size);
      variants.push({ size, stock });
    }
    if (!variants.length) throw new Error('Add at least one size with its stock.');
    return { variants, capacity: null };
  }
  if (product.category === 'EVENTS') {
    if (product.capacity === '' || product.capacity === null || product.capacity === undefined) return { capacity: null };
    const capacity = Number(product.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Capacity must be a whole number of at least 1, or blank for unlimited.');
    return { capacity };
  }
  return { capacity: null };
};
