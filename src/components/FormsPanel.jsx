import React, { useState } from 'react';
import { apiUrl, apiFetch } from '../utils/api';

const EMPTY_FORM = { name: '', description: '', fields: 'Name\nEmail\nResponse' };

export default function FormsPanel({ adminUser }) {
  const [draft, setDraft] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const token = await adminUser.getIdToken();
      const response = await apiFetch(apiUrl('/api/admin/forms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          fields: draft.fields.split('\n').map((label) => label.trim()).filter(Boolean)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create form.');
      setMessage(`${result.form.name} created in the ${result.form.clubYear}-${result.form.clubYear + 1} folder.`);
      setDraft(EMPTY_FORM);
    } catch (formError) {
      setError(formError.message);
    } finally {
      setSaving(false);
    }
  };

  return <form className="main_tile AdminFormBuilder SpaceT6" onSubmit={handleCreate}>
    <div className="AdminListHeader"><div><span className="tile_eyebrow">Google Workspace</span><h3 className="tile_heading_bold_2">Create a form</h3></div></div>
    <p className="text_container SpaceB4">Creates one response spreadsheet in the current club-year folder on the Shared Drive. Forms currently appear on the Contact page.</p>
    <label className="FormLabel">Form name<input className="FormInput" required disabled={saving} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label className="FormLabel">Description<textarea className="FormInput" rows="2" disabled={saving} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
    <label className="FormLabel">Fields, one per line<textarea className="FormInput" rows="5" required disabled={saving} value={draft.fields} onChange={(event) => setDraft({ ...draft, fields: event.target.value })} /></label>
    {message && <p className="StatusText StatusTextSuccess" role="status">{message}</p>}
    {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
    <button className="FormSubmitButton" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create form and sheet'}</button>
  </form>;
}
