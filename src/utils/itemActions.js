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
  if (body.purpose !== undefined && (body.purpose !== 'volunteer-adjustment' || body.action !== 'refund' || body.revoke !== false)) {
    return { error: 'A volunteer adjustment is a refund that keeps access.' };
  }
  return { value: { action: body.action, reason, operationId: body.operationId,
    ...(body.action === 'refund' ? { amount: body.amount, paymentIntent: body.paymentIntent, revoke: body.revoke } : {}),
    ...(body.purpose ? { purpose: body.purpose } : {}) } };
};

/** Amounts reserved by submitted refunds, including pending bank refunds, must not be refunded twice. */
export const refundedForPayment = (item, paymentIntent) => (item.refunds || [])
  .filter((refund) => refund.paymentIntent === paymentIntent && !['failed', 'canceled'].includes(refund.status))
  .reduce((sum, refund) => sum + refund.amountPence, 0);

export const refundAvailable = (item, paymentIntent, allocation, charge) => Math.max(0, Math.min(
  allocation - refundedForPayment(item, paymentIntent),
  charge.amount - charge.amount_refunded
));

/**
 * What a purchased-item action changes, so the controls, confirmations and docs say the same thing. `revoke` on a
 * refund is the combined "refund and cancel" (monthly) or "refund and revoke" (one-off) action.
 */
export const itemActionEffects = ({ action, revoke = false }, { monthly = false } = {}) => {
  const refunds = action === 'refund';
  const removesAccess = action === 'revoke' || (refunds && revoke === true);
  return { refunds, removesAccess, stopsBilling: monthly && removesAccess };
};

export const itemActionLabel = (request, item = {}) => {
  const { refunds, removesAccess } = itemActionEffects(request, item);
  if (!refunds) return 'Revoke access (no refund)';
  if (!removesAccess) return item.monthly ? 'Refund one payment (billing continues)' : 'Refund only (access kept)';
  return item.monthly ? 'Refund and cancel' : 'Refund and revoke';
};

export const describeItemAction = (request, item = {}, amountText = 'the chosen amount') => {
  const { refunds, removesAccess, stopsBilling } = itemActionEffects(request, item);
  return [
    refunds ? `Returns ${amountText} to the payer through Stripe.` : 'No money is returned.',
    removesAccess ? 'Removes the item\'s access or benefit now.' : 'Access and benefits stay as they are.',
    stopsBilling ? 'Stops this item\'s future monthly payments; if nothing else is on the Stripe subscription, the whole subscription is cancelled.'
      : item.monthly ? 'Monthly payments carry on.' : ''
  ].filter(Boolean).join(' ');
};
