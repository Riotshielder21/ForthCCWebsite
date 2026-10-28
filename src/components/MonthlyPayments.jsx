import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';
import { monthlyTotal, activeSubscriptionItems } from '../utils/subscriptions';

const date = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB') : '';
const money = (value) => `£${Number(value || 0).toFixed(2)}`;

// A payer has one subscription (one direct debit) covering everyone they pay for; staff stop single items or
// everything one member receives, and the payer's debit drops by that amount.
export default function MonthlyPayments({ adminUser, query }) {
  const [state, setState] = useState({ loading: true, subscriptions: [], failed: [], error: '' });
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [message, setMessage] = useState('');
  const [volunteerCancellable, setVolunteerCancellable] = useState([]);
  const membershipId = new URLSearchParams(query).get('membershipId') || '';

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
      .then((result) => {
        if (!active) return;
        setVolunteerCancellable(result.volunteerCancellableLineIds || []);
        setState({ loading: false, subscriptions: result.subscriptions, failed: result.failed || [], error: '' });
      })
      .catch((error) => active && setState({ loading: false, subscriptions: [], failed: [], error: error.message }));
    return () => { active = false; };
  }, [request, query]);

  const cancel = async () => {
    const { subscription, path, done } = confirming;
    setBusy(subscription.id);
    setMessage('');
    try {
      const result = await request(`/api/admin/subscriptions/${encodeURIComponent(subscription.id)}/${path}`, 'POST');
      setState((current) => ({ ...current, subscriptions: current.subscriptions.map((entry) => entry.id === result.subscription.id ? result.subscription : entry) }));
      setMessage(result.cancelScheduledAt ? `Cancellation scheduled for ${date(result.cancelScheduledAt)}. No refund or other payment changes.`
        : result.cancelledWholeSubscription
        ? `Subscription ${subscription.id} cancelled in Stripe. Nothing was left on it, so no further payments will be taken.`
        : `${done} The payer now pays ${money(monthlyTotal(result.subscription))} a month for everything else.`);
      setConfirming(null);
    } catch (error) {
      setMessage('');
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusy('');
    }
  };

  const ask = (subscription, items, path, done) => setConfirming({ subscription, path, done,
    text: `Stop ${money(items.reduce((sum, item) => sum + Number(item.monthlyAmount || 0), 0))} a month for ${items.map((item) => `${item.name}${item.names?.length ? ` (${item.names.join(', ')})` : ''}`).join(', ')} on ${subscription.email}'s subscription ${subscription.id}? This takes effect in Stripe now, with no refund for the current month.${items.length === activeSubscriptionItems(subscription).length ? ' Nothing else is on it, so the whole subscription is cancelled.' : ' Everything else on it carries on.'}` });

  if (state.loading) return <p className="ReportNotice">Loading monthly payments…</p>;
  if (!state.subscriptions.length && !state.failed.length) return state.error ? <p className="StatusTextError" role="alert">{state.error}</p> : null;
  return (
    <div className="ReportPeople">
      <h4 className="CartItemTitle">Monthly payments</h4>
      {state.error && <p className="StatusTextError" role="alert">{state.error}</p>}
      {message && <p className="StatusText" role="status">{message}</p>}
      {state.failed.map((group) => (
        <p key={group.key} className="StatusTextError" role="alert">
          {(group.itemNames || []).join(', ') || 'The monthly items'}{group.names?.length ? ` (${group.names.join(', ')})` : ''} could not be added to the payer's monthly payments: {group.error} The first payment was taken at checkout; arrange the following payments with them.
        </p>
      ))}
      {state.subscriptions.map((subscription) => {
        const memberItems = membershipId ? activeSubscriptionItems(subscription).filter((item) => (item.membershipIds || []).includes(membershipId)) : [];
        return (
          <div key={subscription.id} className="SpaceT4">
            <p className="ReportNotice">
              <code>{subscription.id}</code>, paid by {subscription.email}: {subscription.status === 'active' ? `${money(monthlyTotal(subscription))} a month` : `cancelled ${date(subscription.cancelledAt)}`}
            </p>
            <table className="ReportsTable">
              <thead><tr><th scope="col">Member</th><th scope="col">Item</th><th scope="col">Order</th><th scope="col">Monthly</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {subscription.items.map((item) => (
                  <tr key={item.lineId}>
                    <td>{(item.names || []).join(', ') || '—'}</td>
                    <td>{item.name}</td>
                    <td>{item.orderRef || subscription.orderRef}</td>
                    <td>{money(item.monthlyAmount)}</td>
                    <td>{item.cancelScheduledAt ? `Stops ${date(item.cancelScheduledAt)}` : item.status === 'active' ? 'Active' : `Cancelled ${date(item.cancelledAt)}`}</td>
                    <td>{item.status === 'active' && <button className="EditorCommand" type="button" disabled={Boolean(busy)}
                      onClick={() => ask(subscription, [item], `items/${encodeURIComponent(item.lineId)}/cancel`, `${item.name} removed from subscription ${subscription.id}.`)}>Cancel item</button>}
                      {membershipId && volunteerCancellable.includes(item.lineId) && !item.cancelScheduledAt && <button className="EditorCommand" type="button" disabled={Boolean(busy)}
                        onClick={() => setConfirming({ subscription, path: `items/${encodeURIComponent(item.lineId)}/volunteer-cancel`,
                          text: `Schedule ${item.name} to stop at the end of its paid period, only if every holder qualifies for it as a free volunteer benefit? No refund. Other items and payments are preserved.` })}>Schedule cancellation of free volunteer benefit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {subscription.status === 'active' && (
              <div className="ReportsRowActions">
                {memberItems.length > 0 && <button className="EditorCommand" type="button" disabled={Boolean(busy)}
                  onClick={() => ask(subscription, memberItems, `members/${encodeURIComponent(membershipId)}/cancel`, `This member's items were removed from subscription ${subscription.id}.`)}>Cancel this member's items</button>}
                <button className="EditorCommand" type="button" disabled={Boolean(busy)}
                  onClick={() => ask(subscription, activeSubscriptionItems(subscription), 'cancel', '')}>Cancel whole subscription</button>
              </div>
            )}
          </div>
        );
      })}
      {confirming && (
        <div className="ReportsRowActions SpaceT4" role="group" aria-label="Confirm cancellation">
          <p className="ReportNotice">{confirming.text}</p>
          <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={cancel}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</button>
          <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={() => setConfirming(null)}>Keep paying</button>
        </div>
      )}
    </div>
  );
}
