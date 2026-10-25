import React, { useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';
import { volunteerBenefitText } from '../utils/volunteering';

export default function VolunteerBenefitsPanel({ adminUser, products }) {
  const [tiers, setTiers] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(apiUrl('/api/volunteer-benefits')).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load volunteer benefits.');
      setTiers(result.tiers);
    }).catch((error) => setError(error.message));
  }, []);
  const update = (id, change) => setTiers((current) => current.map((tier) => tier.id === id ? { ...tier, ...change } : tier));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const token = await adminUser.getIdToken();
      const response = await fetch(apiUrl('/api/admin/volunteer-benefits'), { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ tiers }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save volunteer benefits.');
      setTiers(result.tiers); setMessage('Volunteer benefits saved. Applies to future checkouts, not existing payments.');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <form className="main_tile SpaceT6" onSubmit={save}>
    <h3 className="tile_heading_bold_2">Volunteer hour brackets</h3>
    <p className="text_container">Blue and Gold monthly prices, also applied to up-front purchases. Free services are membership entitlements after induction and activation. Existing payments never change automatically.</p>
    {tiers.map((tier) => <fieldset key={tier.id} className="SpaceT4">
      <legend>{tier.hours}+ hours per club year</legend>
      <label className="FormLabel">Subscription monthly discount (£)<input className="FormInput" type="number" min="0" max="1000" step="0.01" required value={tier.monthlyDiscount} onChange={(event) => update(tier.id, { monthlyDiscount: Number(event.target.value) })} /></label>
      <label className="FormLabel">Maximum monthly price (£, blank = discount only)<input className="FormInput" type="number" min="0" max="1000" step="0.01" value={tier.monthlyCap ?? ''} onChange={(event) => update(tier.id, { monthlyCap: event.target.value === '' ? null : Number(event.target.value) })} /></label>
      <label className="FormLabel">Free services<select className="FormInput" multiple value={tier.freeProductIds} onChange={(event) => update(tier.id, { freeProductIds: [...event.target.selectedOptions].map((option) => option.value) })}>
        {products.filter((product) => product.category === 'SERVICES').map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
      </select></label>
      <p className="text_container">{volunteerBenefitText(tier, products)}</p>
    </fieldset>)}
    {error && <p role="alert" className="StatusTextError">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button className="FormSubmitButton" disabled={busy || tiers.length !== 3}>Save volunteer benefits</button>
  </form>;
}
