export const TREASURER_REPLY_TO = 'treasurer@forthcanoeclub.co.uk';
export const CLUB_REPLY_TO = 'secretary@forthcanoeclub.co.uk';

const VOLUNTEER_KINDS = new Set([
  'volunteer-induction',
  'volunteer-benefits',
  'volunteer-renewal',
  'volunteer-boathouse-code'
]);

const PAYMENT_KINDS = new Set([
  'order-receipt',
  'payment-failed',
  'invoice-failed',
  'subscription-stopped'
]);

export const isVolunteerEmail = (record = {}) => VOLUNTEER_KINDS.has(record.kind)
  || (record.kind === 'email-code' && record.purpose === 'volunteer');

/** Returns the reply address for email record metadata, keeping unrelated mail on the normal club address. */
export const emailReplyTo = (record = {}, volunteerCoordinatorEmail = '') => {
  if (PAYMENT_KINDS.has(record.kind)) return TREASURER_REPLY_TO;
  if (isVolunteerEmail(record)) {
    return volunteerCoordinatorEmail || CLUB_REPLY_TO;
  }
  return CLUB_REPLY_TO;
};
