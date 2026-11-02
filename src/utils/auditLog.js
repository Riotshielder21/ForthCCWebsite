/**
 * One staff audit trail, `auditLog`. Each entry has a `kind` (`subscription`, `item`, `deletion`, `access`), an
 * `action`, a `reason`, who did it (`by`: email, else uid or the automatic job name; `byUid`), when (`at`), the ids
 * it concerns (`orderRef`, `membershipId`, `stripeSubscriptionId`…) and the kind's own details. Destructive actions
 * need a reason from staff; routine ones are given a generated reason.
 */
export const AUDIT_KINDS = ['subscription', 'item', 'deletion', 'access'];
export const REASON_REQUIRED = 'Enter a reason (up to 1000 characters).';
export const ROUTINE_REASONS = {
  'grant-admin': 'Granted admin access',
  'schedule-volunteer-benefit-cancellation': 'Free volunteer benefit replaces the monthly payment',
  'volunteer-price-change': 'Volunteer price applied to the monthly payment'
};
const LEGACY_REASON = 'Recorded before reasons were required';

/** The staff-entered reason for a destructive action, or '' when it is blank or too long. */
export const requiredReason = (body) => {
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  return reason.length <= 1000 ? reason : '';
};

const actorFields = (actor) => typeof actor === 'string' ? { by: actor, byUid: '' } : { by: actor?.email || actor?.uid || '', byUid: actor?.uid || '' };

export const auditEntry = ({ kind, action, reason = ROUTINE_REASONS[action], actor, at, ...details }) => {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!AUDIT_KINDS.includes(kind) || !action || !text) throw new Error(`An audit entry needs a kind, action and reason (${kind} ${action}).`);
  return { kind, action, reason: text, ...actorFields(actor), at, ...details };
};

const LEGACY_KINDS = { adminSubscriptionAudit: 'subscription', adminItemAudit: 'item', adminDeletionAudit: 'deletion', adminAccessAudit: 'access' };
export const LEGACY_AUDIT_COLLECTIONS = Object.keys(LEGACY_KINDS);

const toDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : value ?? null;

/**
 * Converts an entry from one of the four old audit collections. The id `${kind}_${oldId}` makes re-runs overwrite
 * the same entry, and an unfinished item action keeps its operation id. Old deletion entries used `kind` for the
 * record type (`orders`/`members`, now `recordKind`) or `gdpr-erasure` (now the action).
 */
export const legacyAuditEntry = (collection, oldId, fields) => {
  const kind = LEGACY_KINDS[collection];
  const { checkedAt, createdAt, at, adminUid, adminEmail, by, kind: oldKind, action: oldAction, reason, ...details } = fields;
  let action = oldAction;
  if (kind === 'deletion') {
    action = oldKind === 'gdpr-erasure' ? 'gdpr-erasure' : 'delete-record';
    if (oldKind !== 'gdpr-erasure') details.recordKind = oldKind || '';
  }
  if (kind === 'access') action = oldAction === 'grant' ? 'grant-admin' : oldAction === 'revoke' ? 'revoke-admin' : oldAction;
  const actor = by || adminEmail || adminUid || '';
  return {
    id: `${kind}_${oldId}`,
    entry: {
      ...details, kind, action: action || 'unknown',
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : ROUTINE_REASONS[action] || LEGACY_REASON,
      by: actor, byUid: adminUid || '', at: toDate(at ?? checkedAt ?? createdAt)
    }
  };
};
