import React, { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { RECEIPT_PERSON_FIELDS } from '../utils/receipt';

/** Chooses which submitted details each person's section of the confirmation email repeats back to the buyer. */
export default function ReceiptEmailPanel({ adminUser }) {
  const [saved, setSaved] = useState(null);
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const request = useCallback(async (options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl('/api/admin/receipt-email'), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);

  useEffect(() => {
    request().then((result) => {
      setSaved(result);
      setSelected(result.personFields);
    }).catch((loadError) => setError(loadError.message));
  }, [request]);

  const toggle = (key) => setSelected((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const result = await request({ method: 'POST', body: JSON.stringify({ personFields: selected }) });
      setSaved(result);
      setSelected(result.personFields);
      setMessage('Receipt email details saved. They apply to confirmation emails sent from now on.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="main_tile SpaceT6" onSubmit={save}>
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Shop</span><h3 className="tile_heading_bold_2">Receipt email details</h3></div></div>
      <p className="text_container SpaceB4">Choose which submitted details are repeated under each person in the purchase confirmation email, so buyers can check what they entered. Names, email addresses and purchases are always included. These details are only sent to the buyer's email address; the secure receipt link on the website never shows them.</p>
      <div className="SpaceB4">
        {RECEIPT_PERSON_FIELDS.map((field) => (
          <label className="CheckoutCheck" key={field.key}>
            <input type="checkbox" checked={selected.includes(field.key)} onChange={() => toggle(field.key)} /> {field.label}{field.sensitive ? ' (health data)' : ''}
          </label>
        ))}
      </div>
      <p className="text_container text_container_note">Email is not encrypted end to end and may be forwarded, and these emails often include children's details. Only include what buyers need to check.</p>
      {saved?.updatedAt > 0 && <p className="text_container text_container_note">Last changed {new Date(saved.updatedAt).toLocaleString('en-GB')} by {saved.updatedBy}.</p>}
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      <button className="FormSubmitButton" type="submit" disabled={saving || !saved}><Mail className="IconMd" /> Save receipt email details</button>
    </form>
  );
}
