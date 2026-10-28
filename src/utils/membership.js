// Whether a membership record counts as active. JustGo direct-debit renewals are only trusted once the weekly sync
// has confirmed them in the current club year, so every JustGo-managed member is inactive from 1 March until then.
export const CONFIRMATION_DAYS = 14;

const millis = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const clubYearStart = (now = new Date()) => new Date(now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1, 2, 1);

// True while a missing JustGo confirmation is still expected, rather than a renewal that never happened.
export const renewalConfirmationOpen = (now = new Date()) => now.getTime() - clubYearStart(now).getTime() < CONFIRMATION_DAYS * 24 * 60 * 60 * 1000;

// The weekly JustGo sync records `settings/justgoSync.lastSuccessAt` after each complete run. If no run has finished
// in this many days (a week plus a day's grace), the sync is treated as stopped and unconfirmed JustGo members are shown as Unavailable.
export const JUSTGO_SYNC_STALE_DAYS = 8;
export const justgoSyncHealth = (settings, now = new Date()) => {
  const lastSuccessAt = millis(settings?.lastSuccessAt) || null;
  return { lastSuccessAt, healthy: Boolean(lastSuccessAt) && now.getTime() - lastSuccessAt < JUSTGO_SYNC_STALE_DAYS * 24 * 60 * 60 * 1000 };
};

// 'active' | 'expired' | 'awaiting-renewal' | 'inactive'
export const membershipActivity = (fields, now = new Date()) => {
  if (fields.membershipAccessEndsAt !== undefined && fields.membershipAccessEndsAt !== null && millis(fields.membershipAccessEndsAt) <= now.getTime()) return 'inactive';
  if (!/^active$/i.test(String(fields.status || ''))) return 'inactive';
  const validUntil = fields.membershipAccessEndsAt !== undefined && fields.membershipAccessEndsAt !== null
    ? Math.min(millis(fields.validUntil) || Infinity, millis(fields.membershipAccessEndsAt)) : millis(fields.validUntil);
  if (validUntil && validUntil <= now.getTime()) return 'expired';
  const managedByJustgo = fields.renewalMethod === 'justgo' || fields.justgoSyncStatus === 'synced';
  if (managedByJustgo && millis(fields.lastJustgoSync) < clubYearStart(now).getTime()) return 'awaiting-renewal';
  return 'active';
};
