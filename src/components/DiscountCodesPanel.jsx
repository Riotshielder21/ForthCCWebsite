import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';

const TYPES = [
  ['multiplier', 'Percentage off (%)'],
  ['credit', 'Fixed amount off the total (£)'],
  ['flat', 'Fixed amount off each monthly subscription (£)']
];
const EMPTY = { code: '', label: '', discountType: 'multiplier', value: '', productIds: [], singleUse: false, expiresAt: '' };

const describe = (code) => code.discountType === 'multiplier'
  ? `${Math.round(code.discountValue * 10000) / 100}% off`
  : `£${Number(code.discountValue).toFixed(2)} off${code.discountType === 'flat' ? ' per month' : ''}`;

export default function DiscountCodesPanel({ adminUser, products }) {
  const [codes, setCodes] = useState([]);
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const sellable = products.filter((product) => product.type !== 'external');
  const nameFor = (id) => products.find((product) => product.id === id)?.name || id;

  const request = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);

  const load = useCallback(async () => {
    try {
      setCodes((await request('/api/admin/discount-codes')).codes);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const toggleProduct = (id) => update('productIds', draft.productIds.includes(id)
    ? draft.productIds.filter((candidate) => candidate !== id)
    : [...draft.productIds, id]);

  const handleSave = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const value = Number(draft.value);
      const body = {
        label: draft.label, discountType: draft.discountType,
        discountValue: draft.discountType === 'multiplier' ? value / 100 : value,
        productIds: draft.productIds, singleUse: draft.singleUse,
        ...(draft.expiresAt ? { expiresAt: `${draft.expiresAt}T23:59:59` } : {})
      };
      if (editing) {
        await request(`/api/admin/discount-codes/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(body) });
        setMessage(`${editing} updated.`);
      } else {
        await request('/api/admin/discount-codes', { method: 'POST', body: JSON.stringify({ code: draft.code, ...body }) });
        setMessage(`${draft.code.toUpperCase()} created.`);
      }
      setDraft(EMPTY);
      setEditing(null);
      load();
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const startEdit = (code) => {
    setEditing(code.code);
    setMessage('');
    setError('');
    setDraft({
      code: code.code, label: code.label, discountType: code.discountType,
      value: String(code.discountType === 'multiplier' ? Math.round(code.discountValue * 10000) / 100 : code.discountValue),
      productIds: code.productIds, singleUse: code.singleUse,
      expiresAt: code.expiresAt ? new Date(code.expiresAt).toISOString().slice(0, 10) : ''
    });
  };

  const cancelEdit = () => { setEditing(null); setDraft(EMPTY); };

  const toggleActive = async (code) => {
    setError('');
    try {
      await request(`/api/admin/discount-codes/${encodeURIComponent(code.code)}`, { method: 'PATCH', body: JSON.stringify({ active: !code.active }) });
      load();
    } catch (toggleError) {
      setError(toggleError.message);
    }
  };

  return (
    <section className="main_tile SpaceT6">
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Shop</span><h3 className="tile_heading_bold_2">Discount codes</h3></div></div>
      <p className="text_container SpaceB4">Choose products to limit a code to them. With none selected a code covers everything except membership.</p>
      <form className="CheckoutDetails" onSubmit={handleSave}>
        <div className="CheckoutGrid">
          <label className="FormLabel">Code<input className="FormInput" required disabled={Boolean(editing)} pattern="[A-Za-z0-9-]{3,64}" maxLength={64} value={draft.code} onChange={(event) => update('code', event.target.value.toUpperCase())} /></label>
          <label className="FormLabel">Label shown to customers<input className="FormInput" required maxLength={120} value={draft.label} onChange={(event) => update('label', event.target.value)} /></label>
          <label className="FormLabel">Type
            <select className="FormInput" value={draft.discountType} onChange={(event) => update('discountType', event.target.value)}>
              {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="FormLabel">{draft.discountType === 'multiplier' ? 'Percentage (1-100)' : 'Amount (£)'}
            <input className="FormInput" type="number" required min="0.01" max={draft.discountType === 'multiplier' ? '100' : undefined} step="0.01" value={draft.value} onChange={(event) => update('value', event.target.value)} />
          </label>
          <label className="FormLabel">Expires (optional, default 1 year)<input className="FormInput" type="date" value={draft.expiresAt} onChange={(event) => update('expiresAt', event.target.value)} /></label>
        </div>
        <fieldset className="CheckoutFieldset">
          <legend>Applies to</legend>
          {sellable.map((product) => (
            <label key={product.id} className="CheckoutCheck"><input type="checkbox" checked={draft.productIds.includes(product.id)} onChange={() => toggleProduct(product.id)} /> {product.name}</label>
          ))}
        </fieldset>
        <label className="CheckoutCheck"><input type="checkbox" checked={draft.singleUse} onChange={(event) => update('singleUse', event.target.checked)} /> Single use (disabled after one order)</label>
        {message && <p className="StatusText StatusTextSuccess">{message}</p>}
        {error && <p className="StatusText StatusTextError">{error}</p>}
        <button className="FormSubmitButton" type="submit">{editing ? `Save changes to ${editing}` : 'Create discount code'}</button>
        {editing && <button type="button" className="PrimaryActionButtonCompact" onClick={cancelEdit}>Cancel editing</button>}
      </form>

      {codes.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="text_container SpaceT4" style={{ width: '100%', textAlign: 'left' }}>
            <thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Status</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code.code}>
                  <td><code>{code.code}</code><br />{code.label}</td>
                  <td>{describe(code)}</td>
                  <td>{code.productIds.length ? code.productIds.map(nameFor).join(', ') : 'Everything except membership'}</td>
                  <td>{code.used ? 'used' : code.expired ? 'expired' : code.active ? 'active' : 'disabled'}{code.singleUse ? ' (single use)' : ''}</td>
                  <td>{code.expiresAt ? new Date(code.expiresAt).toLocaleDateString('en-GB') : ''}</td>
                  <td>
                    <button type="button" className="PrimaryActionButtonCompact" onClick={() => startEdit(code)}>Edit</button>{' '}
                    <button type="button" className="PrimaryActionButtonCompact" onClick={() => toggleActive(code)}>{code.active ? 'Disable' : 'Enable'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
