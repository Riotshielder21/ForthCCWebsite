import React, { useEffect, useState } from 'react';
import { loadEmailSession, clearEmailSession, sessionRequest } from '../utils/emailSession';
import { validateDetailsUpdate } from '../utils/myDetails';
import { PHOTO_CONSENT_TEXT } from '../utils/checkout';
import { checkoutWording } from '../utils/consents';
import EmailCodeSignIn from '../components/EmailCodeSignIn';
import PurchaseReceipt from '../components/PurchaseReceipt';

const formFor = (household) => ({
  phone: household.phone, address: household.address, postcode: household.postcode,
  emergencyContact: household.emergencyContact ? { ...household.emergencyContact } : null
});

/** Each person's photo and video consent, saved as soon as it changes. JustGo households answer here too. */
function PhotoConsentChoices({ household, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const change = (person) => async (event) => {
    const accepted = event.target.checked;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await sessionRequest('details', `/api/my-details/${encodeURIComponent(household.id)}/photo-consent/${encodeURIComponent(person.memberId)}`,
        { method: 'PUT', body: { accepted, wording: checkoutWording() } });
      onSaved(result.household);
      setMessage(`${person.firstName} ${person.lastName}: photo and video consent ${accepted ? 'given' : 'withdrawn'}.`);
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  };
  return <fieldset className="CheckoutFieldset SpaceT4">
    <legend>{PHOTO_CONSENT_TEXT}</legend>
    <p className="text_container">Optional. See the <a href="/notices">club notices</a> for how photos and videos are used.</p>
    {household.people.map((person) => <label key={person.memberId} className="CheckoutCheck">
      <input type="checkbox" checked={person.photoConsent === true} disabled={busy} onChange={change(person)} />
      {' '}{person.firstName} {person.lastName}{person.junior ? ' (under 18)' : ''}{person.photoConsent === null ? ' (not answered yet)' : ''}
    </label>)}
    {error && <p className="StatusTextError" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </fieldset>;
}

function HouseholdEditor({ household, onSaved, onEmailChanged }) {
  const [form, setForm] = useState(() => formFor(household));
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path = `/api/my-details/${encodeURIComponent(household.id)}`;

  const run = (action) => async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (actionError) { setError(actionError.message); } finally { setBusy(false); }
  };
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const setContact = (field) => (event) => setForm({ ...form, emergencyContact: { ...form.emergencyContact, [field]: event.target.value } });

  const save = run(async () => {
    const validation = validateDetailsUpdate(form, household);
    if (validation.error) throw new Error(validation.error);
    const result = await sessionRequest('details', path, { method: 'PATCH', body: form });
    setMessage(result.changed.length ? 'Your details have been saved.' : 'No changes to save.');
    onSaved(result.household);
  });
  const sendEmailCode = run(async () => {
    const result = await sessionRequest('details', `${path}/email`, { method: 'POST', body: { newEmail } });
    setCodeSent(true); setMessage(result.message);
  });
  const confirmEmail = run(async () => {
    const result = await sessionRequest('details', `${path}/email/confirm`, { method: 'POST', body: { newEmail, code } });
    onEmailChanged(result.message);
  });

  return <section className="main_tile SpaceT4">
    <h3 className="tile_heading_bold_2">{household.contactName || 'Your household'}</h3>
    <ul className="text_container">{household.people.map((person) => <li key={person.memberId}>
      {person.firstName} {person.lastName} ({person.memberId}) · {person.membership}
    </li>)}</ul>
    <PhotoConsentChoices household={household} onSaved={onSaved} />
    {household.justgo ? <p className="text_container">This membership is managed in JustGo. Please update your details in JustGo; changes reach the club at the next sync.</p> : <>
      <form className="FormContainer FormBody" onSubmit={save}>
        <label className="FormLabel">Phone<input className="FormInput" type="tel" autoComplete="tel" maxLength="40" required value={form.phone} onChange={set('phone')} /></label>
        <label className="FormLabel">Address<input className="FormInput" autoComplete="street-address" maxLength="300" required value={form.address} onChange={set('address')} /></label>
        <label className="FormLabel">Postcode<input className="FormInput" autoComplete="postal-code" maxLength="12" required value={form.postcode} onChange={set('postcode')} /></label>
        {form.emergencyContact ? <>
          <label className="FormLabel">Emergency contact name<input className="FormInput" maxLength="120" required value={form.emergencyContact.name} onChange={setContact('name')} /></label>
          <label className="FormLabel">Emergency contact relationship<input className="FormInput" maxLength="60" required value={form.emergencyContact.relationship} onChange={setContact('relationship')} /></label>
          <label className="FormLabel">Emergency contact phone<input className="FormInput" type="tel" maxLength="40" required value={form.emergencyContact.phone} onChange={setContact('phone')} /></label>
        </> : <p className="text_container">The parent/guardian above is the emergency contact.</p>}
        <button className="FormSubmitButton" type="submit" disabled={busy}>Save details</button>
      </form>
      <form className="FormContainer FormBody SpaceT4" onSubmit={codeSent ? confirmEmail : sendEmailCode}>
        <p className="text_container">Contact email: <strong>{household.email}</strong>. To change it, we send a code to the new address.</p>
        <label className="FormLabel">New email address
          <input className="FormInput" type="email" autoComplete="email" maxLength="254" required disabled={codeSent} value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
        </label>
        {codeSent && <label className="FormLabel">Code sent to the new address
          <input className="FormInput" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
        </label>}
        <div className="SpaceY2">
          <button className="FormSubmitButton" type="submit" disabled={busy}>{codeSent ? 'Confirm new email' : 'Send code to new email'}</button>
          {codeSent && <button className="EditorCommand" type="button" disabled={busy} onClick={() => { setCodeSent(false); setCode(''); }}>Change address</button>}
        </div>
      </form>
    </>}
    {error && <p className="StatusTextError" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

function MonthlyPayment({ subscription, onRequested }) {
  const [chosen, setChosen] = useState([]);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestable = subscription.items.filter((item) => !item.cancelRequested);
  const toggle = (key) => setChosen((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await sessionRequest('details', `/api/my-details/monthly/${encodeURIComponent(subscription.subscriptionId)}/cancel-request`,
        { method: 'POST', body: { itemKeys: chosen, reason } });
      setMessage(result.message); setOpen(false); onRequested(subscription.subscriptionId, chosen); setChosen([]); setReason('');
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };
  return <section className="main_tile SpaceT4">
    {!subscription.paidByYou && <p className="text_container">Paid by someone else for people in your household.</p>}
    <ul className="text_container">{subscription.items.map((item) => <li key={item.key}>
      {item.name}{item.names.length ? ` for ${item.names.join(', ')}` : ''} · £{item.monthlyAmount.toFixed(2)} a month
      {item.cancelRequested && <strong> · Cancellation requested</strong>}
    </li>)}</ul>
    {requestable.length > 0 && !open && <button className="EditorCommand" type="button" onClick={() => { setOpen(true); setMessage(''); setChosen(requestable.map((item) => item.key)); }}>Request cancellation</button>}
    {open && <form className="FormContainer FormBody" onSubmit={submit}>
      <p className="text_container">Choose what to stop. The club makes the change and emails you to confirm; payments continue until then.</p>
      {requestable.map((item) => <label key={item.key} className="FormLabel">
        <input type="checkbox" checked={chosen.includes(item.key)} onChange={() => toggle(item.key)} /> {item.name}{item.names.length ? ` for ${item.names.join(', ')}` : ''}
      </label>)}
      <label className="FormLabel">Reason (optional)<textarea className="FormInput" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="SpaceY2">
        <button className="FormSubmitButton" type="submit" disabled={busy || !chosen.length}>Send request</button>
        <button className="EditorCommand" type="button" disabled={busy} onClick={() => setOpen(false)}>Keep paying</button>
      </div>
    </form>}
    {error && <p className="StatusTextError" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export default function MyDetailsPage() {
  const [session, setSession] = useState(() => loadEmailSession('details'));
  const [households, setHouseholds] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    sessionRequest('details', '/api/my-details').then((result) => { setHouseholds(result.households); setPurchases(result.purchases || []); setMonthly(result.monthlyPayments || []); }).catch((loadError) => {
      if (loadError.sessionExpired) setSession(null);
      setError(loadError.message);
    });
  }, [session]);

  const signOut = (message = '') => { clearEmailSession('details'); setSession(null); setHouseholds(null); setPurchases([]); setMonthly([]); setNotice(message); };

  return <div className="SectionContent PageFadeIn">
    <h2 className="page_heading_bold_1">My details</h2>
    {notice && <p role="status">{notice}</p>}
    {!session ? <EmailCodeSignIn purpose="details" askDob onVerified={(verified) => { setNotice(''); setError(''); setSession(verified); }}
      intro="See your current purchases, ask to stop monthly payments, give or withdraw photo and video consent, and update the phone number, address, emergency contact or email address we hold for your membership. Enter the email you joined or bought with and your date of birth, and we will send you a 6-digit code. Booking for a child or family member? Use their date of birth instead. Name and date of birth changes: contact secretary@forthcanoeclub.co.uk." />
      : <>
        <p className="text_container">Signed in as {session.email}. <button className="EditorCommand" type="button" onClick={() => signOut()}>Sign out</button></p>
        {error && <p className="StatusTextError" role="alert">{error}</p>}
        {households?.map((household) => <HouseholdEditor key={household.id} household={household}
          onSaved={(saved) => setHouseholds((current) => current.map((entry) => entry.id === saved.id ? saved : entry))}
          onEmailChanged={signOut} />)}
        {monthly.length > 0 && <section className="SpaceT4">
          <h3 className="tile_heading_bold_1">Monthly payments</h3>
          {monthly.map((subscription) => <MonthlyPayment key={subscription.subscriptionId} subscription={subscription}
            onRequested={(id, keys) => setMonthly((current) => current.map((entry) => entry.subscriptionId !== id ? entry
              : { ...entry, items: entry.items.map((item) => keys.includes(item.key) ? { ...item, cancelRequested: true } : item) }))} />)}
        </section>}
        {households && <section className="SpaceT4">
          <h3 className="tile_heading_bold_1">Current purchases</h3>
          {purchases.length ? purchases.map((order) => <PurchaseReceipt key={order.orderRef} order={order} />)
            : <p className="text_container">No purchases with this email since renewals opened for this club year.</p>}
        </section>}
      </>}
  </div>;
}
