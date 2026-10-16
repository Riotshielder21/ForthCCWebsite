import React, { useState } from 'react';
import { ImagePlus, Loader2, LogOut, Save, Trash2, FileText, Upload } from 'lucide-react';
import { removeProduct, saveProduct, seedProducts, uploadProductImage } from '../utils/content';
import { CATEGORIES, PRODUCTS } from '../constants/products';
import { usePageEditor } from '../utils/PageContentContext';
import DiscountCodesPanel from '../components/DiscountCodesPanel';
import { apiUrl } from '../utils/api';
import { validateEventSchedule, eventScheduleLabel } from '../utils/catalogue';
import { cleanStockFields } from '../utils/inventory';

const EMPTY_PRODUCT = {
  id: '',
  name: '',
  category: 'SERVICES',
  basePrice: 0,
  description: '',
  type: 'annual-oneoff',
  hasAnnualDiscount: false,
  imageUrl: '',
  capacity: '',
  variants: [{ size: '', stock: 0 }],
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
  const [imageFile, setImageFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [formDraft, setFormDraft] = useState({ name: '', description: '', fields: 'Name\nEmail\nResponse' });

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value,
    ...(field === 'category' && value === 'EVENTS' ? { type: 'event-ticket', hasAnnualDiscount: false } : {}),
    ...(field === 'category' && value === 'MERCHANDISE' ? { type: 'merchandise', hasAnnualDiscount: false } : {}),
    ...(field === 'category' && value !== 'EVENTS' && current.type === 'event-ticket' ? { type: 'annual-oneoff' } : {}),
    ...(field === 'category' && value !== 'MERCHANDISE' && current.type === 'merchandise' ? { type: 'annual-oneoff' } : {})
  }));
  const updateVariant = (index, field, value) => setDraft((current) => ({ ...current,
    variants: (current.variants || []).map((variant, position) => position === index ? { ...variant, [field]: value } : variant)
  }));
  const addVariant = () => setDraft((current) => ({ ...current, variants: [...(current.variants || []), { size: '', stock: 0 }] }));
  const removeVariant = (index) => setDraft((current) => ({ ...current, variants: (current.variants || []).filter((_, position) => position !== index) }));
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


  const resetImageInput = () => { setImageFile(null); setFileInputKey((key) => key + 1); };

  const editProduct = (product) => {
    setSelectedProduct(product.id);
    setDraft({ ...EMPTY_PRODUCT, ...product, eventSchedule: { ...EMPTY_PRODUCT.eventSchedule, ...product.eventSchedule } });
    setMessage('');
    resetImageInput();
  };

  const startNewProduct = () => {
    setSelectedProduct(null);
    setDraft({ ...EMPTY_PRODUCT, id: `product-${Date.now()}` });
    setMessage('');
    resetImageInput();
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
      if (product.category === 'MERCHANDISE') {
        product.type = 'merchandise';
        product.hasAnnualDiscount = false;
        Object.assign(product, cleanStockFields(product));
      }
      if (product.category === 'EVENTS') {
        product.type = 'event-ticket';
        product.hasAnnualDiscount = false;
        product.eventSchedule = validateEventSchedule(product.eventSchedule);
        Object.assign(product, cleanStockFields(product));
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

  const handleImageUpload = async () => {
    if (!imageFile || !draft.id || uploading) return;
    setError('');
    setMessage('');
    setUploading(true);
    try {
      const imageUrl = await uploadProductImage(draft.id, imageFile);
      updateDraft('imageUrl', imageUrl);
      resetImageInput();
      setMessage('Image uploaded. Save the product to publish it.');
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
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
            {EDITABLE_FIELDS.filter((field) => field !== 'type' || !['EVENTS', 'MERCHANDISE'].includes(draft.category)).map((field) => (
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
              <label className="FormLabel">Capacity (tickets available, blank for unlimited)<input className="FormInput" type="number" min="1" step="1" value={draft.capacity ?? ''} onChange={(event) => updateDraft('capacity', event.target.value)} /></label>
              <p className="text_container text_container_note">When every ticket is sold the event leaves the shop. Delete a refunded order in Reports to free its place.</p>
              <p className="text_container text_container_note">One ticket covers the whole event/course. Times are Europe/London.</p>
            </fieldset>}
            {draft.category === 'MERCHANDISE' && <fieldset className="AdminEventSchedule">
              <legend className="tile_heading_bold_1">Sizes and stock</legend>
              {(draft.variants || []).map((variant, index) => (
                <div className="AdminEventTimes" key={index}>
                  <label className="FormLabel">Size<input className="FormInput" maxLength={40} placeholder="e.g. M or One size" value={variant.size} onChange={(event) => updateVariant(index, 'size', event.target.value)} /></label>
                  <label className="FormLabel">In stock<input className="FormInput" type="number" min="0" step="1" value={variant.stock} onChange={(event) => updateVariant(index, 'stock', event.target.value)} /></label>
                  <button type="button" className="CartRemoveButton" onClick={() => removeVariant(index)} aria-label={`Remove size ${variant.size || index + 1}`}><Trash2 className="IconMd" /></button>
                </div>
              ))}
              <button type="button" className="EditorCommand" onClick={addVariant}>Add size</button>
              <p className="text_container text_container_note">Customers choose a size and quantity. A size that sells out is greyed out, and the item leaves the shop when every size is gone. Delete a refunded order in Reports to return its stock.</p>
            </fieldset>}
            {draft.category !== 'EVENTS' && draft.category !== 'MERCHANDISE' && <label className="FormLabel AdminCheckbox"><input type="checkbox" checked={draft.hasAnnualDiscount} onChange={(event) => updateDraft('hasAnnualDiscount', event.target.checked)} /> Annual discount applies</label>}
            <label className="FormLabel">Product image<input key={fileInputKey} className="FormInput" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(event) => { setImageFile(event.target.files?.[0] || null); setMessage(''); setError(''); }} /></label>
            <button type="button" className="EditorCommand" onClick={handleImageUpload} disabled={!imageFile || uploading}>
              {uploading ? <Loader2 className="IconMd animate-spin" /> : <Upload className="IconMd" />} {uploading ? `Uploading ${imageFile?.name || 'image'}…` : 'Upload image'}
            </button>
            {imageFile && !uploading && <p className="StatusText" role="status">Not uploaded yet: {imageFile.name}</p>}
            {draft.imageUrl && <img className="AdminImagePreview" src={draft.imageUrl} alt="Product preview" />}
            {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
            <button className="FormSubmitButton" type="submit" disabled={uploading}><Save className="IconMd" /> Save product</button>
            <p className="text_container text_container_note"><ImagePlus className="IconSm" /> PNG, JPG, or WebP up to 5 MB.</p>
          </form>
        </div>
        <DiscountCodesPanel adminUser={adminUser} products={products} />
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
