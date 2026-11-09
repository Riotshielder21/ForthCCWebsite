import React, { useEffect, useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import { subscribeToProducts } from '../utils/content';
import { PRODUCTS } from '../constants/products';
import { normaliseProduct } from '../utils/catalogue';
import { calculateCart, expandClubYearLines } from '../utils/pricing';
import { clubYearChoices, clubYearLabel, clubYearOf, defaultClubYearChoice } from '../utils/clubYear';
import { assignLines, validateCheckout } from '../utils/checkout';
import { checkoutWording } from '../utils/consents';
import { itemLabel, productLimits, isMerchandise } from '../utils/inventory';
import { CREDIT_METHODS } from '../utils/credits';
import CheckoutPage from '../pages/CheckoutPage';

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const blankPayment = () => ({ method: 'bank-transfer', amount: '', receivedAt: today(), reference: '', note: '' });
const choiceLabel = (choice) => {
  const year = clubYearOf(new Date());
  return choice === 'this' ? `This club year (${clubYearLabel(year)})` : choice === 'next' ? `Next club year (${clubYearLabel(year + 1)})`
    : `Both (${clubYearLabel(year)} and ${clubYearLabel(year + 1)})`;
};
// Refusals about the items themselves send the admin back to change them, as checkout sends customers back to the basket.
const ITEM_REFUSALS = ['membership_required', 'renews_via_justgo', 'membership_active', 'renewal_unconfirmed', 'sold_out', 'club_year_unavailable', 'already_held', 'payment_processing', 'already_paid'];

/** Credits shop items to a member when they paid outside the website or are given them free. */
export default function CreditItemsPanel({ adminUser }) {
  const [products, setProducts] = useState(() => PRODUCTS.map(normaliseProduct));
  const [lookup, setLookup] = useState({ query: '', busy: false, result: null, error: '' });
  const [email, setEmail] = useState('');
  const [cart, setCart] = useState([]);
  const [people, setPeople] = useState([]);
  const [choice, setChoice] = useState({ id: '', size: '', clubYearChoice: '' });
  const [payment, setPayment] = useState(blankPayment);
  const [step, setStep] = useState('items');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState([]);
  const [focusPersonId, setFocusPersonId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => subscribeToProducts(setProducts, (loadError) => console.error('Product catalog unavailable:', loadError)), []);
  useEffect(() => { setPeople((previous) => assignLines(previous, cart, newId)); }, [cart]);

  const shop = products.filter((product) => product.type !== 'external');
  const product = shop.find((candidate) => candidate.id === choice.id);
  const sizes = product && isMerchandise(product) ? Object.keys(productLimits(product) || {}) : [];
  const years = product ? clubYearChoices(product) : [];
  const priced = useMemo(() => calculateCart(expandClubYearLines(cart), true), [cart]);
  const { total } = priced;

  const findCustomer = async (event) => {
    event.preventDefault();
    const query = lookup.query.trim();
    if (!query) return;
    setLookup({ ...lookup, busy: true, result: null, error: '' });
    try {
      const token = await adminUser.getIdToken();
      const response = await apiFetch(apiUrl(`/api/admin/customer?q=${encodeURIComponent(query)}`), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const result = await response.json().catch(() => null);
      if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
      if (response.status === 404) {
        setLookup({ query, busy: false, result: { email: query.toLowerCase(), memberships: [] }, error: '' });
        setEmail(query.toLowerCase());
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Could not find the customer.');
      setLookup({ query, busy: false, result, error: '' });
      setEmail(result.email);
    } catch (lookupError) {
      setLookup({ query, busy: false, result: null, error: lookupError.message });
    }
  };

  const addItem = () => {
    if (!product) return;
    const clubYearChoice = years.length ? (years.includes(choice.clubYearChoice) ? choice.clubYearChoice : defaultClubYearChoice(product)) : '';
    if (sizes.length && !sizes.includes(choice.size)) {
      setError(`Choose a size for ${product.name}.`);
      return;
    }
    setError('');
    setMessage('');
    setCart((previous) => [...previous, { ...product, lineId: newId(), ...(sizes.length ? { size: choice.size } : {}), ...(clubYearChoice ? { clubYearChoice } : {}) }]);
    setChoice({ id: '', size: '', clubYearChoice: '' });
  };

  const paymentError = () => {
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(payment.amount.trim())) return 'Enter the amount received, for example 45.00 (0 for complimentary).';
    return '';
  };

  const continueToDetails = () => {
    const problem = !cart.length ? 'Add at least one item.' : !email ? 'Find the customer first.' : paymentError();
    setError(problem);
    setMessage('');
    if (!problem) { setErrors([]); setStep('details'); }
  };

  const reset = () => {
    setCart([]);
    setPeople([]);
    setPayment(blankPayment());
    setLookup({ query: '', busy: false, result: null, error: '' });
    setEmail('');
    setErrors([]);
    setError('');
    setStep('items');
  };

  const credit = async (noticeVersions = {}) => {
    const problems = [...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? [] : ['Enter a valid receipt email address.']), ...validateCheckout({ lines: cart, people })];
    if (problems.length) return setErrors(problems);
    setErrors([]);
    setBusy(true);
    try {
      const token = await adminUser.getIdToken();
      const response = await apiFetch(apiUrl('/api/admin/credits'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: email.trim(),
          items: cart.map(({ id, lineId, size, clubYearChoice }) => ({ id, lineId, ...(size ? { size } : {}), ...(clubYearChoice ? { clubYearChoice } : {}) })),
          people, noticeVersions, wording: checkoutWording(),
          payment: { method: payment.method, amountPence: Math.round(Number(payment.amount) * 100), receivedAt: payment.receivedAt,
            reference: payment.reference, note: payment.note }
        })
      });
      const result = await response.json().catch(() => null);
      if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
      if (!response.ok) {
        if (ITEM_REFUSALS.includes(result.code) || (response.status === 400 && !result.details && !result.personIds)) {
          setError(result.error || 'Could not credit the items.');
          setStep('items');
        } else {
          setFocusPersonId(result.personIds?.[0] || null);
          setErrors(result.details || [result.error || 'Could not credit the items.']);
        }
        return;
      }
      const receiptTo = email.trim();
      reset();
      setMessage(`Credited as order ${result.orderRef}. ${result.receiptEmailed ? `Receipt emailed to ${receiptTo}.` : 'The receipt email could not be sent; it is listed under Needs attention.'}`);
    } catch (creditError) {
      setErrors([creditError.message]);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'details') {
    return <div className="SpaceT6">
      <p className="ReportNotice">Crediting {cart.length} item{cart.length === 1 ? '' : 's'} to {email}: {CREDIT_METHODS.find(([value]) => value === payment.method)?.[1]}, £{Number(payment.amount).toFixed(2)} received. Fill in each person's details as the customer would at checkout, including their disclaimer and consent answers.</p>
      <CheckoutPage lines={cart} people={people} onPeopleChange={setPeople} email={email} onEmailChange={setEmail} serverErrors={errors} focusPersonId={focusPersonId}
        busy={busy} total={total} pricedItems={priced.items} onBack={() => { setErrors([]); setStep('items'); }} onReset={() => setPeople(assignLines([], cart, newId))} onPay={credit} makeId={newId}
        labels={{ back: 'Back to items', review: 'Review and credit', submit: 'Credit items', submitting: 'Crediting…' }} />
    </div>;
  }

  const setPaymentField = (field) => (event) => setPayment({ ...payment, [field]: event.target.value });
  return (
    <div className="main_tile SpaceT6">
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Shop</span><h3 className="tile_heading_bold_2">Credit items</h3></div></div>
      <p className="text_container SpaceB4">Record items a customer paid for outside the website (bank transfer, cash or cheque) or is given free. The same checks as checkout apply: someone who is not a member needs a membership first, which can be credited in the same order. No card payment is taken, the usual receipt is emailed, and the order shows in Purchases as credited rather than as Stripe takings. Refunds of credited orders are made outside the website.</p>

      <form className="SpaceB4" onSubmit={findCustomer}>
        <label className="FormLabel">Customer email<input className="FormInput" type="email" required value={lookup.query} onChange={(event) => setLookup({ ...lookup, query: event.target.value })} /></label>
        <button className="EditorCommand" type="submit" disabled={lookup.busy}><Search className="IconSm" /> {lookup.busy ? 'Finding…' : 'Find customer'}</button>
      </form>
      {lookup.error && <p className="StatusText StatusTextError" role="alert">{lookup.error}</p>}
      {lookup.result && (lookup.result.memberships?.length
        ? <ul className="text_container SpaceB4">{lookup.result.memberships.map((member) => (
          <li key={member.id}>{member.name} ({member.id}): {member.membershipTier || 'membership'}, {member.status}{member.validUntil ? ` until ${new Date(member.validUntil).toLocaleDateString('en-GB')}` : ''}</li>
        ))}</ul>
        : <p className="ReportNotice">No membership under {lookup.result.email}. Add a membership to the items so they become a member, or enter a returning member's details on the next step.</p>)}

      <h4 className="FormLabel">Items</h4>
      {cart.map((line) => <p key={line.lineId} className="text_container">
        {itemLabel(line)}{line.clubYearChoice ? `, ${choiceLabel(line.clubYearChoice)}` : ''}
        <button type="button" className="CartRemoveButton" aria-label={`Remove ${line.name}`} onClick={() => setCart(cart.filter((other) => other.lineId !== line.lineId))}><Trash2 className="IconSm" /></button>
      </p>)}
      <div className="ReportsRowActions SpaceB4">
        <select className="FormInput" aria-label="Item" value={choice.id} onChange={(event) => setChoice({ id: event.target.value, size: '', clubYearChoice: '' })}>
          <option value="">Choose an item</option>
          {shop.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {sizes.length > 0 && <select className="FormInput" aria-label="Size" value={choice.size} onChange={(event) => setChoice({ ...choice, size: event.target.value })}>
          <option value="">Size</option>{sizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>}
        {years.length > 1 && <select className="FormInput" aria-label="Club year" value={choice.clubYearChoice || defaultClubYearChoice(product)} onChange={(event) => setChoice({ ...choice, clubYearChoice: event.target.value })}>
          {years.map((year) => <option key={year} value={year}>{choiceLabel(year)}</option>)}
        </select>}
        <button type="button" className="EditorCommand" disabled={!product} onClick={addItem}>Add item</button>
      </div>
      {cart.length > 0 && <p className="text_container">Shop price £{total.toFixed(2)} (paid annually).</p>}

      <h4 className="FormLabel">Payment</h4>
      <label className="FormLabel">How it was paid<select className="FormInput" value={payment.method}
        onChange={(event) => setPayment({ ...payment, method: event.target.value, ...(event.target.value === 'complimentary' ? { amount: '0' } : {}) })}>
        {CREDIT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="FormLabel">Amount received (£)<input className="FormInput" inputMode="decimal" value={payment.amount} disabled={payment.method === 'complimentary'} onChange={setPaymentField('amount')} /></label>
      <label className="FormLabel">Date received<input className="FormInput" type="date" max={today()} value={payment.receivedAt} onChange={setPaymentField('receivedAt')} /></label>
      <label className="FormLabel">Payment reference{['bank-transfer', 'cheque'].includes(payment.method) ? '' : ' (optional)'}<input className="FormInput" maxLength={100} value={payment.reference} onChange={setPaymentField('reference')} /></label>
      <label className="FormLabel">Note{['complimentary', 'other'].includes(payment.method) ? '' : ' (optional)'}<textarea className="FormInput" rows="2" maxLength={1000} value={payment.note} onChange={setPaymentField('note')} /></label>

      {message && <p className="StatusText StatusTextSuccess" role="status">{message}</p>}
      {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
      <button className="FormSubmitButton" type="button" onClick={continueToDetails}>Continue to details</button>
    </div>
  );
}
