import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import { clubYearLabel } from '../utils/clubYear';
import { subscriptionLineText } from '../utils/renewals';

const readJson = async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) });
const itemText = (item) => `${subscriptionLineText(item)}${item.price !== item.nextPrice ? ` (now ${item.price})` : ''}`;

/**
 * Where the renewal email's subscription buttons lead: /subscription?key=KEY&answer=confirm|cancel, or for Confirm all
 * /subscription?all=KEY&basket=TOKEN. Answers are saved only when the member presses a button here, so a mail scanner
 * opening the link changes nothing. Until 1 March the member can change their answer.
 */
export default function SubscriptionContinuationPage() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  return params.get('all') ? <ConfirmAll params={params} /> : <SubscriptionAnswer params={params} />;
}

function SubscriptionAnswer({ params }) {
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
          {!details.stopped && <p className="text_container">From 1 March, at the new club year's price:</p>}
          <ul className="text_container">{details.items.map((item, index) => <li key={index}>{details.stopped ? `${item.name}: ${item.price}` : itemText(item)}</li>)}</ul>
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

/** Confirm all from a renewal email: signs volunteers up again, confirms the subscriptions, then opens the renewal basket. */
function ConfirmAll({ params }) {
  const key = params.get('all') || '';
  const basket = /^[a-f0-9]{64}$/.test(params.get('basket') || '') ? params.get('basket') : '';
  const [state, setState] = useState({ loading: true, details: null, error: '' });
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState(null);
  const basketUrl = `/membership?renew=${basket}`;

  useEffect(() => {
    apiFetch(apiUrl(`/api/renewal-confirmation/${encodeURIComponent(key)}`), { cache: 'no-store' })
      .then(readJson)
      .then(({ ok, data }) => setState({ loading: false, details: ok ? data : null, error: ok ? '' : data.error || 'This link could not be loaded.' }))
      .catch(() => setState({ loading: false, details: null, error: 'This link could not be loaded. Check your connection and try again.' }));
  }, [key]);

  const confirm = async () => {
    setSaving(true);
    try {
      const { ok, data } = await readJson(await apiFetch(apiUrl(`/api/renewal-confirmation/${encodeURIComponent(key)}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
      if (!ok) throw new Error(data.error || 'That did not work. Please try again.');
      setState((current) => ({ ...current, details: data, error: '' }));
      setProblems(data.problems || []);
      if (!data.problems?.length && basket) window.location.assign(basketUrl);
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setSaving(false);
    }
  };

  const details = state.details;
  const Icon = state.loading || saving ? Loader2 : state.error || problems?.length ? AlertCircle : problems ? CheckCircle2 : AlertCircle;
  return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        <div className="ReceiptHeader">
          <Icon className="ReceiptCheckIcon" aria-hidden="true" />
          <h2 className="tile_heading_bold_1">{details ? `Confirm your renewal for ${clubYearLabel(details.renewalYear)}` : 'Confirm your renewal'}</h2>
          {state.error && <p className="PageIntroCentered" role="alert">{state.error}</p>}
          {problems && <p className="PageIntroCentered" role="status">{problems.length ? 'Some answers could not be saved:' : 'Confirmed.'}</p>}
        </div>
        {problems?.length > 0 && <ul className="text_container">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
        {details && <>
          {details.volunteers.length > 0 && <>
            <h3 className="text_container SpaceT4">Volunteering</h3>
            <ul className="text_container">{details.volunteers.map((volunteer, index) => <li key={index}>{volunteer.renewed
              ? `${volunteer.name}: signed up to volunteer next club year.` : `${volunteer.name}: volunteer again next club year, with the same hours.`}</li>)}</ul>
          </>}
          {details.subscriptions.map((subscription, index) => <React.Fragment key={index}>
            <h3 className="text_container SpaceT4">Subscription</h3>
            <p className="text_container">{subscription.stopped ? 'These payments have already stopped.'
              : subscription.status === 'cancelled' ? 'Cancelled: it stops at the end of February. Confirm all leaves it cancelled; to keep it after all, use its own Confirm button in your email.'
                : `${subscription.status === 'confirmed' ? 'Confirmed: it carries' : 'It carries'} on from 1 March, at the new club year's price:`}</p>
            {!subscription.stopped && subscription.status !== 'cancelled'
              && <ul className="text_container">{subscription.items.map((item, line) => <li key={line}>{itemText(item)}</li>)}</ul>}
          </React.Fragment>)}
          {basket && <p className="text_container SpaceT4">Then your basket opens, to pay for next year's membership and services.</p>}
          <div className="text-center SpaceT4">
            {!problems && <button className="ConfirmActionButton" type="button" disabled={saving} onClick={confirm}>
              {saving ? 'Saving…' : basket ? 'Confirm all and go to the basket' : 'Confirm all'}</button>}
            {problems?.length > 0 && basket && <a className="ConfirmActionButton" href={basketUrl}>Go to the basket</a>}
          </div>
        </>}
      </div>
    </div>
  );
}
