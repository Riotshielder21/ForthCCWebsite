import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import PurchaseReceipt from '../components/PurchaseReceipt';
import { takeReceiptParams } from '../utils/receiptSession';

export default function PaymentSuccessPage({ onPaymentConfirmed, onReturnToBasket }) {
  const [{ sessionId, receiptToken, expiresAt, expired: savedReceiptExpired }] = useState(takeReceiptParams);
  const [browserExpired, setBrowserExpired] = useState(Boolean(savedReceiptExpired));
  const [status, setStatus] = useState('checking');
  const [receipt, setReceipt] = useState(null);
  const [receiptUnavailable, setReceiptUnavailable] = useState(false);
  const notifiedPaid = useRef(false);

  useEffect(() => {
    if (!expiresAt) return undefined;
    const expire = () => {
      if (Date.now() < expiresAt) return;
      takeReceiptParams();
      setReceipt(null);
      setBrowserExpired(true);
    };
    const timer = setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    window.addEventListener('pageshow', expire);
    document.addEventListener('visibilitychange', expire);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pageshow', expire);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [expiresAt]);

  useEffect(() => {
    if (browserExpired) return undefined;
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
        const response = await apiFetch(apiUrl(`/api/checkout-status?session_id=${encodeURIComponent(sessionId)}`), { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not check payment status.');
        if (!active) return;
        if (result.status === 'paid') {
          setStatus('paid');
          if (!notifiedPaid.current) {
            notifiedPaid.current = true;
            onPaymentConfirmed?.(true);
          }
          if (!receiptToken) {
            setReceiptUnavailable(true);
            return;
          }
          try {
            const receiptResponse = await apiFetch(apiUrl(`/api/checkout-receipt?session_id=${encodeURIComponent(sessionId)}&receipt_token=${encodeURIComponent(receiptToken)}`), { cache: 'no-store' });
            const receiptResult = await receiptResponse.json();
            if (!receiptResponse.ok) throw new Error(receiptResult.error || 'Could not load receipt.');
            if (active) setReceipt(receiptResult);
          } catch {
            if (active) setReceiptUnavailable(true);
          }
          return;
        }
        setStatus(result.status);
        // A bank payment clears over days; the order is placed, so the basket is cleared to stop it being paid twice.
        if (result.status === 'processing' && !notifiedPaid.current) {
          notifiedPaid.current = true;
          onPaymentConfirmed?.(true);
        }
        if (['expired', 'payment_failed', 'failed', 'processing'].includes(result.status)) return;
      } catch {
        if (active) setStatus(attempts < 30 ? 'checking' : 'unavailable');
      }
      if (active && attempts < 30) timer = setTimeout(check, 2000);
      else if (active) setStatus((current) => current === 'checking' ? 'unavailable' : current);
    };
    check();
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, receiptToken, onPaymentConfirmed, browserExpired]);

  if (browserExpired) return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        <h2 className="tile_heading_bold_1">Browser receipt access expired</h2>
        <p className="PageIntroCentered" role="status">For your privacy, this browser only remembers receipt access for one hour. Please use the receipt link in your confirmation email. This does not change your payment or booking.</p>
      </div>
    </div>
  );

  const paid = status === 'paid';
  const failed = status === 'payment_failed' || status === 'failed';
  const expired = status === 'expired';
  const processing = status === 'processing';
  const free = sessionId.startsWith('cs_free_');
  const Icon = paid || processing ? CheckCircle2 : failed || expired || status === 'unavailable' ? AlertCircle : Loader2;
  const title = paid ? (free ? 'Booking confirmed' : 'Payment confirmed') : processing ? 'Payment processing' : failed ? 'Payment not completed' : expired ? 'Checkout expired' : 'Checking payment';
  const message = paid
    ? `${free ? 'Your discounts cover the whole order, so there is nothing to pay and your booking is confirmed.' : 'Your payment is confirmed.'} A copy of this receipt and a secure order link will be sent to ${receipt?.receipt.payerEmail || 'the checkout email address'}.`
    : processing
      ? 'Your order is placed and your bank payment is being processed. Bank payments take a few working days to clear; we will email your receipt when it does, or tell you if it fails. Please do not pay again.'
    : failed
      ? 'Stripe could not complete this payment. Your basket and checkout details are saved; return to your basket to try again or choose another payment method.'
      : expired
        ? 'This checkout session has expired. Your basket and checkout details are saved; return to your basket to start a new checkout.'
        : status === 'unavailable'
          ? 'We could not confirm the payment status yet. Your basket and checkout details are still saved. Check your email for a receipt before trying again; starting a new checkout cancels this one, so you cannot be charged twice.'
          : 'Waiting for Stripe to confirm your payment. Your basket and checkout details are being kept while we check.';

  return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        <div className="ReceiptHeader">
          <Icon className="ReceiptCheckIcon" aria-hidden="true" />
          <h2 className="tile_heading_bold_1">{title}</h2>
          <p className="PageIntroCentered">{message}</p>
        </div>
        {paid && receipt && <PurchaseReceipt receipt={receipt.receipt} />}
        {paid && receiptUnavailable && <p className="text_container SpaceT4 text-center" role="status">The {free ? 'booking' : 'payment'} is confirmed, but the website receipt could not be loaded. Please check your email for its copy.</p>}
        {paid && <p className="text_container SpaceT4 text-center">Please allow a few minutes for the confirmation email to arrive.</p>}
        {(failed || expired) && <div className="text-center"><button className="PrimaryActionButtonCompact SpaceT4" type="button" onClick={onReturnToBasket}>Return to basket</button></div>}
      </div>
    </div>
  );
}