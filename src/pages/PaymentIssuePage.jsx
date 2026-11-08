import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';

const readJson = async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) });
const dateText = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : '';

/**
 * Where a failed-payment email's links lead: /payment-issue?order=KEY for a one-off bank payment that did not clear,
 * /payment-issue?subscription=KEY for monthly payments Stripe stopped. Paying again goes through the basket and
 * checkout; cancelling needs a button press, so a mail scanner opening the link changes nothing.
 */
export default function PaymentIssuePage() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const orderKey = params.get('order') || '';
  const subscriptionKey = params.get('subscription') || '';
  const monthly = Boolean(subscriptionKey);
  const key = subscriptionKey || orderKey;
  const [state, setState] = useState({ loading: true, details: null, error: '', code: '' });
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [cancelError, setCancelError] = useState('');

  useEffect(() => {
    if (!key) {
      setState({ loading: false, details: null, error: 'This link is not complete. Use the link in your email.', code: '' });
      return;
    }
    const path = monthly ? `/api/subscriptions/${encodeURIComponent(key)}/restart` : `/api/orders/${encodeURIComponent(key)}/retry`;
    apiFetch(apiUrl(path), { cache: 'no-store' })
      .then(readJson)
      .then(({ ok, data }) => setState({ loading: false, details: data, error: ok ? '' : data.error || 'This link could not be loaded.', code: ok ? '' : data.code || '' }))
      .catch(() => setState({ loading: false, details: null, error: 'This link could not be loaded. Check your connection and try again.', code: '' }));
  }, [key, monthly]);

  const cancel = async () => {
    setCancelling(true);
    setCancelError('');
    try {
      const path = monthly ? `/api/subscriptions/${encodeURIComponent(key)}/cancel` : `/api/orders/${encodeURIComponent(key)}/cancel`;
      const { ok, data } = await readJson(await apiFetch(apiUrl(path), { method: 'POST' }));
      if (!ok) throw new Error(data.error || 'That did not work. Please try again.');
      setCancelled(true);
    } catch (error) {
      setCancelError(error.message);
    } finally {
      setCancelling(false);
    }
  };

  const details = state.details || {};
  const what = (details.itemNames || []).join(', ');
  const done = cancelled || ['order_cancelled', 'payments_cancelled'].includes(state.code);
  const usable = !state.loading && !state.error && !done;
  const Icon = state.loading ? Loader2 : done ? CheckCircle2 : AlertCircle;
  const title = state.loading ? 'Loading…'
    : done ? (monthly ? 'Monthly payments stopped' : 'Order cancelled')
      : monthly ? 'Your monthly payments have stopped' : 'Your payment did not go through';
  const message = state.loading ? ''
    : done ? (monthly
      ? 'Thank you for letting us know. Nothing more will be taken. To join again later, add what you need to your basket.'
      : `Order ${details.orderRef || ''} is cancelled and nothing was taken. To buy again later, add what you need to your basket.`)
      : state.error
        || (monthly
          ? `Stripe could not collect the monthly payments for ${what || 'your items'}${details.names?.length ? ` (${details.names.join(', ')})` : ''}, so they have stopped.${details.paidUntil ? ` What was paid for ran until ${dateText(details.paidUntil)}.` : ''} Restart them with a new checkout (missed months are not charged), or confirm you are stopping.`
          : `The bank payment for ${what || 'your order'} (order ${details.orderRef || ''}) did not clear, so nothing was taken. Pay again with the same details, or cancel the order.`);

  return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        <div className="ReceiptHeader">
          <Icon className="ReceiptCheckIcon" aria-hidden="true" />
          <h2 className="tile_heading_bold_1">{title}</h2>
          {message && <p className="PageIntroCentered" role="status">{message}</p>}
        </div>
        {usable && (
          <div className="text-center">
            <a className="PrimaryActionButtonCompact SpaceT4" href={`/membership?${monthly ? 'restart' : 'retry'}=${encodeURIComponent(key)}`}>
              {monthly ? 'Restart monthly payments' : 'Retry payment'}
            </a>
            <p className="text_container SpaceT4">
              <button className="ContentLink" type="button" onClick={cancel} disabled={cancelling}>
                {cancelling ? 'Saving…' : monthly ? 'I do not want to continue' : 'Cancel this order'}
              </button>
            </p>
            {cancelError && <p className="text_container text-red-500" role="alert">{cancelError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
