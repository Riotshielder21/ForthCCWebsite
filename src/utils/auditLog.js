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
  'volunteer-price-change': 'Volunteer price applied to the monthly payment',
  'club-year-price-change': 'New club year price from 1 March'
};

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
