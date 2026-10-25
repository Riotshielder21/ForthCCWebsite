import { Timestamp } from 'firebase-admin/firestore';
import { rateLimit } from './rateLimit.js';
import { orderLineId, minorUnits, validateItemAction, refundAvailable } from '../utils/itemActions.js';
import { clubYearDates, clubYearOf } from '../utils/clubYear.js';
import { isMembership, grantsMembership } from '../utils/checkout.js';
import { wantedQuantities } from '../utils/inventory.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const stripeId = (value) => typeof value === 'string' ? value : value?.id || '';

export const orderSubscriptions = async (db, orderRef) => {
  const pages = await Promise.all([
    db.collection('subscriptions').where('orderRef', '==', orderRef).get(),
    db.collection('subscriptions').where('orderRefs', 'array-contains', orderRef).get()
  ]);
  return [...new Map(pages.flatMap((page) => page.docs).map((document) => [document.id, document])).values()];
};

export const registerItemActionRoutes = (app, { requireAdmin, db, stripeRequest, stopMonthlyItem }) => {
  const load = async (req) => {
    if (!db()) throw fail(503, 'Purchase storage is not configured.');
    if (!/^[\w-]{1,128}$/.test(req.params.id)) throw fail(400, 'Choose an order.');
    const reference = db().collection('orders').doc(req.params.id);
    const document = await reference.get();
    if (!document.exists) throw fail(404, 'Order not found.');
    const order = document.data();
    const index = (order.items || []).findIndex((item, index) => orderLineId(item, index) === req.params.lineId);
    if (index < 0) throw fail(404, 'Purchased item not found.');
    if (order.status !== 'paid') throw fail(409, 'Only fulfilled, paid orders can be changed.');
    return { reference, order, item: order.items[index], index };
  };

  const listAll = async (path, params) => {
    const result = [];
    let after;
    do {
      const page = await stripeRequest(`${path}?${new URLSearchParams({ ...params, limit: '100', ...(after ? { starting_after: after } : {}) })}`, null, 'GET');
      result.push(...page.data);
      after = page.has_more ? page.data.at(-1)?.id : null;
      if (page.has_more && !after) throw new Error('Stripe returned incomplete pagination.');
    } while (after);
    return result;
  };

  const chargeFor = async (paymentIntent) => {
    const intent = await stripeRequest(`payment_intents/${encodeURIComponent(paymentIntent)}?expand[]=latest_charge`, null, 'GET');
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge
      : intent.latest_charge ? await stripeRequest(`charges/${encodeURIComponent(intent.latest_charge)}`, null, 'GET') : null;
    if (!charge || !charge.paid || charge.currency !== 'gbp') return null;
    if (charge.disputed) throw fail(409, 'This payment is disputed. Resolve the dispute in Stripe before refunding.');
    return charge;
  };

  const paymentsFor = async ({ order, item, index: itemIndex, reference, refreshRefunds = false }) => {
    const updatedRefunds = [];
    for (const refund of item.refunds || []) {
      const current = await stripeRequest(`refunds/${encodeURIComponent(refund.id)}`, null, 'GET');
      updatedRefunds.push({ ...refund, status: current.status });
    }
    if (refreshRefunds && updatedRefunds.some((refund, index) => refund.status !== item.refunds[index].status)) {
      await db().runTransaction(async (transaction) => {
        const current = (await transaction.get(reference)).data();
        const statuses = new Map(updatedRefunds.map((refund) => [refund.id, refund.status]));
        transaction.update(reference, { items: current.items.map((line, index) => index !== itemIndex ? line
          : { ...line, refunds: (line.refunds || []).map((refund) => statuses.has(refund.id) ? { ...refund, status: statuses.get(refund.id) } : refund) }) });
      });
    }
    item = { ...item, refunds: updatedRefunds };
    const allocations = new Map();
    if (order.stripePaymentIntentId && minorUnits(item.price) > 0) {
      allocations.set(order.stripePaymentIntentId, { allocation: minorUnits(item.price), label: 'Checkout payment' });
    }
    const subscriptions = await orderSubscriptions(db(), order.id);
    for (const document of subscriptions) {
      const entry = (document.data().items || []).find((entry) => entry.lineId === item.lineId && (entry.orderRef || document.data().orderRef) === order.id);
      if (!entry) continue;
      const invoices = await listAll('invoices', { subscription: document.id, status: 'paid' });
      for (const invoice of invoices) {
        const lines = invoice.lines?.has_more ? await listAll(`invoices/${encodeURIComponent(invoice.id)}/lines`, {}) : invoice.lines?.data || [];
        const matched = lines.filter((line) => stripeId(line.subscription_item || line.parent?.subscription_item_details?.subscription_item) === entry.stripeItemId);
        const base = matched.reduce((sum, line) => sum + line.amount - (line.discount_amounts || []).reduce((sum, value) => sum + value.amount, 0), 0);
        // Allocate any invoice-wide credit proportionately, never beyond the actual paid amount.
        const denominator = lines.reduce((sum, line) => sum + Math.max(0, line.amount - (line.discount_amounts || []).reduce((sum, value) => sum + value.amount, 0)), 0);
        const allocation = Math.min(base, denominator ? Math.floor(invoice.amount_paid * base / denominator) : 0);
        if (allocation <= 0) continue;
        const payments = invoice.payment_intent ? [{ payment: { payment_intent: stripeId(invoice.payment_intent) } }]
          : await listAll('invoice_payments', { invoice: invoice.id, status: 'paid' });
        // Multi-payment invoices need explicit allocation rather than guessing which payment funded this line.
        if (payments.length !== 1 || !stripeId(payments[0].payment?.payment_intent)) {
          throw fail(409, `Invoice ${invoice.id} has multiple or unsupported payments. Refund it in Stripe and record the adjustment with club staff.`);
        }
        const intent = stripeId(payments[0].payment.payment_intent);
        if (allocations.has(intent)) throw fail(409, 'A payment is linked to both checkout and an invoice. Review it in Stripe before refunding.');
        allocations.set(intent, { allocation, label: `Invoice ${invoice.number || invoice.id}` });
      }
    }
    const result = [];
    for (const [paymentIntent, { allocation, label }] of allocations) {
      const charge = await chargeFor(paymentIntent);
      if (!charge) continue;
      result.push({ paymentIntent, label, amount: allocation, available: refundAvailable(item, paymentIntent, allocation, charge) });
    }
    return result;
  };

  const sendError = (res, error, unfinished = false) => {
    console.error('Purchased item action failed:', error.message);
    res.status(error.status || 502).json({ error: error.message, unfinished });
  };

  app.get('/api/admin/orders/:id/items/:lineId/payments', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const loaded = await load(req);
      res.set('Cache-Control', 'no-store');
      res.json({ payments: req.query.action === 'revoke' ? [] : await paymentsFor({ ...loaded, refreshRefunds: true, order: { ...loaded.order, id: loaded.reference.id } }),
        pending: loaded.order.itemActionPending || null });
    } catch (error) { sendError(res, error); }
  });

  const revokeEntitlements = async (transaction, reference, order, index, by, reason, at) => {
    const target = order.items[index];
    const memberIds = [...new Set((order.people || []).filter((person) => person.lineIds?.includes(target.lineId)).map((person) => person.membershipId).filter(Boolean))];
    const members = memberIds.length ? await transaction.getAll(...memberIds.map((id) => db().collection('memberships').doc(id))) : [];
    const previousOrderIds = [...new Set(members.flatMap((member) => (member.data()?.history || []).map((entry) => entry.orderRef)).filter((id) => id && id !== reference.id))];
    const previousOrders = previousOrderIds.length ? await transaction.getAll(...previousOrderIds.map((id) => db().collection('orders').doc(id))) : [];
    const stocks = await transaction.get(db().collection('stock').doc(target.id));
    const voucherIndex = order.items.slice(0, index).filter((item) => item.type === 'voucher').length;
    const voucher = target.type === 'voucher' ? order.vouchers?.[voucherIndex] : null;
    const voucherDoc = voucher ? await transaction.get(db().collection('discountCodes').doc(voucher.code)) : null;
    if (voucherDoc?.data()?.used || voucherDoc?.data()?.reservedUntil?.toMillis() > at.toMillis()) {
      throw fail(409, 'This voucher is redeemed or in checkout. It cannot be revoked while it is in use.');
    }
    const changedItems = order.items.map((item, itemIndex) => itemIndex === index ? { ...item, revokedAt: at, revokedBy: by, revokeReason: reason } : item);
    for (const document of members.filter((document) => document.exists)) {
      const member = document.data();
      const update = {
        privileges: (member.privileges || []).map((privilege) => privilege.orderRef === reference.id
          && (target.lineId ? privilege.lineId === target.lineId : privilege.productId === target.id)
          ? { ...privilege, endedAt: at, revokeReason: reason, revokedBy: by } : privilege),
        updatedAt: at
      };
      if (target.id === 'keyhire') update.keyAccess = { ...member.keyAccess, revokedAt: at, reason, by };
      if (isMembership(target) || (grantsMembership(target) && member.membershipIncludedWith?.orderRef === reference.id)) {
        const orders = [{ id: reference.id, ...order, items: changedItems },
          ...previousOrders.filter((entry) => entry.exists && entry.data().status === 'paid').map((entry) => ({ id: entry.id, ...entry.data() }))];
        const years = new Set();
        for (const purchase of orders) {
          const person = purchase.people?.find((person) => person.membershipId === document.id);
          if (!person) continue;
          for (const line of purchase.items || []) {
            if (!line.revokedAt && person.lineIds?.includes(line.lineId)
              && (isMembership(line) || ((person.grantMembershipYears || []).includes(line.clubYear) && grantsMembership(line)))) {
              years.add(line.clubYear || clubYearOf(purchase.paidAt?.toDate() || at.toDate()));
            }
          }
        }
        const baseline = member.membershipBeforeWebsite;
        const ends = [...years].map((year) => clubYearDates(year).end.getTime());
        if (baseline?.validUntil) ends.push(baseline.validUntil.toMillis());
        const end = ends.length ? Math.max(...ends) : 0;
        update.clubYears = [...years].sort();
        update.validUntil = Timestamp.fromMillis(end);
        update.status = end > at.toMillis() ? 'active' : 'revoked';
        update.membershipAccessEndsAt = update.validUntil;
        update.justgoSyncStatus = 'pending';
        update.justgoUpload = { status: 'revoked', needsStaff: true, lastError: 'Admin revoked a purchased membership. Review the matching JustGo record.' };
        update.membershipRevokedAt = at;
      }
      transaction.update(document.ref, update);
    }
    if (stocks.exists) {
      const remaining = changedItems.filter((item) => item.id === target.id && !item.revokedAt);
      const holds = { ...stocks.data().holds };
      if (remaining.length) holds[reference.id] = { until: null, lines: wantedQuantities(remaining) };
      else delete holds[reference.id];
      transaction.update(stocks.ref, { holds });
    }
    if (voucherDoc?.exists) transaction.update(voucherDoc.ref, { active: false, revokedAt: at, revokeReason: reason, revokedBy: by });
    return changedItems;
  };

  app.post('/api/admin/orders/:id/items/:lineId/actions', rateLimit(10, 60 * 1000), async (req, res) => {
    let claimed = false;
    let freshRefundRequest = false;
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { error, value } = validateItemAction(req.body);
      if (error) throw fail(400, error);
      const loaded = await load(req);
      const { reference, index } = loaded;
      const operation = db().collection('adminItemAudit').doc(value.operationId);
      const by = admin.email || admin.uid;
      const stored = (await operation.get()).data();
      if (stored && (stored.orderRef !== reference.id || stored.lineId !== req.params.lineId
        || Object.entries(value).some(([key, value]) => stored[key] !== value))) throw fail(409, 'Operation ID belongs to another action.');
      if (stored?.status === 'complete') {
        if (stored.refundStatus && ['failed', 'canceled'].includes(stored.refundStatus)) throw fail(409, `The recorded refund ${stored.refundId || ''} ${stored.refundStatus}. Review it before creating a new action.`);
        return res.json({ success: true, alreadyCompleted: true,
          ...(stored.refundId ? { refundId: stored.refundId, refundStatus: stored.refundStatus } : {}) });
      }
      const wantsRevoke = value.action === 'revoke' || value.revoke;
      if (!loaded.order.itemActionPending) {
        if (wantsRevoke && loaded.item.revokedAt) throw fail(409, 'This item is already revoked. A refund without another revocation is still available.');
        if (value.action === 'refund') {
          const payments = await paymentsFor({ ...loaded, order: { ...loaded.order, id: reference.id } });
          const payment = payments.find((payment) => payment.paymentIntent === value.paymentIntent);
          if (!payment || value.amount > payment.available) throw fail(400, 'The refund exceeds the amount available for this item and payment.');
        }
      }
      await db().runTransaction(async (transaction) => {
        const current = (await transaction.get(reference)).data();
        const prior = await transaction.get(operation);
        if (prior.exists && (prior.data().orderRef !== reference.id || prior.data().lineId !== req.params.lineId
          || Object.entries(value).some(([key, value]) => prior.data()[key] !== value))) throw fail(409, 'Operation ID belongs to another action.');
        if (prior.exists && prior.data().status === 'complete') throw fail(409, 'Action already completed. Refresh the order.');
        if (wantsRevoke) {
          const item = current.items[index];
          if (item.monthly && current.subscriptionPlan && !current.subscriptionPlan.recordedAt) {
            throw fail(409, 'Monthly payment setup is unfinished. Reconcile that setup before revoking this item so billing cannot restart later.');
          }
          if (!item.lineId && (isMembership(item) || item.category === 'SERVICES')) {
            throw fail(409, 'This legacy item has no person-level line ID. Reconcile its entitlement on the member record before revoking it.');
          }
          if (isMembership(item) || grantsMembership(item)) {
            const memberIds = [...new Set((current.people || []).filter((person) => person.lineIds?.includes(item.lineId))
              .map((person) => person.membershipId).filter(Boolean))];
            const members = memberIds.length ? await transaction.getAll(...memberIds.map((id) => db().collection('memberships').doc(id))) : [];
            if (members.some((member) => member.data()?.source !== 'website' && member.data()?.validUntil && !member.data()?.membershipBeforeWebsite)) {
              throw fail(409, 'This imported membership has no saved pre-purchase coverage. Staff must reconcile its independent cover before this item can be revoked.');
            }
          }
          if (item.type === 'voucher') {
            const voucherIndex = current.items.slice(0, index).filter((item) => item.type === 'voucher').length;
            const code = current.vouchers?.[voucherIndex]?.code;
            if (!code) throw fail(409, 'This voucher has no recorded code. Reconcile its entitlement before revoking it.');
            const voucher = await transaction.get(db().collection('discountCodes').doc(code));
            if (!voucher.exists || voucher.data().used || voucher.data().reservedUntil?.toMillis() > Date.now()) {
              throw fail(409, 'The voucher is missing, redeemed or in checkout; it cannot be revoked.');
            }
          }
        }
        if (current.itemActionPending) {
          if (JSON.stringify(current.itemActionPending.request) !== JSON.stringify(value) || current.itemActionPending.lineId !== req.params.lineId) {
            throw fail(409, 'An unfinished action is recorded on this order. Retry that exact action before making another change.');
          }
        } else {
          if (current.items[index].revokedAt && wantsRevoke) throw fail(409, 'Item already revoked.');
          // Recheck local allocations inside the lock: another admin may just have completed a refund.
          if (JSON.stringify(current.items[index]) !== JSON.stringify(loaded.item)) throw fail(409, 'The item changed. Reload before continuing.');
          transaction.update(reference, { itemActionPending: { lineId: req.params.lineId, request: value, by, at: Timestamp.now() } });
          transaction.set(operation, { orderRef: reference.id, lineId: req.params.lineId, ...value, by, status: 'pending', at: Timestamp.now() });
        }
      });
      claimed = true;
      let refund = stored?.refund || null;
      if (value.action === 'refund' && !refund) {
        const existing = await listAll('refunds', { payment_intent: value.paymentIntent });
        refund = existing.find((refund) => refund.metadata?.operation_id === value.operationId);
        if (!refund) {
          freshRefundRequest = !loaded.order.itemActionPending;
          refund = await stripeRequest('refunds', [
            ['payment_intent', value.paymentIntent], ['amount', String(value.amount)],
            ['metadata[order_ref]', reference.id], ['metadata[line_id]', req.params.lineId], ['metadata[operation_id]', value.operationId]
          ], 'POST', { idempotencyKey: value.operationId });
          freshRefundRequest = false;
        }
        // Save the Stripe response before local fulfilment changes so a retry cannot issue another refund.
        await operation.update({ refund });
      }
      if (refund && ['failed', 'canceled'].includes(refund.status)) {
        await db().runTransaction(async (transaction) => {
          const current = (await transaction.get(reference)).data();
          if (current.itemActionPending?.request.operationId !== value.operationId) return;
          transaction.update(reference, { itemActionPending: null });
          transaction.update(operation, { status: 'complete', refundId: refund.id, refundStatus: refund.status, completedAt: Timestamp.now() });
        });
        claimed = false;
        throw fail(409, `Stripe refund ${refund.id} is ${refund.status}. No entitlement was revoked. Review the payment before trying a new refund.`);
      }
      if (wantsRevoke) await stopMonthlyItem(reference.id, loaded.item, admin, value.reason);
      await db().runTransaction(async (transaction) => {
        const current = (await transaction.get(reference)).data();
        const operationRecord = await transaction.get(operation);
        if (operationRecord.data()?.status === 'complete') return;
        const at = Timestamp.now();
        let items = wantsRevoke ? await revokeEntitlements(transaction, reference, current, index, by, value.reason, at) : current.items;
        items = items.map((item, itemIndex) => index !== itemIndex || !refund ? item : { ...item,
          refunds: [...(item.refunds || []), { id: refund.id, status: refund.status, amount: value.amount,
            paymentIntent: value.paymentIntent, by, reason: value.reason, at }] });
        transaction.update(reference, { items, itemActionPending: null });
        transaction.update(operation, { status: 'complete', completedAt: at, ...(refund ? { refundId: refund.id, refundStatus: refund.status } : {}) });
      });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, ...(refund ? { refundId: refund.id, refundStatus: refund.status } : {}) });
    } catch (error) {
      if (claimed && freshRefundRequest && error.stripeStatus >= 400 && error.stripeStatus < 500 && error.stripeCode !== 'idempotency_key_in_use') {
        // A definite Stripe rejection has no refund to reconcile. Network/5xx failures keep the claim.
        try {
          const operation = db().collection('adminItemAudit').doc(req.body.operationId);
          const released = await db().runTransaction(async (transaction) => {
            const reference = db().collection('orders').doc(req.params.id);
            const current = (await transaction.get(reference)).data();
            const recorded = (await transaction.get(operation)).data();
            if (!recorded?.refund && current.itemActionPending?.request.operationId === req.body.operationId) {
              transaction.update(reference, { itemActionPending: null });
              transaction.update(operation, { status: 'rejected', error: error.message });
              return true;
            }
            return false;
          });
          if (released) claimed = false;
        } catch (reconciliationError) {
          console.error('Could not record the rejected Stripe refund:', reconciliationError.message);
        }
      }
      if (claimed) error.message += ' This action is recorded as unfinished; retry the same action to reconcile it. Do not create a replacement refund.';
      sendError(res, error, claimed);
    }
  });
};
