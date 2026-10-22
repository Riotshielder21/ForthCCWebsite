import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';
import { monthlyTotal } from '../utils/subscriptions';

const date = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB') : '';
const money = (value) => `£${Number(value || 0).toFixed(2)}`;

// Each person (or family) pays monthly items on their own Stripe subscription; staff can stop single items or all of them.
export default function MonthlyPayments({ adminUser, query }) {
  const [state, setState] = useState({ loading: true, subscriptions: [], failed: [], error: '' });
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [message, setMessage] = useState('');

  const request = useCallback(async (path, method = 'GET') => {
    const token = await adminUser.getIdToken(true);
    const response = await fetch(apiUrl(path), { method, headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'The monthly payments request failed.');
    return result;
  }, [adminUser]);

  useEffect(() => {
    let active = true;
    request(`/api/admin/subscriptions?${new URLSearchParams(query)}`)
      .then((result) => active && setState({ loading: false, subscriptions: result.subscriptions, failed: result.failed || [], error: '' }))
      .catch((error) => active && setState({ loading: false, subscriptions: [], failed: [], error: error.message }));
    return () => { active = false; };
  }, [request, query]);

  const cancel = async () => {
    const { subscription, item } = confirming;
    setBusy(`${subscription.id}:${item?.lineId || ''}`);
    setMessage('');
    try {
      const path = item
        ? `/api/admin/subscriptions/${encodeURIComponent(subscription.id)}/items/${encodeURIComponent(item.lineId)}/cancel`
        : `/api/admin/subscriptions/${encodeURIComponent(subscription.id)}/cancel`;
      const result = await request(path, 'POST');
      setState((current) => ({ ...current, subscriptions: current.subscriptions.map((entry) => entry.id === result.subscription.id ? result.subscription : entry) }));
      setMessage(result.cancelledWholeSubscription
        ? `Subscription ${subscription.id} cancelled in Stripe. No further monthly payments will be taken.`
        : `${item.name} removed from subscription ${subscription.id}. The other items carry on at the lower monthly amount.`);
      setConfirming(null);
    } catch (error) {
      setMessage('');
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusy('');
    }
  };

  if (state.loading) return <p className="ReportNotice">Loading monthly payments…</p>;
  if (!state.subscriptions.length && !state.failed.length) return state.error ? <p className="StatusTextError" role="alert">{state.error}</p> : null;
  return (
    <div className="ReportPeople">
      <h4 className="CartItemTitle">Monthly payments</h4>
      {state.error && <p className="StatusTextError" role="alert">{state.error}</p>}
      {message && <p className="StatusText" role="status">{message}</p>}
      {state.failed.map((group) => (
        <p key={group.key} className="StatusTextError" role="alert">
          No monthly subscription could be set up for {group.names.join(', ') || 'one person'}: {group.error} Their first month was paid at checkout; arrange the following payments with them.
        </p>
      ))}
      {state.subscriptions.map((subscription) => (
        <div key={subscription.id} className="SpaceT4">
          <p><strong>{subscription.names.join(', ') || subscription.email}</strong> — <code>{subscription.id}</code> — {subscription.status === 'active' ? `${money(monthlyTotal(subscription))} a month` : `cancelled ${date(subscription.cancelledAt)}`} (order {subscription.orderRef})</p>
          <table className="ReportsTable">
            <thead><tr><th scope="col">Item</th><th scope="col">Monthly</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {subscription.items.map((item) => (
                <tr key={item.lineId}>
                  <td>{item.name}</td>
                  <td>{money(item.monthlyAmount)}</td>
                  <td>{item.status === 'active' ? 'Active' : `Cancelled ${date(item.cancelledAt)}`}</td>
                  <td>{item.status === 'active' && <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={() => setConfirming({ subscription, item })}>Cancel item</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {subscription.status === 'active' && <button className="EditorCommand SpaceT4" type="button" disabled={Boolean(busy)} onClick={() => setConfirming({ subscription })}>Cancel subscription</button>}
        </div>
      ))}
      {confirming && (
        <div className="ReportsRowActions SpaceT4" role="group" aria-label="Confirm cancellation">
          <p className="ReportNotice">
            {confirming.item
              ? `Stop charging ${money(confirming.item.monthlyAmount)} a month for ${confirming.item.name}? This takes effect in Stripe now, with no refund for the current month.`
              : `Cancel every monthly payment on ${confirming.subscription.id}? This takes effect in Stripe now, with no refund for the current month.`}
          </p>
          <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={cancel}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</button>
          <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={() => setConfirming(null)}>Keep paying</button>
        </div>
      )}
    </div>
  );
}
