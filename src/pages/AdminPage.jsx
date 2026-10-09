import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import { ImagePlus, LogOut, Save, Trash2 } from 'lucide-react';
import { auth, signInWithWorkspace } from '../utils/firebase';
import { removeProduct, saveProduct, seedProducts, uploadProductImage } from '../utils/content';
import { savePageContent } from '../utils/content';
import { CATEGORIES, PRODUCTS } from '../constants/products';
import { PAGE_CONTENT } from '../constants/pageContent';
import { usePageContent } from '../utils/PageContentContext';
import { apiUrl } from '../utils/api';

const EMPTY_PRODUCT = {
  id: '',
  name: '',
  category: 'SERVICES',
  basePrice: 0,
  description: '',
  type: 'annual-oneoff',
  hasAnnualDiscount: false,
  imageUrl: ''
};

const EDITABLE_FIELDS = ['name', 'category', 'basePrice', 'description', 'type', 'imageUrl'];

export default function AdminPage({ products, onProductsChange }) {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [draft, setDraft] = useState(EMPTY_PRODUCT);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSavingPage, setIsSavingPage] = useState(false);
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [pullRequest, setPullRequest] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [formDraft, setFormDraft] = useState({ name: '', description: '', fields: 'Name\nEmail\nResponse' });
  const [selectedPage, setSelectedPage] = useState('home');
  const savedPageContent = usePageContent(selectedPage);

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const [pageDraft, setPageDraft] = useState(null);
  const updatePageDraft = (field, value) => {
    const next = { ...(pageDraft || savedPageContent), [field]: value };
    setPageDraft(next);
    try {
      localStorage.setItem(`fcc-page-preview:${selectedPage}`, JSON.stringify(next));
    } catch {
      setError('Live preview storage is unavailable in this browser.');
    }
  };

  const handleLogin = async () => {
    setError('');
    if (!auth) {
      setError('Sign-in is unavailable until Firebase is configured.');
      return;
    }
    try {
      const user = await signInWithWorkspace();
      const token = await user.getIdTokenResult(true);
      if (token.claims.admin !== true) {
        await signOut(auth);
        throw new Error('This account is not an approved shop editor.');
      }
      setIsSignedIn(true);
      setAdminUser(user);
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

  const handleSavePage = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSavingPage(true);
    try {
      const idToken = await adminUser.getIdToken(true);
      const result = await savePageContent(selectedPage, pageDraft || savedPageContent, idToken);
      setMessage(`Draft saved on ${result.branch} (${result.commit.slice(0, 7)}). Review it in the preview, then use “Save to web / Create PR”.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSavingPage(false);
    }
  };

  const handleCreatePR = async () => {
    setError('');
    setMessage('');
    setIsCreatingPR(true);
    try {
      const idToken = await adminUser.getIdToken(true);
      await savePageContent(selectedPage, pageDraft || savedPageContent, idToken);
      const response = await fetch(apiUrl('/api/admin/create-content-pr'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create review PR.');
      setPullRequest(result);
      setMessage(`Pull request #${result.number} is ready for review.${result.notificationSent ? ' Email sent to Riotshielder21@gmail.com.' : ' PR created; email notification could not be sent.'}`);
    } catch (prError) {
      setError(prError.message);
    } finally {
      setIsCreatingPR(false);
    }
  };

  const editProduct = (product) => {
    setSelectedProduct(product.id);
    setDraft({ ...EMPTY_PRODUCT, ...product });
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
      await saveProduct(product);
      onProductsChange(products.some((item) => item.id === product.id)
        ? products.map((item) => item.id === product.id ? product : item)
        : [...products, product]);
      setMessage(`${product.name || 'Product'} saved.`);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const handleDelete = async () => {
    if (!selectedProduct || !window.confirm('Remove this product from the shop?')) return;
    try {
      await removeProduct(selectedProduct);
      onProductsChange(products.filter((product) => product.id !== selectedProduct));
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
    try {
      await seedProducts(PRODUCTS);
      onProductsChange(PRODUCTS);
      setMessage('The starter catalog has been copied to the shared catalog.');
    } catch (seedError) {
      setError(seedError.message);
    }
  };

  if (!isSignedIn) {
    return (
      <div className="SectionHero PageFadeIn">
        <div className="FormContainer AdminLogin">
          <span className="ShopItemEyebrow">Content Management</span>
          <h2 className="ContentTitle SpaceT2">Shop editor</h2>
          <p className="ContentBody SpaceB6">Sign in with an approved Forth Canoe Club Google Workspace account to manage the shared shop catalog.</p>
          <form onSubmit={(event) => { event.preventDefault(); handleLogin(); }} className="SpaceY4">
            {error && <p className="StatusText StatusTextError">{error}</p>}
            <button className="FormSubmitButton" type="submit">Continue with Google</button>
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
            <span className="ShopItemEyebrow">Content Management</span>
            <h2 className="PageTitle SpaceT2">Shop editor</h2>
            <p className="PageIntro">Page drafts go to the review branch. Use Save to web to open a pull request; merging to main publishes the approved update.</p>
          </div>
          <button className="MobileMenuButton AdminSignOut" onClick={() => { signOut(auth); setAdminUser(null); setIsSignedIn(false); }}> <LogOut className="IconMd" /> Sign out</button>
        </div>
      </div>
      <div className="SectionBottom">
        <div className="AdminLayout">
          <aside className="ContentPanel AdminProductList">
            <div className="AdminListHeader"><h3 className="ContentTitle">Products</h3><button className="PrimaryActionButtonCompact" onClick={startNewProduct}>New</button></div>
            <button className="ContentLink AdminSeedButton" onClick={handleSeed}>Copy starter catalog</button>
            <div className="AdminProducts">
              {products.map((product) => <button key={product.id} className={`AdminProduct ${selectedProduct === product.id ? 'is-selected' : ''}`} onClick={() => editProduct(product)}><strong>{product.name}</strong><span>{product.category}</span></button>)}
            </div>
          </aside>
          <form className="ContentPanel AdminEditor" onSubmit={handleSave}>
            <div className="AdminListHeader"><h3 className="ContentTitle">{selectedProduct ? 'Edit product' : 'New product'}</h3>{selectedProduct && <button type="button" className="CartRemoveButton" onClick={handleDelete} aria-label="Remove product"><Trash2 className="IconMd" /></button>}</div>
            {EDITABLE_FIELDS.map((field) => (
              <label className="FormLabel" key={field}>{field === 'basePrice' ? 'Price' : field}
                {field === 'description' ? <textarea className="FormInput" rows="4" value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)} required /> : field === 'category' || field === 'type' ? <select className="FormInput" value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)}>{(field === 'category' ? CATEGORIES.filter((category) => category !== 'ALL') : ['external', 'voucher', 'annual-oneoff', 'yearly-service', 'subscription']).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input className="FormInput" type={field === 'basePrice' ? 'number' : 'text'} min={field === 'basePrice' ? '0' : undefined} step={field === 'basePrice' ? '0.01' : undefined} value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)} required={field !== 'imageUrl'} />}
              </label>
            ))}
            <label className="FormLabel AdminCheckbox"><input type="checkbox" checked={draft.hasAnnualDiscount} onChange={(event) => updateDraft('hasAnnualDiscount', event.target.checked)} /> Annual discount applies</label>
            <label className="FormLabel">Product image<input className="FormInput" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} /></label>
            {draft.imageUrl && <img className="AdminImagePreview" src={draft.imageUrl} alt="Product preview" />}
            {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
            <button className="FormSubmitButton" type="submit"><Save className="IconMd" /> Save product</button>
            <p className="ContentBody ContentBodyNote"><ImagePlus className="IconSm" /> PNG, JPG, or WebP up to 5 MB.</p>
          </form>
        </div>
        <form className="ContentPanel AdminFormBuilder SpaceT6" onSubmit={handleCreateForm}>
          <div className="AdminListHeader"><div><span className="ShopItemEyebrow">Google Workspace</span><h3 className="ContentTitle SpaceT2">Create a form</h3></div></div>
          <p className="ContentBody SpaceB4">Creates one response spreadsheet in the current club-year folder on the Shared Drive.</p>
          <label className="FormLabel">Form name<input className="FormInput" required value={formDraft.name} onChange={(event) => setFormDraft({ ...formDraft, name: event.target.value })} /></label>
          <label className="FormLabel">Description<textarea className="FormInput" rows="2" value={formDraft.description} onChange={(event) => setFormDraft({ ...formDraft, description: event.target.value })} /></label>
          <label className="FormLabel">Fields, one per line<textarea className="FormInput" rows="5" required value={formDraft.fields} onChange={(event) => setFormDraft({ ...formDraft, fields: event.target.value })} /></label>
          <button className="FormSubmitButton" type="submit">Create form and sheet</button>
        </form>
        <section className="ContentPanel AdminPageEditor SpaceT6">
          <div className="AdminListHeader">
            <div><span className="ShopItemEyebrow">Website pages</span><h3 className="ContentTitle SpaceT2">Edit page content</h3></div>
            <label className="AdminPageSelector">Page<select className="FormInput" value={selectedPage} onChange={(event) => { setSelectedPage(event.target.value); setPageDraft(null); setMessage(''); }}>
              {Object.entries(PAGE_CONTENT).map(([id, page]) => <option value={id} key={id}>{page.label}</option>)}
            </select></label>
          </div>
          <p className="ContentBody SpaceB4">Save a draft to the review branch and check the preview. When ready, create a pull request for review; only merging it to main makes the change live.</p>
          <div className="AdminPageEditorGrid">
            <form className="AdminPageFields" onSubmit={handleSavePage}>
              {Object.entries(PAGE_CONTENT[selectedPage].fields).map(([key, definition]) => (
                <label className="FormLabel" key={key}>{definition.label}
                  {definition.multiline
                    ? <textarea className="FormInput" rows={Math.min(8, Math.max(3, String(pageDraft?.[key] ?? savedPageContent[key]).split('\n').length + 1))} value={pageDraft?.[key] ?? savedPageContent[key]} onChange={(event) => updatePageDraft(key, event.target.value)} />
                    : <input className="FormInput" value={pageDraft?.[key] ?? savedPageContent[key]} onChange={(event) => updatePageDraft(key, event.target.value)} />}
                </label>
              ))}
              <div className="AdminPageActions">
                <button className="FormSubmitButton" type="submit" disabled={isSavingPage}>
                  <Save className="IconMd" /> {isSavingPage ? 'Saving draft…' : `Save ${PAGE_CONTENT[selectedPage].label} draft`}
                </button>
                <button className="PrimaryActionButton" type="button" onClick={handleCreatePR} disabled={isCreatingPR}>
                  {isCreatingPR ? 'Creating PR…' : 'Save to web / Create PR'}
                </button>
                {pullRequest?.url && <a className="ContentLink" href={pullRequest.url} target="_blank" rel="noreferrer">Open pull request #{pullRequest.number}</a>}
              </div>
            </form>
            <iframe className="AdminPagePreview" title={`${PAGE_CONTENT[selectedPage].label} page preview`} src={`/_preview/${encodeURIComponent(selectedPage)}`} />
          </div>
        </section>
      </div>
    </div>
  );
}
