import React, { useState } from 'react';
import { ImagePlus, LogOut, Save, Trash2, FileText } from 'lucide-react';
import { removeProduct, saveProduct, seedProducts, uploadProductImage } from '../utils/content';
import { CATEGORIES, PRODUCTS } from '../constants/products';
import { usePageEditor } from '../utils/PageContentContext';
import { apiUrl } from '../utils/api';
import { validateEventSchedule, eventScheduleLabel } from '../utils/catalogue';

const EMPTY_PRODUCT = {
  id: '',
  name: '',
  category: 'SERVICES',
  basePrice: 0,
  description: '',
  type: 'annual-oneoff',
  hasAnnualDiscount: false,
  imageUrl: '',
  eventSchedule: { mode: 'single', startDate: '', startTime: '15:00', endTime: '17:00', days: 1, weeks: 1, timeZone: 'Europe/London' }
};

const EDITABLE_FIELDS = ['name', 'category', 'basePrice', 'description', 'type', 'imageUrl'];

export default function AdminPage({ products, onNavigate }) {
  const editor = usePageEditor();
  const { adminUser, authReady } = editor;
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [draft, setDraft] = useState(EMPTY_PRODUCT);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [formDraft, setFormDraft] = useState({ name: '', description: '', fields: 'Name\nEmail\nResponse' });

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value,
    ...(field === 'category' && value === 'EVENTS' ? { type: 'event-ticket', hasAnnualDiscount: false } : {}),
    ...(field === 'category' && value !== 'EVENTS' && current.type === 'event-ticket' ? { type: 'annual-oneoff' } : {})
  }));
  const updateEventSchedule = (field, value) => setDraft((current) => ({ ...current,
    eventSchedule: { ...EMPTY_PRODUCT.eventSchedule, ...current.eventSchedule, [field]: value }
  }));

  const handleLogin = async () => {
    setError('');
    try {
      await editor.login();
      setMessage('Signed in.');
    } catch (loginError) {
      setError(loginError.message || 'Sign-in failed. Check the account and admin access.');
    }
  };

  const handleCreateForm = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const token = await adminUser.getIdToken();
      const response = await fetch(apiUrl('/api/admin/forms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: formDraft.name,
          description: formDraft.description,
          fields: formDraft.fields.split('\n').map((label) => label.trim()).filter(Boolean)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create form.');
      setMessage(`${result.form.name} created in the ${result.form.clubYear}-${result.form.clubYear + 1} folder.`);
      setFormDraft({ name: '', description: '', fields: 'Name\nEmail\nResponse' });
    } catch (formError) {
      setError(formError.message);
    }
  };


  const editProduct = (product) => {
    setSelectedProduct(product.id);
    setDraft({ ...EMPTY_PRODUCT, ...product, eventSchedule: { ...EMPTY_PRODUCT.eventSchedule, ...product.eventSchedule } });
    setMessage('');
  };

  const startNewProduct = () => {
    setSelectedProduct(null);
    setDraft({ ...EMPTY_PRODUCT, id: `product-${Date.now()}` });
    setMessage('');
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const product = {
        ...draft,
        basePrice: Number(draft.basePrice),
        hasAnnualDiscount: Boolean(draft.hasAnnualDiscount)
      };
      if (product.category === 'EVENTS') {
        product.type = 'event-ticket';
        product.hasAnnualDiscount = false;
        product.eventSchedule = validateEventSchedule(product.eventSchedule);
      }
      await saveProduct(product);
      setSelectedProduct(product.id);
      setDraft(product);
      setMessage(`${product.name || 'Product'} saved.`);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const handleDelete = async () => {
    if (!selectedProduct || !window.confirm('Remove this product from the shop?')) return;
    try {
      await removeProduct(selectedProduct);
      setDraft({ ...EMPTY_PRODUCT });
      setSelectedProduct(null);
      setMessage('Product removed.');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const handleImageChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !draft.id) return;
    setError('');
    try {
      const imageUrl = await uploadProductImage(draft.id, file);
      updateDraft('imageUrl', imageUrl);
      setMessage('Image uploaded. Save the product to publish it.');
    } catch (uploadError) {
      setError(uploadError.message);
    }
  };

  const handleSeed = async () => {
    if (!window.confirm('Reset starter products? This replaces edits to starter items and restores deleted starter items. New products are kept.')) return;
    try {
      await seedProducts(PRODUCTS);
      setMessage('The starter catalog has been copied to the shared catalog.');
    } catch (seedError) {
      setError(seedError.message);
    }
  };

  if (!authReady) return <p className="SectionHero" role="status">Restoring your session…</p>;

  if (!adminUser) {
    return (
      <div className="SectionHero PageFadeIn">
        <div className="FormContainer AdminLogin">
          <span className="tile_eyebrow">Content Management</span>
          <h2 className="tile_heading_bold_2">Website editor</h2>
          <p className="text_container SpaceB6">Sign in with an approved Forth Canoe Club Google Workspace account.</p>
          <form onSubmit={(event) => { event.preventDefault(); handleLogin(); }} className="SpaceY4">
            {error && <p className="StatusText StatusTextError">{error}</p>}
            <button className="FormSubmitButton" type="submit">{import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ? 'Sign in as local test admin' : 'Continue with Google'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="PageHero">
          <div>
            <span className="tile_eyebrow">Content Management</span>
            <h2 className="page_heading_bold_2">Website editor</h2>
            <p className="PageIntro">Catalogue, event tickets, forms and reports.</p>
          </div>
          <div className="AdminPreviewActions"><button className="EditorCommand" onClick={() => onNavigate('admin-reports')}><FileText size={18} /> Reports & records</button>
          <button className="MobileMenuButton AdminSignOut" onClick={() => editor.logout().catch((logoutError) => setError(logoutError.message))}> <LogOut className="IconMd" /> Sign out</button></div>
        </div>
      </div>
      <div className="SectionBottom">
        <div className="AdminLayout">
          <aside className="main_tile AdminProductList">
            <div className="AdminListHeader"><h3 className="tile_heading_bold_1">Catalogue ({products.length})</h3><button type="button" className="PrimaryActionButtonCompact" onClick={startNewProduct}>New</button></div>
            <button className="ContentLink AdminSeedButton" onClick={handleSeed}>Copy starter catalog</button>
            <div className="AdminProducts">
              {products.map((product) => <button key={product.id} className={`AdminProduct ${selectedProduct === product.id ? 'is-selected' : ''}`} onClick={() => editProduct(product)}><strong>{product.name}</strong><span>{product.category}</span></button>)}
            </div>
            {!products.length && <p className="text_container">No products. Add a new item or restore the starter catalogue.</p>}
          </aside>
          <form className="main_tile AdminEditor" onSubmit={handleSave}>
            <div className="AdminListHeader"><h3 className="tile_heading_bold_1">{selectedProduct ? 'Edit product' : 'New product'}</h3>{selectedProduct && <button type="button" className="CartRemoveButton" onClick={handleDelete} aria-label="Remove product"><Trash2 className="IconMd" /></button>}</div>
            {EDITABLE_FIELDS.filter((field) => field !== 'type' || draft.category !== 'EVENTS').map((field) => (
              <label className="FormLabel" key={field}>{field === 'basePrice' ? 'Price' : field}
                {field === 'description' ? <textarea className="FormInput" rows="4" value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)} required /> : field === 'category' || field === 'type' ? <select className="FormInput" value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)}>{(field === 'category' ? CATEGORIES.filter((category) => category !== 'ALL') : ['external', 'voucher', 'annual-oneoff', 'yearly-service', 'subscription']).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input className="FormInput" type={field === 'basePrice' ? 'number' : 'text'} min={field === 'basePrice' ? '0' : undefined} step={field === 'basePrice' ? '0.01' : undefined} value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)} required={field !== 'imageUrl'} />}
              </label>
            ))}
            {draft.category === 'EVENTS' && <fieldset className="AdminEventSchedule">
              <legend className="tile_heading_bold_1">Event schedule</legend>
              <label className="FormLabel">Schedule type<select className="FormInput" value={draft.eventSchedule.mode} onChange={(event) => updateEventSchedule('mode', event.target.value)}><option value="single">Single date</option><option value="consecutive">Consecutive-day course</option><option value="weekly">Consecutive-week course</option></select></label>
              <label className="FormLabel">{draft.eventSchedule.mode === 'single' ? 'Event date' : 'First course date'}<input className="FormInput" type="date" required value={draft.eventSchedule.startDate} onChange={(event) => updateEventSchedule('startDate', event.target.value)} /></label>
              {draft.eventSchedule.mode === 'consecutive' && <label className="FormLabel">Number of consecutive days<input className="FormInput" type="number" min="1" max="60" step="1" required value={draft.eventSchedule.days} onChange={(event) => updateEventSchedule('days', Number(event.target.value))} /></label>}
              {draft.eventSchedule.mode === 'weekly' && <label className="FormLabel">Number of consecutive weeks<input className="FormInput" type="number" min="1" max="60" step="1" required value={draft.eventSchedule.weeks ?? 1} onChange={(event) => updateEventSchedule('weeks', Number(event.target.value))} /></label>}
              <div className="AdminEventTimes"><label className="FormLabel">Start time<input className="FormInput" type="time" required value={draft.eventSchedule.startTime} onChange={(event) => updateEventSchedule('startTime', event.target.value)} /></label><label className="FormLabel">End time<input className="FormInput" type="time" required value={draft.eventSchedule.endTime} onChange={(event) => updateEventSchedule('endTime', event.target.value)} /></label></div>
              <p className="text_container">{eventScheduleLabel(draft.eventSchedule)}</p>
              <p className="text_container text_container_note">One ticket covers the whole event/course. Times are Europe/London.</p>
            </fieldset>}
            {draft.category !== 'EVENTS' && <label className="FormLabel AdminCheckbox"><input type="checkbox" checked={draft.hasAnnualDiscount} onChange={(event) => updateDraft('hasAnnualDiscount', event.target.checked)} /> Annual discount applies</label>}
            <label className="FormLabel">Product image<input className="FormInput" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} /></label>
            {draft.imageUrl && <img className="AdminImagePreview" src={draft.imageUrl} alt="Product preview" />}
            {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
            <button className="FormSubmitButton" type="submit"><Save className="IconMd" /> Save product</button>
            <p className="text_container text_container_note"><ImagePlus className="IconSm" /> PNG, JPG, or WebP up to 5 MB.</p>
          </form>
        </div>
        <form className="main_tile AdminFormBuilder SpaceT6" onSubmit={handleCreateForm}>
          <div className="AdminListHeader"><div><span className="tile_eyebrow">Google Workspace</span><h3 className="tile_heading_bold_2">Create a form</h3></div></div>
          <p className="text_container SpaceB4">Creates one response spreadsheet in the current club-year folder on the Shared Drive.</p>
          <label className="FormLabel">Form name<input className="FormInput" required value={formDraft.name} onChange={(event) => setFormDraft({ ...formDraft, name: event.target.value })} /></label>
          <label className="FormLabel">Description<textarea className="FormInput" rows="2" value={formDraft.description} onChange={(event) => setFormDraft({ ...formDraft, description: event.target.value })} /></label>
          <label className="FormLabel">Fields, one per line<textarea className="FormInput" rows="5" required value={formDraft.fields} onChange={(event) => setFormDraft({ ...formDraft, fields: event.target.value })} /></label>
          <button className="FormSubmitButton" type="submit">Create form and sheet</button>
        </form>
      </div>
    </div>
  );
}
