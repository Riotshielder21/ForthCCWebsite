import React, { useState } from 'react';
import { apiUrl, apiFetch } from '../utils/api';
import { itemActionLabel, describeItemAction } from '../utils/itemActions';

const money = (pence) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
// Billing can only be stopped here while the item's monthly payments are still running.
const billing = (item) => ({ monthly: Boolean(item?.monthly && !item.monthlyCancelledAt) });

export default function PurchasedItemActions({ order, adminUser, onChanged }) {
  const [draft, setDraft] = useState(null);
  const [payments, setPayments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = async (path, options = {}) => {
    const response = await apiFetch(apiUrl(path), { ...options, headers: {
      Authorization: `Bearer ${await adminUser.getIdToken(true)}`, 'Content-Type': 'application/json'
    }, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Could not update the purchased item.'), { unfinished: result.unfinished });
    return result;
  };
  const base = (lineId) => `/api/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(lineId)}`;
  const pendingItem = order.items.find((item) => item.actionPending);
  const begin = async (item, action, revoke = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(`${base(item.lineId)}/payments?action=${action}`);
      const pending = result.pending;
      setPayments(result.payments);
      setDraft(pending ? { ...pending.request, lineId: pending.lineId, locked: true }
        : { lineId: item.lineId, action, reason: '', operationId: crypto.randomUUID(),
          paymentIntent: result.payments[0]?.paymentIntent || '', amount: '', revoke, locked: false });
      if (action === 'refund' || pending) await onChanged();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    const item = order.items.find((entry) => entry.lineId === draft.lineId);
    const effect = describeItemAction(draft, billing(item), draft.amount ? money(Number(draft.amount)) : undefined);
    if (!window.confirm(draft.locked ? `Resume the recorded action (${itemActionLabel(draft, billing(item))})? ${effect}${draft.action === 'refund' ? ' No second refund is created.' : ''}`
      : `${itemActionLabel(draft, billing(item))}: ${item?.name}? ${effect}`)) return;
    setBusy(true); setError('');
    const { lineId, locked, ...body } = draft;
    setDraft({ ...draft, locked: true });
    try {
      const result = await request(`${base(lineId)}/actions`, { method: 'POST', body: JSON.stringify({ ...body, ...(body.action === 'refund' ? { amount: Number(body.amount) } : {}) }) });
      setMessage([result.refundId && `Stripe refund ${result.refundId}: ${result.refundStatus}.`,
        draft.action === 'revoke' || draft.revoke ? 'Access removed.' : 'Access kept.',
        result.monthlyPaymentsStopped ? 'Future monthly payments for this item stopped.' : billing(item).monthly && 'Monthly payments carry on.',
        'The order is retained.'].filter(Boolean).join(' '));
      setDraft(null);
      await onChanged();
    } catch (failure) {
      setError(failure.message);
      if (failure.unfinished === false) setDraft((draft) => draft && ({ ...draft, locked: false }));
    }
    finally { setBusy(false); }
  };
  return <section className="SpaceT4">
    <h4 className="CartItemTitle">Purchased item actions</h4>
    <ul className="text_container">
      <li><strong>Revoke access</strong> removes the benefit now. No money is returned. For a monthly item it also stops future payments.</li>
      <li><strong>Refund one payment</strong> (or <strong>Refund only</strong>) returns money through Stripe. Access stays and monthly payments carry on.</li>
      <li><strong>Refund and cancel</strong> (monthly) or <strong>Refund and revoke</strong> (one-off) returns money, removes the benefit now and stops future monthly payments. If nothing else is on the Stripe subscription, the whole subscription is cancelled.</li>
      <li><strong>Resume unfinished action</strong> finishes a recorded action that was interrupted. It never issues a second refund.</li>
    </ul>
    <p className="text_container">None of these deletes the order. To stop monthly payments without a refund and let access run to the paid-up date, use Monthly payments below or the Subscriptions tab.</p>
    {order.items.map((item) => <div key={item.lineId} className="SpaceT4">
      <strong>{item.name}</strong>
      {item.attendeeErased && <p className="text_container">Attendee's personal data erased: removed from the attendee list and their place freed. Kept as a record of what was paid.</p>}
      {item.revokedAt && <p className="text_container">Revoked {new Date(item.revokedAt).toLocaleString('en-GB')} by {item.revokedBy}: {item.revokeReason}</p>}
      {item.monthlyCancelledAt && <p className="text_container">Monthly payments stopped {new Date(item.monthlyCancelledAt).toLocaleString('en-GB')}.</p>}
      {item.refunds.map((refund) => <p key={refund.id} className="text_container">{money(refund.amount)} refund ({refund.status}), {refund.id}, by {refund.by}: {refund.reason}</p>)}
      <div className="ReportsRowActions">
        {item.actionPending ? <button type="button" className="EditorCommand" disabled={busy || Boolean(draft)} onClick={() => begin(item, 'refund')}>Resume unfinished action</button> : <>
          <button type="button" className="EditorCommand" disabled={busy || Boolean(draft) || Boolean(pendingItem) || Boolean(item.revokedAt)} onClick={() => begin(item, 'revoke')}>{itemActionLabel({ action: 'revoke' }, billing(item))}</button>
          <button type="button" className="EditorCommand" disabled={busy || Boolean(draft) || Boolean(pendingItem)} onClick={() => begin(item, 'refund')}>{itemActionLabel({ action: 'refund', revoke: false }, billing(item))}</button>
          <button type="button" className="EditorCommand" disabled={busy || Boolean(draft) || Boolean(pendingItem) || Boolean(item.revokedAt)} onClick={() => begin(item, 'refund', true)}>{itemActionLabel({ action: 'refund', revoke: true }, billing(item))}</button>
        </>}
      </div>
    </div>)}
    {draft && <form className="SpaceT4" onSubmit={submit}>
      <h4 className="CartItemTitle">{draft.locked ? 'Resume unfinished action: ' : ''}{itemActionLabel(draft, billing(order.items.find((item) => item.lineId === draft.lineId)))}: {order.items.find((item) => item.lineId === draft.lineId)?.name}</h4>
      <p className="text_container">{describeItemAction(draft, billing(order.items.find((item) => item.lineId === draft.lineId)))}
        {draft.locked && ' This finishes the action already recorded, with its original amount and payment. No second refund is created.'}</p>
      {draft.action === 'refund' && <>
        <label className="FormLabel">Payment<select className="FormInput" disabled={busy || draft.locked} value={draft.paymentIntent}
          onChange={(event) => setDraft({ ...draft, paymentIntent: event.target.value })}>
          <option value="">Select payment</option>{payments.map((payment) => <option key={payment.paymentIntent} value={payment.paymentIntent}>{payment.label}: {money(payment.available)} available</option>)}
          {draft.locked && !payments.some((payment) => payment.paymentIntent === draft.paymentIntent) && <option value={draft.paymentIntent}>Recorded payment: {draft.paymentIntent}</option>}
        </select></label>
        {!payments.length && !draft.locked && <p className="ReportWarning">No refundable Stripe payment is linked to this item. Free items can still be revoked.</p>}
        {billing(order.items.find((item) => item.lineId === draft.lineId)).monthly && <p className="text_container">Each monthly payment is listed separately. Refund the month you mean.</p>}
        <label className="FormLabel">Amount (£)<input className="FormInput" type="number" min="0.01" step="0.01" required disabled={busy || draft.locked}
          max={(payments.find((payment) => payment.paymentIntent === draft.paymentIntent)?.available || 0) / 100}
          value={draft.amount === '' ? '' : Number(draft.amount) / 100}
          onChange={(event) => setDraft({ ...draft, amount: event.target.value === '' ? '' : Math.round(Number(event.target.value) * 100) })} /></label>
      </>}
      <label className="FormLabel">Reason / notes (required)<textarea className="FormInput" required maxLength={1000} disabled={busy || draft.locked} value={draft.reason}
        onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      <button className="EditorCommand" type="submit" disabled={busy || (draft.action === 'refund' && !draft.paymentIntent)}>{busy ? 'Working…' : draft.locked ? 'Resume recorded action' : `Confirm: ${itemActionLabel(draft, billing(order.items.find((item) => item.lineId === draft.lineId)))}`}</button>
      {!draft.locked && <button className="EditorCommand" type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>}
    </form>}
    {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
    {message && <p className="StatusText StatusTextSuccess" role="status">{message}</p>}
  </section>;
}
