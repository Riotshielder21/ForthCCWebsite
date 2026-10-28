import React, { useState } from 'react';
import { ImagePlus, Loader2, LogOut, Save, Trash2, FileText, Upload } from 'lucide-react';
import { removeProduct, reserveProductId, saveProduct, seedProducts, uploadProductImage } from '../utils/content';
import { isLockedProduct } from '../utils/tripDiscount';
import { CATEGORIES, PRODUCTS } from '../constants/products';
import { usePageEditor } from '../utils/PageContentContext';
import DiscountCodesPanel from '../components/DiscountCodesPanel';
import PagedAdminList from '../components/PagedAdminList';
import EventRosterControl from '../components/EventRosterControl';
import { apiUrl } from '../utils/api';
import { validateEventSchedule, eventScheduleLabel, normaliseProduct } from '../utils/catalogue';
import { cleanStockFields } from '../utils/inventory';
import { cleanEventDetails } from '../utils/eventRoster';

const EMPTY_PRODUCT = {
  id: '',
  name: '',
  category: 'SERVICES',
  basePrice: 0,
  description: '',
  type: 'yearly-service',
  pricingMode: 'fixed',
  allowMonthly: false,
  hasAnnualDiscount: false,
  imageUrl: '',
  capacity: '',
  variants: [{ size: '', stock: 0 }],
  eventSchedule: { mode: 'single', startDate: '', startTime: '15:00', endTime: '17:00', days: 1, weeks: 1, timeZone: 'Europe/London' },
  leaderName: '', leaderEmail: '', closeDate: '', membershipRule: 'required'
};

const MEMBERSHIP_RULE_LABELS = { required: 'Club members only', none: 'Open to non-members', included: 'Club membership included' };
const MEMBERSHIP_RULE_NOTES = {
  required: 'Buyers must already be members, or add a membership to their basket.',
  none: 'Non-members can buy. They are kept as contacts, not members, and do not appear in the member register.',
  included: 'Each person becomes an adult or junior club member (by age) until 1 March. Existing members pay the same price.'
};

const EDITABLE_FIELDS = ['name', 'category', 'basePrice', 'description', 'imageUrl'];
const PRICING_LABELS = { fixed: 'Fixed: full price all year', prorated: 'Prorated 60%: full price, then 60% from 1 October', subscription: 'Prorated monthly: monthly price for each month left to 1 March' };

export default function AdminPage({ products, onNavigate }) {
  const editor = usePageEditor();
  const { adminUser, authReady } = editor;
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [draft, setDraft] = useState(EMPTY_PRODUCT);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [reservingId, setReservingId] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [formDraft, setFormDraft] = useState({ name: '', description: '', fields: 'Name\nEmail\nResponse' });

  // Type, pricing mode and monthly billing follow the category (see productTerms).
  const updateDraft = (field, value) => setDraft((current) => {
    const next = { ...current, [field]: value };
    if (field === 'category' && value === 'SUBSCRIPTIONS' && current.category !== 'SUBSCRIPTIONS') next.allowMonthly = true;
    if (field === 'category' && value === 'SERVICES' && current.category !== 'SERVICES') next.pricingMode = 'fixed';
    if (field === 'pricingMode' && value === 'subscription' && current.pricingMode !== 'subscription') next.allowMonthly = true;
    const terms = normaliseProduct(next);
    return { ...terms, ...(terms.pricingMode === 'subscription' ? {} : { hasAnnualDiscount: false }) };
  });
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
    setDraft({ ...EMPTY_PRODUCT, ...normaliseProduct(product), eventSchedule: { ...EMPTY_PRODUCT.eventSchedule, ...product.eventSchedule } });
    setMessage('');
    resetImageInput();
  };

  const startNewProduct = async () => {
    setError('');
    setReservingId(true);
    try {
      const id = await reserveProductId(await adminUser.getIdToken());
      setSelectedProduct(null);
      setDraft({ ...EMPTY_PRODUCT, id });
      setMessage('');
      resetImageInput();
    } catch (idError) {
      setError(idError.message);
    } finally {
      setReservingId(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (saving || reservingId) return;
    setError('');
    setSaving(true);
    try {
      const product = {
        ...draft,
        ...normaliseProduct(draft),
        basePrice: Number(draft.basePrice),
        hasAnnualDiscount: Boolean(draft.hasAnnualDiscount) && normaliseProduct(draft).pricingMode === 'subscription'
      };
      if (product.category === 'MERCHANDISE') {
        Object.assign(product, cleanStockFields(product));
      }
      if (product.category === 'EVENTS') {
        product.eventSchedule = validateEventSchedule(product.eventSchedule);
        Object.assign(product, cleanEventDetails(product));
        Object.assign(product, cleanStockFields(product));
      }
      if (!product.id) {
        product.id = await reserveProductId(await adminUser.getIdToken());
        setDraft(product);
      }
      await saveProduct(product);
      setSelectedProduct(product.id);
      setDraft(product);
      setMessage(`${product.name || 'Product'} saved.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
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
          <div className="AdminPreviewActions"><span className="StatusText StatusTextSuccess" role="status">Signed in as {adminUser.email}.</span>
          <button className="EditorCommand" onClick={() => onNavigate('admin-reports')}><FileText size={18} /> Reports & records</button>
          <button className="MobileMenuButton AdminSignOut" onClick={() => editor.logout().catch((logoutError) => setError(logoutError.message))}> <LogOut className="IconMd" /> Sign out</button></div>
        </div>
      </div>
      <div className="SectionBottom">
        <div className="AdminLayout">
          <aside className="main_tile AdminProductList">
            <div className="AdminListHeader"><h3 className="tile_heading_bold_1">Catalogue ({products.length})</h3><button type="button" className="PrimaryActionButtonCompact" onClick={startNewProduct} disabled={reservingId || saving}>{reservingId ? 'Creating...' : 'New'}</button></div>
            <button className="ContentLink AdminSeedButton" onClick={handleSeed}>Copy starter catalog</button>
            <div className="AdminProducts">
              <PagedAdminList items={products} label="catalogue items" renderItem={(product) => <button key={product.id} className={`AdminProduct ${selectedProduct === product.id ? 'is-selected' : ''}`} onClick={() => editProduct(product)}><strong>{product.name}</strong><span>{product.category}</span></button>} />
            </div>
            {!products.length && <p className="text_container">No products. Add a new item or restore the starter catalogue.</p>}
          </aside>
          <form className="main_tile AdminEditor" onSubmit={handleSave}>
            <div className="AdminListHeader"><h3 className="tile_heading_bold_1">{selectedProduct ? 'Edit product' : 'New product'}</h3>{selectedProduct && !isLockedProduct(selectedProduct) && <button type="button" className="CartRemoveButton" onClick={handleDelete} aria-label="Remove product"><Trash2 className="IconMd" /></button>}</div>
            {selectedProduct && isLockedProduct(selectedProduct) && <p className="text_container text_container_note">This product cannot be removed: holding it gives £10 off single-day trips at checkout.</p>}
            {EDITABLE_FIELDS.map((field) => (
              <label className="FormLabel" key={field}>{field === 'basePrice' ? (draft.pricingMode === 'subscription' ? 'Monthly price' : 'Price') : field}
                {field === 'description' ? <textarea className="FormInput" rows="4" value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)} required /> : field === 'category' ? <select className="FormInput" value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)}>{CATEGORIES.filter((category) => category !== 'ALL').map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input className="FormInput" type={field === 'basePrice' ? 'number' : 'text'} min={field === 'basePrice' ? '0' : undefined} step={field === 'basePrice' ? '0.01' : undefined} value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)} required={field !== 'imageUrl'} />}
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
            {draft.category === 'EVENTS' && <fieldset className="AdminEventSchedule">
              <legend className="tile_heading_bold_1">Event leader</legend>
              <label className="FormLabel">Leader name<input className="FormInput" maxLength={120} value={draft.leaderName || ''} onChange={(event) => updateDraft('leaderName', event.target.value)} /></label>
              <label className="FormLabel">Leader email (shown in the shop)<input className="FormInput" type="email" maxLength={254} value={draft.leaderEmail || ''} onChange={(event) => updateDraft('leaderEmail', event.target.value)} /></label>
              <label className="FormLabel">Bookings close (end of this day)<input className="FormInput" type="date" max={draft.eventSchedule.startDate || undefined} value={draft.closeDate || ''} onChange={(event) => updateDraft('closeDate', event.target.value)} /></label>
              <p className="text_container text_container_note">When bookings close, the leader is emailed the attendee list once, with emergency contacts, medical details and who needs boat hire. Leave blank to keep bookings open.</p>
              {selectedProduct && <EventRosterControl adminUser={adminUser} productId={selectedProduct} saved={Boolean(products.find((product) => product.id === selectedProduct)?.leaderEmail)} />}
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
            {draft.category === 'SERVICES'
              ? <label className="FormLabel">Pricing<select className="FormInput" value={draft.pricingMode} onChange={(event) => updateDraft('pricingMode', event.target.value)}>{Object.entries(PRICING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              : <p className="text_container text_container_note">{{ MEMBERSHIP: draft.type === 'external' ? 'External link: bought through JustGo, not this shop.' : 'Membership is a fixed club-year price. It is never prorated or paid monthly.', SUBSCRIPTIONS: 'Subscription: monthly price for each month left to 1 March.', VOUCHERS: 'Voucher: a fixed price that issues a credit code.', EVENTS: 'Event ticket: a fixed price for the whole event or course.', MERCHANDISE: 'Merchandise: a fixed price per item.' }[draft.category]}</p>}
            {draft.pricingMode === 'subscription' && <>
              <label className="FormLabel AdminCheckbox"><input type="checkbox" checked={draft.allowMonthly === true} onChange={(event) => updateDraft('allowMonthly', event.target.checked)} /> Allow monthly payments</label>
              <p className="text_container text_container_note">{draft.allowMonthly ? 'Customers can pay monthly by direct debit, or pay up front to 1 March.' : 'Customers pay up front for the months left until 1 March.'}</p>
              <label className="FormLabel AdminCheckbox"><input type="checkbox" checked={draft.hasAnnualDiscount} onChange={(event) => updateDraft('hasAnnualDiscount', event.target.checked)} /> 20% off when paid up front</label>
            </>}
            {draft.membershipRule && <>
              <label className="FormLabel">Membership<select className="FormInput" value={draft.membershipRule} onChange={(event) => updateDraft('membershipRule', event.target.value)}>{Object.entries(MEMBERSHIP_RULE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <p className="text_container text_container_note">{MEMBERSHIP_RULE_NOTES[draft.membershipRule]}</p>
            </>}
            <label className="FormLabel">Product image<input key={fileInputKey} className="FormInput" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(event) => { setImageFile(event.target.files?.[0] || null); setMessage(''); setError(''); }} /></label>
            <button type="button" className="EditorCommand" onClick={handleImageUpload} disabled={!imageFile || uploading}>
              {uploading ? <Loader2 className="IconMd animate-spin" /> : <Upload className="IconMd" />} {uploading ? `Uploading ${imageFile?.name || 'image'}…` : 'Upload image'}
            </button>
            {imageFile && !uploading && <p className="StatusText" role="status">Not uploaded yet: {imageFile.name}</p>}
            {draft.imageUrl && <img className="AdminImagePreview" src={draft.imageUrl} alt="Product preview" />}
            {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
            <button className="FormSubmitButton" type="submit" disabled={uploading || reservingId || saving}><Save className="IconMd" /> {saving ? 'Saving...' : 'Save product'}</button>
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
