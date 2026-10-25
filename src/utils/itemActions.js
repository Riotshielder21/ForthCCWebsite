export const orderLineId = (item, index) => item.lineId || `legacy-${index}`;
export const minorUnits = (amount) => Math.round(Number(amount) * 100);

export const validateItemAction = (body = {}) => {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!['revoke', 'refund'].includes(body.action) || !reason || reason.length > 1000) {
    return { error: 'Choose revoke or refund and enter a reason (up to 1000 characters).' };
  }
  if (typeof body.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.operationId)) {
    return { error: 'A valid operation ID is required. Reload the action form.' };
  }
  if (body.action === 'refund' && (!Number.isSafeInteger(body.amount) || body.amount < 1
    || typeof body.paymentIntent !== 'string' || !/^pi_[\w]+$/.test(body.paymentIntent) || typeof body.revoke !== 'boolean')) {
    return { error: 'Select a payment, enter a positive refund amount and choose whether to revoke access.' };
  }
  return { value: { action: body.action, reason, operationId: body.operationId,
    ...(body.action === 'refund' ? { amount: body.amount, paymentIntent: body.paymentIntent, revoke: body.revoke } : {}) } };
};

/** Amounts reserved by submitted refunds, including pending bank refunds, must not be refunded twice. */
export const refundedForPayment = (item, paymentIntent) => (item.refunds || [])
  .filter((refund) => refund.paymentIntent === paymentIntent && !['failed', 'canceled'].includes(refund.status))
  .reduce((sum, refund) => sum + refund.amount, 0);

export const refundAvailable = (item, paymentIntent, allocation, charge) => Math.max(0, Math.min(
  allocation - refundedForPayment(item, paymentIntent),
  charge.amount - charge.amount_refunded
));
