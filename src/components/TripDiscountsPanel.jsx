import React, { useCallback, useEffect, useState } from 'react';
import { Percent, Plus, Trash2, X } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import { TRIP_DISCOUNT_LIMITS, tripDiscountSummary } from '../utils/tripDiscount';

const newRuleId = () => `rule-${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 12)}`;

/** Sets the automatic discounts on single-day trips for people who hold (or are buying) a qualifying service or subscription. */
export default function TripDiscountsPanel({ adminUser }) {
  const [saved, setSaved] = useState(null);
  const [rules, setRules] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const request = useCallback(async (options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await apiFetch(apiUrl('/api/admin/trip-discounts'), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);

  const load = (result) => {
    setSaved(result);
    setRules(result.rules.map((rule) => ({ ...rule, amount: String(rule.amount) })));
  };

  useEffect(() => {
    request().then(load).catch((loadError) => setError(loadError.message));
  }, [request]);

  const update = (id, changes) => setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...changes } : rule));
  const toggleProduct = (rule, productId) => update(rule.id, { productIds: rule.productIds.includes(productId)
    ? rule.productIds.filter((id) => id !== productId) : [...rule.productIds, productId] });
  const usedElsewhere = (rule, productId) => rules.some((other) => other.id !== rule.id && other.productIds.includes(productId));
  const valid = rules.map((rule) => ({ ...rule, amount: Number(rule.amount) }));

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      load(await request({ method: 'PUT', body: JSON.stringify({ rules: valid }) }));
      setMessage('Service trip discounts saved. Baskets and checkout use them from now on; paid orders keep the price charged.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="main_tile SpaceT6" onSubmit={save}>
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Shop</span><h3 className="tile_heading_bold_2">Service trip discounts</h3></div></div>
      <p className="text_container SpaceB4">Money off single-day trips for people who hold a service or subscription, such as annual boat hire. Each attendee gets the discount if they hold a qualifying service this club year, or are buying one in the same basket. Discounts add together when someone qualifies for more than one. Ticking own kit makes no difference: the discount depends only on what the attendee holds. Products chosen here cannot be removed from the shop.</p>
      {rules.map((rule) => (
        <fieldset className="CheckoutFieldset SpaceB4" key={rule.id}>
          <legend>{rule.short || 'New discount'}</legend>
          <button type="button" className="EditorCommand" onClick={() => setRules((current) => current.filter((other) => other.id !== rule.id))}><Trash2 size={18} /> Remove this discount</button>
          <label className="FormLabel">Short name, shown at checkout as "… discount applied"
            <input className="FormInput" value={rule.short} maxLength={TRIP_DISCOUNT_LIMITS.short} onChange={(event) => update(rule.id, { short: event.target.value })} placeholder="Kit hire" required /></label>
          <label className="FormLabel">Who qualifies, shown on trips as "£10 off with …"
            <input className="FormInput" value={rule.label} maxLength={TRIP_DISCOUNT_LIMITS.label} onChange={(event) => update(rule.id, { label: event.target.value })} placeholder="annual boat hire" required /></label>
          <label className="FormLabel">Discount (£)
            <input className="FormInput" type="number" min="0.01" max={TRIP_DISCOUNT_LIMITS.amount} step="0.01" value={rule.amount} onChange={(event) => update(rule.id, { amount: event.target.value })} required /></label>
          <p className="FormLabel">Qualifying products</p>
          <ul className="ProductChips" aria-label={`Qualifying products for ${rule.short || 'this discount'}`}>
            {rule.productIds.map((productId) => {
              const name = saved?.products.find((product) => product.id === productId)?.name || productId;
              return <li key={productId} className="ProductChip">{name}
                <button type="button" className="ProductChipRemove" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => toggleProduct(rule, productId)}><X size={14} /></button>
              </li>;
            })}
            {!rule.productIds.length && <li className="text_container_note">None yet. Add at least one product.</li>}
          </ul>
          <label className="FormLabel SpaceT3">Add a qualifying product
            <select className="FormInput" value="" disabled={!saved} onChange={(event) => event.target.value && toggleProduct(rule, event.target.value)}>
              <option value="">Choose a product…</option>
              {(saved?.products || []).filter((product) => !rule.productIds.includes(product.id)).map((product) => (
                <option key={product.id} value={product.id} disabled={usedElsewhere(rule, product.id)}>{product.name}{usedElsewhere(rule, product.id) ? ' (in another discount)' : ''}</option>
              ))}
            </select>
          </label>
        </fieldset>
      ))}
      {!rules.length && saved && <p className="text_container SpaceB4">No service trip discounts. Trips are full price for everyone.</p>}
      {rules.length < TRIP_DISCOUNT_LIMITS.rules && <button type="button" className="EditorCommand SpaceB4" disabled={!saved} onClick={() => setRules((current) => [...current, { id: newRuleId(), short: '', label: '', amount: '10', productIds: [] }])}><Plus size={18} /> Add discount</button>}
      {valid.every((rule) => Number.isFinite(rule.amount) && rule.amount > 0 && rule.label.trim()) && valid.length > 0 && <p className="text_container text_container_note">Trips will show: {tripDiscountSummary(valid.map((rule) => ({ ...rule, label: rule.label.trim() })))}</p>}
      {saved?.updatedAt > 0 && <p className="text_container text_container_note">Last changed {new Date(saved.updatedAt).toLocaleString('en-GB')} by {saved.updatedBy}.</p>}
      {saved && !saved.updatedAt && <p className="text_container text_container_note">These are the starting discounts; nothing has been changed yet.</p>}
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      <button className="FormSubmitButton" type="submit" disabled={saving || !saved}><Percent className="IconMd" /> Save service trip discounts</button>
    </form>
  );
}
