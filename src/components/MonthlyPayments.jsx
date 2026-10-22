import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';
import { monthlyTotal } from '../utils/subscriptions';

const date = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB') : '';
const money = (value) => `£${Number(value || 0).toFixed(2)}`;

// Each monthly item is its own Stripe subscription (a separate direct debit), so staff cancel them one at a time.
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
    const { subscription } = confirming;
    setBusy(subscription.id);
    setMessage('');
    try {
      const result = await request(`/api/admin/subscriptions/${encodeURIComponent(subscription.id)}/cancel`, 'POST');
      setState((current) => ({ ...current, subscriptions: current.subscriptions.map((entry) => entry.id === result.subscription.id ? result.subscription : entry) }));
      setMessage(`Subscription ${subscription.id} cancelled in Stripe. No further payments will be taken for it; other monthly payments carry on.`);
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
          No monthly subscription could be set up for {(group.itemNames || []).join(', ') || 'an item'}{group.names.length ? ` (${group.names.join(', ')})` : ''}: {group.error} The first month was paid at checkout; arrange the following payments with them.
        </p>
      ))}
      {state.subscriptions.length > 0 && (
        <table className="ReportsTable">
          <thead><tr><th scope="col">Person</th><th scope="col">Item</th><th scope="col">Stripe subscription</th><th scope="col">Order</th><th scope="col">Monthly</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {state.subscriptions.map((subscription) => (
              <tr key={subscription.id}>
                <td>{subscription.names.join(', ') || subscription.email}</td>
                <td>{subscription.items.map((item) => item.name).join(', ')}</td>
                <td><code>{subscription.id}</code></td>
                <td>{subscription.orderRef}</td>
                <td>{money(subscription.status === 'active' ? monthlyTotal(subscription) : subscription.items.reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0))}</td>
                <td>{subscription.status === 'active' ? 'Active' : `Cancelled ${date(subscription.cancelledAt)}`}</td>
                <td>{subscription.status === 'active' && <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={() => setConfirming({ subscription })}>Cancel</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirming && (
        <div className="ReportsRowActions SpaceT4" role="group" aria-label="Confirm cancellation">
          <p className="ReportNotice">
            {`Stop the ${money(monthlyTotal(confirming.subscription))} monthly direct debit for ${confirming.subscription.items.map((item) => item.name).join(', ')} (${confirming.subscription.id})? This cancels it in Stripe now, with no refund for the current month. Other monthly payments carry on.`}
          </p>
          <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={cancel}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</button>
          <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={() => setConfirming(null)}>Keep paying</button>
        </div>
      )}
    </div>
  );
}
