import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { apiUrl } from '../utils/api';

const RECEIPT_KEY = 'fcc-payment-receipt';

// The receipt token is moved out of the address bar (history, bookmarks, screenshots) into this tab's storage.
const takeReceiptParams = () => {
  const query = new URLSearchParams(window.location.search);
  let stored = {};
  try { stored = JSON.parse(window.sessionStorage.getItem(RECEIPT_KEY) || '{}'); } catch { /* ignore */ }
  const params = { sessionId: query.get('session_id') || stored.sessionId || '', receiptToken: query.get('receipt_token') || stored.receiptToken || '' };
  if (query.has('receipt_token') || query.has('session_id')) {
    try { window.sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(params)); } catch { /* storage may be disabled */ }
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }
  return params;
};

export default function PaymentSuccessPage({ onPaymentConfirmed, onReturnToBasket }) {
  const [{ sessionId, receiptToken }] = useState(takeReceiptParams);
  const [status, setStatus] = useState('checking');
  const [receipt, setReceipt] = useState(null);
  const [receiptUnavailable, setReceiptUnavailable] = useState(false);
  const notifiedPaid = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      setStatus('unavailable');
      return undefined;
    }
    let active = true;
    let attempts = 0;
    let timer;
    const check = async () => {
      attempts += 1;
      try {
        const response = await fetch(apiUrl(`/api/checkout-status?session_id=${encodeURIComponent(sessionId)}`), { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not check payment status.');
        if (!active) return;
        if (result.status === 'paid') {
          setStatus('paid');
          if (!notifiedPaid.current) {
            notifiedPaid.current = true;
            onPaymentConfirmed(true);
          }
          if (!receiptToken) {
            setReceiptUnavailable(true);
            return;
          }
          try {
            const receiptResponse = await fetch(apiUrl(`/api/checkout-receipt?session_id=${encodeURIComponent(sessionId)}&receipt_token=${encodeURIComponent(receiptToken)}`), { cache: 'no-store' });
            const receiptResult = await receiptResponse.json();
            if (!receiptResponse.ok) throw new Error(receiptResult.error || 'Could not load receipt.');
            if (active) setReceipt(receiptResult);
          } catch {
            if (active) setReceiptUnavailable(true);
          }
          return;
        }
        setStatus(result.status);
        if (['expired', 'payment_failed'].includes(result.status)) return;
      } catch {
        if (active) setStatus(attempts < 30 ? 'checking' : 'unavailable');
      }
      if (active && attempts < 30) timer = setTimeout(check, 2000);
      else if (active) setStatus((current) => current === 'checking' ? 'unavailable' : current);
    };
    check();
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, receiptToken, onPaymentConfirmed]);

  const paid = status === 'paid';
  const failed = status === 'payment_failed';
  const expired = status === 'expired';
  const Icon = paid ? CheckCircle2 : failed || expired || status === 'unavailable' ? AlertCircle : Loader2;
  const title = paid ? 'Payment confirmed' : failed ? 'Payment not completed' : expired ? 'Checkout expired' : 'Checking payment';
  const message = paid
    ? `Your payment is confirmed. A copy of this receipt and a secure order link will be sent to ${receipt?.receipt.payerEmail || 'the checkout email address'}.`
    : failed
      ? 'Stripe could not complete this payment. Your basket and checkout details are saved; return to your basket to try again or choose another payment method.'
      : expired
        ? 'This checkout session has expired. Your basket and checkout details are saved; return to your basket to start a new checkout.'
        : status === 'unavailable'
          ? 'We could not confirm the payment status yet. Your basket and checkout details are still saved. Check your email before trying again.'
          : 'Waiting for Stripe to confirm your payment. Your basket and checkout details are being kept while we check.';

  return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        <div className="main_tile text-center">
          <Icon className="ReceiptCheckIcon" aria-hidden="true" />
          <h2 className="tile_heading_bold_1">{title}</h2>
          <p className="text_container">{message}</p>
          {paid && receipt && <section className="ReceiptCard ReceiptEmailCopy" aria-label="Purchase receipt">
            <pre>{receipt.copy}</pre>
          </section>}
          {paid && receiptUnavailable && <p className="text_container SpaceT4" role="status">The payment is confirmed, but the website receipt could not be loaded. Please check your email for its copy.</p>}
          {paid && <p className="text_container SpaceT4">Please allow a few minutes for the confirmation email to arrive.</p>}
          {(failed || expired) && <button className="PrimaryActionButtonCompact SpaceT4" type="button" onClick={onReturnToBasket}>Return to basket</button>}
        </div>
      </div>
    </div>
  );
}