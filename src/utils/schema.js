/**
 * The shape version stamped as `schemaVersion` on new member (`memberships`) and order records. Nothing converts older
 * shapes: when a stored shape changes, raise its version and convert the existing records as part of that change.
 */
export const CURRENT_MEMBERSHIP_VERSION = 4;
export const CURRENT_ORDER_VERSION = 2;
