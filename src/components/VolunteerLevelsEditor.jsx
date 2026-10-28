import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { MAX_VOLUNTEER_LEVELS, volunteerBenefitText } from '../utils/volunteering';

const newLevelId = () => `level-${crypto.randomUUID().slice(0, 8)}`;

/** Edits one volunteer level at a time; saving replaces the whole list, which also drives the level cards. */
export default function VolunteerLevelsEditor({ adminUser, products = [], levels: savedLevels, onSaved }) {
  const [levels, setLevels] = useState(savedLevels);
  const [selectedId, setSelectedId] = useState(savedLevels[0]?.id || '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = levels.find((level) => level.id === selectedId);
  const services = products.filter((product) => product.category === 'SERVICES');
  const update = (change) => { setMessage(''); setLevels((current) => current.map((level) => level.id === selectedId ? { ...level, ...change } : level)); };
  const toggleService = (id) => update({ freeProductIds: selected.freeProductIds.includes(id)
    ? selected.freeProductIds.filter((value) => value !== id) : [...selected.freeProductIds, id] });
  const add = () => {
    const level = { id: newLevelId(), hours: Math.max(0, ...levels.map((item) => item.hours)) + 20, title: 'New level', description: '', extra: '',
      monthlyDiscount: 0, monthlyCap: null, freeProductIds: [] };
    setLevels([...levels, level]); setSelectedId(level.id); setMessage('');
  };
  const remove = () => {
    if (!window.confirm(`Delete the ${selected.hours}+ hours level? Its card disappears from the volunteering page when you save.`)) return;
    const remaining = levels.filter((level) => level.id !== selectedId);
    setLevels(remaining); setSelectedId(remaining[0]?.id || ''); setMessage('');
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const token = await adminUser.getIdToken();
      const response = await fetch(apiUrl('/api/admin/volunteer-benefits'), { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ tiers: levels }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save volunteer levels.');
      setLevels(result.tiers); onSaved?.(result.tiers);
      setMessage('Volunteer levels saved and live on the page. They apply to future checkouts, not existing payments.');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  const number = (value) => value === '' ? '' : Number(value);
  return <form className="VolunteerConfigPanel" onSubmit={save}>
    <p className="text_container_note">Each level is a card on this page and an option on the form. Discounts apply to Blue and Gold subscriptions, including up-front purchases. Free services are added to the membership after induction and activation. Saving takes effect immediately; existing payments never change.</p>
    <div className="VolunteerLevelPicker">
      <label className="FormLabel">Level
        <select className="FormInput" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {levels.map((level) => <option key={level.id} value={level.id}>{level.hours}+ hours — {level.title || 'Untitled'}</option>)}
        </select>
      </label>
      <button type="button" className="EditorCommand" onClick={add} disabled={levels.length >= MAX_VOLUNTEER_LEVELS}><Plus size={16} /> Add level</button>
      <button type="button" className="EditorCommand" onClick={remove} disabled={!selected || levels.length <= 1}><Trash2 size={16} /> Delete level</button>
    </div>
    {selected && <div className="SpaceT4">
      <div className="CheckoutGrid">
        <label className="FormLabel">Hours per club year<input className="FormInput" type="number" min="1" max="2000" step="1" required value={selected.hours} onChange={(event) => update({ hours: number(event.target.value) })} /></label>
        <label className="FormLabel">Card title<input className="FormInput" required maxLength="80" value={selected.title} onChange={(event) => update({ title: event.target.value })} /></label>
        <label className="FormLabel">Subscription monthly discount (£)<input className="FormInput" type="number" min="0" max="1000" step="0.01" required value={selected.monthlyDiscount} onChange={(event) => update({ monthlyDiscount: number(event.target.value) })} /></label>
        <label className="FormLabel">Maximum monthly price (£, blank = discount only)<input className="FormInput" type="number" min="0" max="1000" step="0.01" value={selected.monthlyCap ?? ''} onChange={(event) => update({ monthlyCap: event.target.value === '' ? null : Number(event.target.value) })} /></label>
      </div>
      <label className="FormLabel">Card description (optional)<textarea className="FormInput" rows={2} maxLength="1000" value={selected.description} onChange={(event) => update({ description: event.target.value })} /></label>
      <fieldset className="CheckoutFieldset">
        <legend className="FormLabel">Free services (tap to add or remove)</legend>
        <div className="VolunteerServiceChoices">
          {services.map((product) => <label key={product.id} className="CheckoutCheck"><input type="checkbox" checked={selected.freeProductIds.includes(product.id)} onChange={() => toggleService(product.id)} /> {product.name}</label>)}
        </div>
      </fieldset>
      <label className="FormLabel">Other benefits (arranged by the club, not applied automatically)<textarea className="FormInput" rows={2} maxLength="500" value={selected.extra} onChange={(event) => update({ extra: event.target.value })} /></label>
      <p className="text_container_note">Shown as: {volunteerBenefitText({ ...selected, monthlyDiscount: Number(selected.monthlyDiscount) || 0 }, products) || 'no benefits yet'}</p>
    </div>}
    {error && <p role="alert" className="StatusText StatusTextError">{error}</p>}
    {message && <p role="status" className="StatusText StatusTextSuccess">{message}</p>}
    <button className="FormSubmitButton" disabled={busy || !levels.length}>{busy ? 'Saving…' : 'Save volunteer levels'}</button>
  </form>;
}
