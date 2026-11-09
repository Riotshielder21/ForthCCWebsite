/**
 * Items an admin credits to a member's account when they paid the club outside the website, or are given them free.
 * A credited order goes through the checkout checks and fulfilment but takes no Stripe payment; its `payment` records
 * how it was paid: `{ method, amountPence, receivedAt, reference, note, creditedBy, creditedByUid, creditedAt }`.
 */
export const CREDIT_METHODS = [
  ['bank-transfer', 'Bank transfer'],
  ['cash', 'Cash'],
  ['cheque', 'Cheque'],
  ['complimentary', 'Complimentary (no charge)'],
  ['other', 'Other']
];
// Each credit is checked against what was received; above this it is almost certainly a typing mistake.
export const MAX_CREDIT_PENCE = 500000;

export const creditMethodLabel = (method) => CREDIT_METHODS.find(([value]) => value === method)?.[1] || 'Other';

/** How the receipt describes a credited order, e.g. "Paid by bank transfer" or "Complimentary (no charge)". */
export const creditPaymentWording = (payment) => {
  if (!payment?.method) return '';
  if (payment.method === 'complimentary') return 'Complimentary (no charge)';
  if (payment.method === 'other') return 'Paid to the club directly';
  return `Paid by ${creditMethodLabel(payment.method).toLowerCase()}`;
};

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * Validates the payment an admin records with a credit. The date received is a YYYY-MM-DD day, not after today in
 * London. Returns `{ error }` or `{ value }`.
 */
export const validateCreditPayment = (body, now = new Date()) => {
  const method = body?.method;
  if (!CREDIT_METHODS.some(([value]) => value === method)) return { error: 'Choose how it was paid.' };
  const amountPence = body.amountPence;
  if (!Number.isSafeInteger(amountPence) || amountPence < 0 || amountPence > MAX_CREDIT_PENCE) {
    return { error: 'Enter the amount received in pounds and pence.' };
  }
  if (method === 'complimentary' && amountPence !== 0) return { error: 'A complimentary credit receives nothing, so the amount must be £0.00.' };
  if (method !== 'complimentary' && amountPence === 0) return { error: 'Enter the amount received, or choose Complimentary.' };
  const day = typeof body.receivedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.receivedAt) ? body.receivedAt : '';
  const receivedAt = day ? new Date(`${day}T12:00:00Z`) : null;
  if (!receivedAt || Number.isNaN(receivedAt.getTime()) || receivedAt.toISOString().slice(0, 10) !== day) return { error: 'Enter the date it was received.' };
  if (day > new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)) return { error: 'The date received cannot be in the future.' };
  const reference = text(body.reference, 100);
  const note = text(body.note, 1000);
  if (['bank-transfer', 'cheque'].includes(method) && !reference) return { error: 'Enter the payment reference.' };
  if (['complimentary', 'other'].includes(method) && !note) return { error: 'Add a note saying why or how it was paid.' };
  return { value: { method, amountPence, receivedAt, reference, note } };
};
