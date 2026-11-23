import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import { clubYearLabel } from '../utils/clubYear';

const readJson = async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) });

/**
 * Where the continue/cancel email's buttons lead: /subscription?key=KEY&answer=confirm|cancel. The answer is saved
 * only when the member presses a button here, so a mail scanner opening the link changes nothing. Until 1 March the
 * member can change their answer.
 */
export default function SubscriptionContinuationPage() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const key = params.get('key') || '';
  const asked = params.get('answer') === 'cancel' ? 'cancel' : 'confirm';
  const [state, setState] = useState({ loading: true, details: null, error: '' });
  const [saving, setSaving] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!key) {
      setState({ loading: false, details: null, error: 'This link is not complete. Use the link in your email.' });
      return;
    }
    apiFetch(apiUrl(`/api/subscription-continuation/${encodeURIComponent(key)}`), { cache: 'no-store' })
      .then(readJson)
      .then(({ ok, data }) => setState({ loading: false, details: ok ? data : null, error: ok ? '' : data.error || 'This link could not be loaded.' }))
      .catch(() => setState({ loading: false, details: null, error: 'This link could not be loaded. Check your connection and try again.' }));
  }, [key]);

  const answer = async (choice) => {
    setSaving(choice);
    setSaveError('');
    try {
      const { ok, data } = await readJson(await apiFetch(apiUrl(`/api/subscription-continuation/${encodeURIComponent(key)}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: choice }) }));
      if (!ok) throw new Error(data.error || 'That did not work. Please try again.');
      setState((current) => ({ ...current, details: data }));
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving('');
    }
  };

  const details = state.details;
  const answered = details && details.status !== 'unconfirmed';
  const Icon = state.loading ? Loader2 : state.error ? AlertCircle : answered ? CheckCircle2 : AlertCircle;
  const title = state.loading ? 'Loading…' : state.error ? 'Your subscription'
    : `Your subscription for ${clubYearLabel(details.renewalYear)}`;
  const confirmButton = <button className="ConfirmActionButton" type="button" disabled={Boolean(saving) || details?.status === 'confirmed'} onClick={() => answer('confirm')}>
    {saving === 'confirm' ? 'Saving…' : 'Confirm: keep my subscription'}</button>;
  const cancelButton = <button className="CancelActionButton" type="button" disabled={Boolean(saving) || details?.status === 'cancelled'} onClick={() => answer('cancel')}>
    {saving === 'cancel' ? 'Saving…' : 'Cancel at the end of February'}</button>;

  return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        <div className="ReceiptHeader">
          <Icon className="ReceiptCheckIcon" aria-hidden="true" />
          <h2 className="tile_heading_bold_1">{title}</h2>
          {state.error && <p className="PageIntroCentered" role="alert">{state.error}</p>}
          {details && <p className="PageIntroCentered" role="status">{details.stopped ? 'These payments have already stopped.' : details.message}</p>}
        </div>
        {details && <>
          <ul className="text_container">{details.items.map((item, index) => <li key={index}>{item.name}{item.names.length ? ` (${item.names.join(', ')})` : ''}: {item.price}</li>)}</ul>
          {details.open ? <div className="text-center SpaceT4">
            <p className="text_container">Press a button to save your answer. You can change it until 1 March. Cancelling stops the payments from 1 March; payments already taken are not refunded.</p>
            <div className="ContinuationActions SpaceT4">
              {asked === 'cancel' ? <>{cancelButton}{confirmButton}</> : <>{confirmButton}{cancelButton}</>}
            </div>
            {saveError && <p className="text_container text-red-500" role="alert">{saveError}</p>}
          </div> : !details.stopped && <p className="text_container SpaceT4">Answers closed on 1 March. To stop your subscription now, use My details or email the club.</p>}
        </>}
      </div>
    </div>
  );
}
