/**
 * A discount code's `status` is what staff and checkout act on: `active` can be applied, `used` is a single-use code
 * or voucher that has been spent (`usedByOrder`, `usedAt`), and `disabled` is turned off by staff or revoked with the
 * voucher purchase (`revokedAt`). Expiry stays `expiresAt` and a checkout hold stays `reservedByOrder`/`reservedUntil`.
 */
export const DISCOUNT_STATUSES = ['active', 'used', 'disabled'];
export const DISCOUNT_TYPES = ['multiplier', 'credit', 'flat'];

const millis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Number(value) || 0);

/** Why a code cannot be applied now, or null when it can. */
export const discountFailure = (discount, now = Date.now()) => {
  if (!discount || discount.status !== 'active') return 'Invalid or already used code.';
  if (discount.expiresAt && millis(discount.expiresAt) <= now) return 'Code expired.';
  if (discount.singleUse && millis(discount.reservedUntil) > now) return 'Voucher is already in checkout. Try again later.';
  return null;
};

/** What staff see: the stored status, or `expired` / `in checkout` for an active code; revoked vouchers say so. */
export const discountDisplayStatus = (discount, now = Date.now()) => {
  if (discount.status === 'disabled') return discount.revokedAt ? 'revoked' : 'disabled';
  if (discount.status !== 'active') return discount.status;
  if (discount.expiresAt && millis(discount.expiresAt) <= now) return 'expired';
  return millis(discount.reservedUntil) > now ? 'in checkout' : 'active';
};

/**
 * Converts a stored code to the current shape: `status` from the old `used` / `active` / `disabled` / `enabled`
 * booleans, `type` from `discountType`, and `sourceProductId` from older voucher product fields. Codes saved before
 * the type or value were required were treated as 25% off, so that is what they are given. Returns only what changes.
 */
export const discountCodeUpgrade = (fields) => {
  const set = {};
  const remove = [];
  const drop = (key) => { if (key in fields) remove.push(key); };
  if (!DISCOUNT_STATUSES.includes(fields.status)) {
    set.status = fields.used === true ? 'used'
      : fields.active === false || fields.disabled === true || fields.enabled === false ? 'disabled' : 'active';
  }
  ['used', 'active', 'disabled', 'enabled'].forEach(drop);
  if (!DISCOUNT_TYPES.includes(fields.type)) set.type = DISCOUNT_TYPES.includes(fields.discountType) ? fields.discountType : 'multiplier';
  drop('discountType');
  if (typeof fields.discountValue !== 'number') set.discountValue = Number(fields.discountValue) || 0.25;
  const legacyProduct = fields.voucherProductId || (fields.orderRef && typeof fields.productId === 'string' ? fields.productId : '');
  if (!fields.sourceProductId && legacyProduct) set.sourceProductId = legacyProduct;
  drop('voucherProductId');
  if (fields.orderRef) drop('productId');
  return { set, remove };
};
