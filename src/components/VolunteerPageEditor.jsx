import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { MAX_VOLUNTEER_OPPORTUNITIES } from '../utils/volunteerPage';

export default function VolunteerPageEditor({ adminUser, content, panel, onSaved }) {
  const [draft, setDraft] = useState(content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const update = (change) => { setDraft((current) => ({ ...current, ...change })); setMessage(''); };
  const updateItem = (index, change) => update({ opportunities: draft.opportunities.map((item, position) => position === index ? { ...item, ...change } : item) });
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const token = await adminUser.getIdToken();
      const response = await fetch(apiUrl('/api/admin/volunteering'), { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(draft) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save volunteering.');
      setDraft(result.content); onSaved(result.content);
      setMessage('Volunteering content saved and live. No review or rebuild is needed.');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <form className="VolunteerConfigPanel" onSubmit={save}>
    <p className="text_container_note">Saving publishes the page wording, ways to volunteer and form wording immediately. The layout and form questions are fixed. Volunteer levels are saved separately.</p>
    <fieldset className="CheckoutFieldset" disabled={busy}>
      <div hidden={panel !== 'page'}>
        <label className="FormLabel">Page heading<input className="FormInput" maxLength={200} value={draft.title} onChange={(event) => update({ title: event.target.value })} /></label>
        <label className="FormLabel">Page introduction<textarea className="FormInput" rows={4} maxLength={2000} value={draft.intro} onChange={(event) => update({ intro: event.target.value })} /></label>
      </div>
      <div hidden={panel !== 'ways'}>
        <label className="FormLabel">Ways to volunteer heading<input className="FormInput" maxLength={200} value={draft.waysTitle} onChange={(event) => update({ waysTitle: event.target.value })} /></label>
        {draft.opportunities.map((item, index) => <fieldset className="CheckoutFieldset SpaceT4" key={index}>
          <legend className="FormLabel">Item {index + 1}</legend>
          <label className="FormLabel">Item title<input className="FormInput" maxLength={200} value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} /></label>
          <label className="FormLabel">Item description<textarea className="FormInput" rows={2} maxLength={1000} value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} /></label>
          <button type="button" className="EditorCommand" onClick={() => update({ opportunities: draft.opportunities.filter((_, position) => position !== index) })}><Trash2 size={16} /> Remove item {index + 1}</button>
        </fieldset>)}
        {!draft.opportunities.length && <p className="text_container_note">No ways to volunteer yet. Add an item to start the list.</p>}
        <button type="button" className="EditorCommand SpaceT4" disabled={draft.opportunities.length >= MAX_VOLUNTEER_OPPORTUNITIES}
          onClick={() => update({ opportunities: [...draft.opportunities, { title: 'New opportunity', description: '' }] })}><Plus size={16} /> Add item</button>
      </div>
      <div hidden={panel !== 'form'}>
        <p className="text_container_note">Only the heading and description can be changed. Questions, required fields and submission behaviour stay the same.</p>
        <label className="FormLabel">Form heading<input className="FormInput" maxLength={200} value={draft.formTitle} onChange={(event) => update({ formTitle: event.target.value })} /></label>
        <label className="FormLabel">Form description<textarea className="FormInput" rows={3} maxLength={2000} value={draft.formDescription} onChange={(event) => update({ formDescription: event.target.value })} /></label>
      </div>
    </fieldset>
    {error && <p role="alert" className="StatusText StatusTextError">{error}</p>}
    {message && <p role="status" className="StatusText StatusTextSuccess">{message}</p>}
    <button className="FormSubmitButton" disabled={busy}>{busy ? 'Saving…' : 'Save volunteering content'}</button>
  </form>;
}
