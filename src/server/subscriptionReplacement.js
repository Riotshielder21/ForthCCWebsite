import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { emailBlockId, normalEmailBlocked } from './emailSuppression.js';
import { replacementCredit } from './replacementCredit.js';
import { isRecurringLine } from '../utils/subscriptions.js';

export const replacementInvites = 'subscriptionReplacementInvites';
export const replacementTokenId = (token) => typeof token === 'string' && /^[0-9a-f]{64}\.[0-9a-f]{64}$/.test(token) ? token.slice(0, 64) : '';
export const replacementTokenHash = token => createHash('sha256').update(token).digest('hex');
const subId = (value) => /^sub_[A-Za-z0-9]+$/.test(value || '');
const stripeId = (value) => typeof value === 'string' ? value : value?.id;
const refused = (message) => Object.assign(new Error(message), { status: 409 });
const localPreview = invite => invite.previewOnly === true && process.env.LOCAL_FIREBASE_EMULATORS === 'true' &&
  /^(?:localhost|127\.0\.0\.1):[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') &&
  (process.env.GCLOUD_PROJECT || '').startsWith('demo-');

// An invitation replaces a monthly or a yearly subscription (`interval`, monthly for older invitations) with the same.
const replacementInterval = invite => invite.interval === 'year' ? 'year' : 'month';
const replacesLine = (invite, order) => item => isRecurringLine(item) && (item.yearly ? 'year' : 'month') === replacementInterval(invite) &&
  !item.revokedAt && order.subscriptionPlan?.groups?.some(group => group.lineIds.includes(item.lineId));

export function replacementItems(invite, order) {
  if (localPreview(invite)) return order.items.some(replacesLine(invite, order));
  return invite.productIds.length > 0 && invite.productIds.every(id => order.items.some(item => item.id === id && replacesLine(invite, order)(item)));
}

export async function replacementSource(path, method = 'GET', params) {
  const key = process.env.STRIPE_REPLACEMENT_SOURCE_KEY || '';
  if (!/^(rk|sk)_test_/.test(key)) throw new Error('Replacement Source must use a Stripe sandbox key.');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2025-02-24.acacia' },
    ...(params ? { body: new URLSearchParams(params) } : {}), signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Replacement Source Stripe request failed (${response.status}).`);
  return response.json();
}

export async function verifyReplacementAccounts(invite, source, destination) {
  if (invite.previewOnly) {
    if (!localPreview(invite) || (await destination('account', null, 'GET')).id !== invite.destinationAccount) {
      throw new Error('Local preview requires its original sandbox account and demo Firebase emulators.');
    }
    return;
  }
  const [from, to] = await Promise.all([source('account'), destination('account', null, 'GET')]);
  if (from.id !== invite.sourceAccount || to.id !== invite.destinationAccount || from.id === to.id) {
    throw new Error('Replacement Stripe accounts do not match the invitation.');
  }
}

export async function claimReplacement(db, { token, email, orderRef, items, subscriptionPlan, destination }) {
  const id = replacementTokenId(token);
  if (!id) throw refused('This replacement link is unavailable.');
  const ref = db.collection(replacementInvites).doc(id);
  const invite = (await ref.get()).data();
  if (!invite || (invite.previewOnly ? !localPreview(invite) : process.env.STRIPE_REPLACEMENT_ENABLED !== 'true')) {
    throw refused('This replacement link is unavailable.');
  }
  if (!invite || invite.tokenHash !== replacementTokenHash(token) || invite.emailHash !== emailBlockId(email) ||
    invite.expiresAt.toMillis() <= Date.now() || invite.stopped ||
    !subId(invite.sourceId) || await normalEmailBlocked(db, email, { subscriptionId: invite.sourceId })) {
    throw refused('Use the billing email that received your replacement invitation, or contact the club.');
  }
  if (!replacementItems(invite, { items, subscriptionPlan })) {
    throw refused(`Choose ${replacementInterval(invite) === 'year' ? 'yearly' : 'monthly'} payments for all the replacement products listed in your invitation.`);
  }
  await verifyReplacementAccounts(invite, replacementSource, destination);
  // The credit is worked out from the old subscription's last payment now, as checkout starts.
  let plan = null;
  if (!invite.previewOnly) {
    const original = await replacementSource(`subscriptions/${invite.sourceId}?expand%5B%5D=latest_invoice.charge`);
    plan = original?.id === invite.sourceId && ['active', 'trialing'].includes(original.status) ? replacementCredit(original, original.latest_invoice) : null;
    if (!plan || plan.interval !== replacementInterval(invite)) {
      throw refused('We could not check the last payment on your current subscription, so nothing has been charged. Please contact the club.');
    }
  }
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!current || current.tokenHash !== invite.tokenHash || current.stopped || current.expiresAt.toMillis() <= Date.now()) throw refused('This replacement link is unavailable.');
    if (current.orderRef && current.orderRef !== orderRef) {
      const previous = (await tx.get(db.collection('orders').doc(current.orderRef))).data();
      if (!['expired', 'payment_failed', 'cancelled'].includes(previous?.status)) {
        throw refused('A checkout has already started for this link. Check its status before paying again.');
      }
    }
    tx.update(ref, { orderRef });
  });
  return { id, productIds: invite.productIds || [], plan };
}

export async function releaseReplacement(db, id, orderRef) {
  if (!id) return;
  const ref = db.collection(replacementInvites).doc(id);
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).data()?.orderRef === orderRef) tx.update(ref, { orderRef: '' });
  });
}

async function verifyNewSubscription({ order, orderRef, invite, source, destination }) {
  if (invite.orderRef !== orderRef || order.status !== 'paid' || order.stripe?.mode !== 'test' ||
    invite.emailHash !== emailBlockId(order.email) || !subId(invite.sourceId) ||
    order.subscriptionPlan?.status !== 'active' || !replacementItems(invite, order)) {
    throw new Error('The paid replacement subscription has not been verified.');
  }
  await verifyReplacementAccounts(invite, source, destination);
  const lines = order.items.filter(item => (localPreview(invite) || invite.productIds.includes(item.id)) && replacesLine(invite, order)(item));
  const targets = new Map();
  for (const line of lines) {
    const group = order.subscriptionPlan.groups.find(value => value.lineIds.includes(line.lineId));
    const id = group?.stripeSubscriptionId;
    if (!group?.recorded || !group.created || !subId(id) || id === invite.sourceId || !line.stripeSubscriptionItemId) {
      throw new Error('The replacement Stripe subscription items are not recorded.');
    }
    if (!targets.has(id)) targets.set(id, await destination(`subscriptions/${id}`, null, 'GET'));
    const subscription = targets.get(id);
    if (subscription.livemode !== false || !['active', 'trialing'].includes(subscription.status) ||
      subscription.cancel_at_period_end || subscription.pause_collection || subscription.items?.has_more ||
      !subscription.items?.data?.some(item => item.id === line.stripeSubscriptionItemId &&
        item.metadata?.line_id === line.lineId && item.metadata?.order_ref === orderRef)) {
      throw new Error('The replacement Stripe subscription is not active or has changed.');
    }
  }
  return targets;
}

export async function stopReplacedSubscription(params) {
  const { invite, source } = params;
  if (invite.previewOnly) throw new Error('Local previews must never cancel Source subscriptions.');
  const targets = await verifyNewSubscription(params);
  const path = `subscriptions/${invite.sourceId}`;
  const original = await source(`${path}?expand%5B%5D=customer`);
  if (original.id !== invite.sourceId || original.livemode !== false || !original.customer?.email ||
    emailBlockId(original.customer.email) !== invite.emailHash) throw new Error('Source subscription or billing address changed.');
  if (original.status === 'canceled') return targets;
  if (!['active', 'trialing'].includes(original.status) || original.schedule || original.items?.has_more ||
    !Array.isArray(original.items?.data) || !Array.isArray(invite.sourcePriceIds) ||
    original.items.data.map(item => stripeId(item.price)).sort().join(',') !== invite.sourcePriceIds.join(',')) {
    throw new Error('Source terms changed or the subscription needs manual cancellation.');
  }
  const [open, draft] = await Promise.all(['open', 'draft'].map(status =>
    source(`invoices?${new URLSearchParams({ subscription: invite.sourceId, status, limit: '1' })}`)));
  if (!Array.isArray(open.data) || !Array.isArray(draft.data) || open.data.length || draft.data.length) {
    throw new Error('Source has an open or draft invoice; review it before cancelling.');
  }
  const canceled = await source(path, 'DELETE', { invoice_now: 'false', prorate: 'false' });
  if (canceled.id !== invite.sourceId || canceled.status !== 'canceled') throw new Error('Stripe did not confirm Source cancellation.');
  return targets;
}

/**
 * Credit left after the first payment comes off the new subscription's next payments: a Stripe customer balance on the
 * Destination customer that pays for it. Added once, and only after the old subscription has stopped.
 */
async function carryForwardCredit(db, orderRefDoc, orderRef, order, destination) {
  const credit = order.replacementCredit;
  if (!(credit?.carryForwardPence > 0) || credit.carriedForwardAt) return;
  const subscriptionId = (order.subscriptionPlan?.groups || []).find(group => group.stripeSubscriptionId)?.stripeSubscriptionId;
  const customer = subscriptionId ? stripeId((await destination(`subscriptions/${subscriptionId}`, null, 'GET')).customer) : '';
  if (!/^cus_[A-Za-z0-9]+$/.test(customer || '')) throw new Error('The new subscription has no Stripe customer to hold the credit.');
  await destination(`customers/${customer}/balance_transactions`, [['amount', String(-credit.carryForwardPence)], ['currency', 'gbp'],
    ['description', 'Credit from your previous subscription'], ['metadata[order_ref]', orderRef]], 'POST', { idempotencyKey: `${orderRef}-replacement-credit` });
  await orderRefDoc.update({ 'replacementCredit.carriedForwardAt': Timestamp.now() });
}

export async function completeReplacement(db, orderRef, { destination, attention }) {
  const orderRefDoc = db.collection('orders').doc(orderRef);
  const order = (await orderRefDoc.get()).data();
  if (!order?.replacementInvite || order.replacementStatus === 'preview-complete') return;
  if (order.replacementStatus === 'stopped') {
    await carryForwardCredit(db, orderRefDoc, orderRef, order, destination);
    await attention.settle('subscription-replacement', orderRef);
    return;
  }
  const ref = db.collection(replacementInvites).doc(order.replacementInvite);
  const invite = (await ref.get()).data();
  try {
    if (!invite || (invite.previewOnly ? !localPreview(invite) : process.env.STRIPE_REPLACEMENT_ENABLED !== 'true') ||
      await normalEmailBlocked(db, order.email, { subscriptionId: invite.sourceId, orderRef })) {
      throw new Error('Replacement is disabled, missing or suppressed.');
    }
    if (invite.orderRef !== orderRef) throw new Error('Replacement invitation is bound to another order.');
    const params = { order, orderRef, invite, source: replacementSource, destination };
    if (invite.previewOnly) await verifyNewSubscription(params);
    else if (!invite.stopped) await stopReplacedSubscription(params);
    const batch = db.batch();
    batch.update(ref, invite.previewOnly ? { previewComplete: true } : { stopped: true });
    batch.update(orderRefDoc, { replacementStatus: invite.previewOnly ? 'preview-complete' : 'stopped' });
    await batch.commit();
  } catch (error) {
    const pending = await db.runTransaction(async tx => {
      if (['stopped', 'preview-complete'].includes((await tx.get(orderRefDoc)).data()?.replacementStatus)) return false;
      tx.update(orderRefDoc, { replacementStatus: 'needs-review' });
      return true;
    });
    if (!pending) return;
    await attention.raise('subscription-replacement', orderRef, { orderRef, subscriptionId: invite?.sourceId || '',
      detail: `New checkout exists, but the old subscription stop needs review: ${error.message}` });
    throw error;
  }
  if (invite.previewOnly) return attention.settle('subscription-replacement', orderRef);
  try {
    await carryForwardCredit(db, orderRefDoc, orderRef, order, destination);
    await attention.settle('subscription-replacement', orderRef);
  } catch (error) {
    await attention.raise('subscription-replacement', orderRef, { orderRef, subscriptionId: invite.sourceId,
      detail: `The old subscription is stopped, but £${(order.replacementCredit.carryForwardPence / 100).toFixed(2)} of credit could not be added to the new one: ${error.message} Retry here, or add it in Stripe as a customer balance.` });
    throw error;
  }
}
