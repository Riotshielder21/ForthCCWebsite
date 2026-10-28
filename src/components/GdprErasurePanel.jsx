import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldX, X } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { sharedDetailsErrors } from '../utils/erasure';

const EMPTY_LOOKUP = { email: '', firstName: '', lastName: '', dob: '', affiliationNumber: '' };
const EMPTY_SHARED = { contactName: '', contactRelationship: 'Parent', phone: '', email: '', address: '', postcode: '', emergencyName: '', emergencyPhone: '', emergencyRelationship: '' };
const SHARED_FIELDS = [['contactName', 'Contact name'], ['contactRelationship', 'Relationship to the children'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['postcode', 'Postcode'],
  ['emergencyName', 'Emergency contact name'], ['emergencyPhone', 'Emergency contact phone'], ['emergencyRelationship', 'Emergency contact relationship']];

/**
 * GDPR erasure for one person (from the member register) or anyone found by email, name and date of birth, which also
 * reaches records that were already deleted. Shows exactly what will happen before anything is erased.
 */
export default function GdprErasurePanel({ adminUser, start, onClose, onErased }) {
  const [lookup, setLookup] = useState(EMPTY_LOOKUP);
  const [query, setQuery] = useState(start.membershipId ? { membershipId: start.membershipId } : null);
  const [scope, setScope] = useState('');
  const [preview, setPreview] = useState(null);
  const [shared, setShared] = useState(EMPTY_SHARED);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const closeButton = useRef(null);

  const post = useCallback(async (path, body) => {
    const token = await adminUser.getIdToken(true);
    const response = await fetch(apiUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { data });
    return data;
  }, [adminUser]);

  useEffect(() => {
    if (!query) return undefined;
    let active = true;
    setBusy(true);
    setError('');
    post('/api/admin/gdpr/preview', { ...query, scope: scope || 'person' })
      .then((data) => { if (active) setPreview(data); })
      .catch((previewError) => { if (active) { setPreview(null); setError(previewError.message); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [query, scope, post]);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const hasFamily = preview?.family.length > 1;
  const adultsErased = preview?.people.some((person) => !person.junior);
  const needsShared = scope === 'person' && preview?.remaining.length > 0 && adultsErased;
  const sharedProblems = needsShared ? sharedDetailsErrors(shared) : [];
  const nothingFound = preview && !preview.people.length && !preview.deletedRecords.length;
  const familyChoiceMissing = hasFamily && !scope;
  const ready = preview && !nothingFound && !familyChoiceMissing && !sharedProblems.length && confirmation === 'ERASE' && !busy;

  const submit = async (event) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const data = await post('/api/admin/gdpr/erase', { ...query, scope: scope || 'person', confirm: 'ERASE', ...(scope === 'person' && preview.remaining.length ? { sharedDetails: shared } : {}) });
      setResult(data);
      onErased?.();
    } catch (eraseError) {
      setError(eraseError.message);
    } finally {
      setBusy(false);
    }
  };

  const lookupChange = (key) => (event) => setLookup((current) => ({ ...current, [key]: event.target.value }));
  const sharedChange = (key) => (event) => setShared((current) => ({ ...current, [key]: event.target.value }));

  return <div className="ReportsModalBackdrop"><section className="ReportsDialog" role="dialog" aria-modal="true" aria-labelledby="gdpr-title">
    <div className="AdminListHeader"><h3 id="gdpr-title" className="tile_heading_bold_1"><ShieldX size={22} /> GDPR erasure</h3>
      <button ref={closeButton} type="button" className="EditorIconButton" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button></div>

    {result ? <>
      <p className="StatusText StatusTextSuccess" role="status">Erased {result.erased} member {result.erased === 1 ? 'record' : 'records'}, redacted {result.ordersRedacted} {result.ordersRedacted === 1 ? 'order' : 'orders'},
        cancelled {result.subscriptionsCancelled} Stripe {result.subscriptionsCancelled === 1 ? 'subscription' : 'subscriptions'} and purged {result.earlierDeletionsPurged} earlier deleted {result.earlierDeletionsPurged === 1 ? 'record' : 'records'}.</p>
      <p className="ReportNotice">Still to do by hand:</p>
      <ul className="ReportItems">{[...result.warnings, ...result.manual].map((step) => <li key={step}>{step}</li>)}</ul>
      <button className="EditorCommand" type="button" onClick={onClose}>Close</button>
    </> : <>
      {!start.membershipId && <form className="CheckoutDetails" onSubmit={(event) => { event.preventDefault(); setScope(''); setConfirmation(''); setQuery({ ...lookup, affiliationNumber: lookup.affiliationNumber || undefined }); }}>
        <p className="ReportNotice">Find the person by email, name and date of birth. This also finds records that were deleted earlier. The membership number is optional.</p>
        <div className="CheckoutGrid">
          <label className="FormLabel">Email<input className="FormInput" type="email" required value={lookup.email} onChange={lookupChange('email')} /></label>
          <label className="FormLabel">First name<input className="FormInput" required value={lookup.firstName} onChange={lookupChange('firstName')} /></label>
          <label className="FormLabel">Last name<input className="FormInput" required value={lookup.lastName} onChange={lookupChange('lastName')} /></label>
          <label className="FormLabel">Date of birth<input className="FormInput" type="date" required value={lookup.dob} onChange={lookupChange('dob')} /></label>
          <label className="FormLabel">Membership number (optional)<input className="FormInput" value={lookup.affiliationNumber} onChange={lookupChange('affiliationNumber')} /></label>
        </div>
        <button className="EditorCommand" type="submit" disabled={busy}>{busy ? 'Looking up…' : 'Look up'}</button>
      </form>}

      {start.membershipId && <p className="ReportNotice">Erasing {start.name || 'this member'}.</p>}
      {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
      {nothingFound && <p className="ReportNotice" role="status">No member record or deleted record matches those details.</p>}

      {preview && !nothingFound && <form onSubmit={submit}>
        <div className="ReportDeleteWarning"><AlertTriangle size={22} /><div><strong>This cannot be undone.</strong>
          <p>Names, contact details, medical and emergency details are removed everywhere. Orders stay for the accounts with the person's details removed. Any Stripe subscription is cancelled. Services end.</p></div></div>

        <h4 className="CartItemTitle">Member records to erase</h4>
        {preview.people.length ? <ul className="ReportItems">{preview.people.map((person) => <li key={person.id}>{person.name} ({person.junior ? 'junior' : person.tier || 'member'}, {person.status || 'no status'})</li>)}</ul> : <p className="text_container">None on the register.</p>}

        {hasFamily && <fieldset className="CheckoutFieldset">
          <legend>This person is part of a family membership</legend>
          <p className="text_container">{preview.family.map((member) => member.name).join(', ')}. Choose how to handle the family.</p>
          <label className="CheckoutCheck"><input type="radio" name="gdpr-scope" checked={scope === 'family'} onChange={() => { setScope('family'); setConfirmation(''); }} /> Erase the whole family ({preview.family.length} people)</label>
          <label className="CheckoutCheck"><input type="radio" name="gdpr-scope" checked={scope === 'person'} onChange={() => { setScope('person'); setConfirmation(''); }} /> Erase only {start.membershipId ? (start.name || 'this person') : 'the matched person'} and keep the rest of the family</label>
        </fieldset>}

        {needsShared && <fieldset className="CheckoutFieldset">
          <legend>New shared details for the family who stay</legend>
          <p className="text_container">The remaining members shared this person's address, email and emergency contact, so each of their records needs these replaced.</p>
          <div className="CheckoutGrid">{SHARED_FIELDS.map(([key, label]) => <label className="FormLabel" key={key}>{label}<input className="FormInput" type={key === 'email' ? 'email' : 'text'} value={shared[key]} onChange={sharedChange(key)} /></label>)}</div>
          {sharedProblems.length > 0 && confirmation && <p className="StatusText StatusTextError" role="alert">{sharedProblems[0]}</p>}
        </fieldset>}

        <ul className="ReportItems">
          <li>{preview.ordersRedacted} {preview.ordersRedacted === 1 ? 'order' : 'orders'} will have personal details removed (amounts and items are kept).</li>
          <li>{preview.subscriptionsToCancel.length} Stripe {preview.subscriptionsToCancel.length === 1 ? 'subscription' : 'subscriptions'} will be cancelled.</li>
          <li>{preview.related.discountCodes} voucher or discount {preview.related.discountCodes === 1 ? 'code' : 'codes'}, {preview.related.lists} form {preview.related.lists === 1 ? 'submission' : 'submissions'} and {preview.related.stripeRecords} Stripe mirror {preview.related.stripeRecords === 1 ? 'record' : 'records'} will be cleared.</li>
          <li>{preview.deletedRecords.length} earlier deleted {preview.deletedRecords.length === 1 ? 'record' : 'records'} will be permanently purged{preview.deletedRecords.length ? `: ${preview.deletedRecords.map((entry) => entry.summary?.label).join(', ')}` : ''}.</li>
          {preview.people.some((person) => person.justgo) && <li>They are in JustGo; remove them there too or the weekly sync recreates the record.</li>}
          {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>

        <label className="FormLabel SpaceT4">Type ERASE to confirm<input className="FormInput" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy || familyChoiceMissing} /></label>
        {familyChoiceMissing && <p className="StatusText" role="status">Choose how to handle the family first.</p>}
        <button className="EditorCommand TileRemove" type="submit" disabled={!ready}><ShieldX size={18} /> {busy ? 'Working…' : 'Erase personal data'}</button>
      </form>}
    </>}
  </section></div>;
}
