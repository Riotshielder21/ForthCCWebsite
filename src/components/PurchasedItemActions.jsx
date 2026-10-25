import React, { useState } from 'react';
import { apiUrl } from '../utils/api';

const money = (pence) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);

export default function PurchasedItemActions({ order, adminUser, onChanged }) {
  const [draft, setDraft] = useState(null);
  const [payments, setPayments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = async (path, options = {}) => {
    const response = await fetch(apiUrl(path), { ...options, headers: {
      Authorization: `Bearer ${await adminUser.getIdToken(true)}`, 'Content-Type': 'application/json'
    }, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Could not update the purchased item.'), { unfinished: result.unfinished });
    return result;
  };
  const base = (lineId) => `/api/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(lineId)}`;
  const begin = async (item, action) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(`${base(item.lineId)}/payments?action=${action}`);
      const pending = result.pending;
      setPayments(result.payments);
      setDraft(pending ? { ...pending.request, lineId: pending.lineId, locked: true }
        : { lineId: item.lineId, action, reason: '', operationId: crypto.randomUUID(),
          paymentIntent: result.payments[0]?.paymentIntent || '', amount: '', revoke: false, locked: false });
      if (action === 'refund') await onChanged();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!window.confirm(draft.action === 'refund' ? `Submit a real Stripe refund of ${money(Number(draft.amount))}${draft.revoke ? ' and revoke the item' : ' without revoking access'}?` : 'Revoke this item and stop its future monthly payments?')) return;
    setBusy(true); setError('');
    const { lineId, locked, ...body } = draft;
    setDraft({ ...draft, locked: true });
    try {
      const result = await request(`${base(lineId)}/actions`, { method: 'POST', body: JSON.stringify({ ...body, ...(body.action === 'refund' ? { amount: Number(body.amount) } : {}) }) });
      setMessage(result.refundId ? `Stripe refund ${result.refundId}: ${result.refundStatus}. The order is retained.` : 'Item revoked. The order is retained.');
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
    <p className="text_container">Refunds return money through Stripe. Revocation removes the benefit and stops this item's future monthly payments; neither action deletes the order. A refund on its own does not revoke access or stop billing.</p>
    {order.items.map((item) => <div key={item.lineId} className="SpaceT4">
      <strong>{item.name}</strong>
      {item.revokedAt && <p className="text_container">Revoked {new Date(item.revokedAt).toLocaleString('en-GB')} by {item.revokedBy}: {item.revokeReason}</p>}
      {item.refunds.map((refund) => <p key={refund.id} className="text_container">{money(refund.amount)} refund ({refund.status}), {refund.id}, by {refund.by}: {refund.reason}</p>)}
      <div className="ReportsRowActions">
        <button type="button" className="EditorCommand" disabled={busy || Boolean(draft) || Boolean(item.revokedAt)} onClick={() => begin(item, 'revoke')}>Revoke item</button>
        <button type="button" className="EditorCommand" disabled={busy || Boolean(draft)} onClick={() => begin(item, 'refund')}>Refund / retry unfinished action</button>
      </div>
    </div>)}
    {draft && <form className="SpaceT4" onSubmit={submit}>
      <h4 className="CartItemTitle">{draft.locked ? 'Retry recorded action' : draft.action === 'refund' ? 'Refund selected item' : 'Revoke selected item'}: {order.items.find((item) => item.lineId === draft.lineId)?.name}</h4>
      {draft.action === 'refund' && <>
        <label className="FormLabel">Payment<select className="FormInput" disabled={busy || draft.locked} value={draft.paymentIntent}
          onChange={(event) => setDraft({ ...draft, paymentIntent: event.target.value })}>
          <option value="">Select payment</option>{payments.map((payment) => <option key={payment.paymentIntent} value={payment.paymentIntent}>{payment.label}: {money(payment.available)} available</option>)}
          {draft.locked && !payments.some((payment) => payment.paymentIntent === draft.paymentIntent) && <option value={draft.paymentIntent}>Recorded payment: {draft.paymentIntent}</option>}
        </select></label>
        {!payments.length && !draft.locked && <p className="ReportWarning">No refundable Stripe payment is linked to this item. Free items can still be revoked.</p>}
        <label className="FormLabel">Amount (£)<input className="FormInput" type="number" min="0.01" step="0.01" required disabled={busy || draft.locked}
          max={(payments.find((payment) => payment.paymentIntent === draft.paymentIntent)?.available || 0) / 100}
          value={draft.amount === '' ? '' : Number(draft.amount) / 100}
          onChange={(event) => setDraft({ ...draft, amount: event.target.value === '' ? '' : Math.round(Number(event.target.value) * 100) })} /></label>
        <label className="CheckoutCheck"><input type="checkbox" disabled={busy || draft.locked} checked={draft.revoke}
          onChange={(event) => setDraft({ ...draft, revoke: event.target.checked })} />Also revoke the item and stop its future monthly payments</label>
      </>}
      <label className="FormLabel">Reason / notes (required)<textarea className="FormInput" required maxLength={1000} disabled={busy || draft.locked} value={draft.reason}
        onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      <button className="EditorCommand" type="submit" disabled={busy || (draft.action === 'refund' && !draft.paymentIntent)}>{busy ? 'Working…' : draft.locked ? 'Retry exact recorded action' : 'Confirm action'}</button>
      {!draft.locked && <button className="EditorCommand" type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>}
    </form>}
    {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
    {message && <p className="StatusText StatusTextSuccess" role="status">{message}</p>}
  </section>;
}
