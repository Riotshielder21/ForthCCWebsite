import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db } from './firebase';
import { storage } from './firebase';
import { apiUrl, apiFetch } from './api';
import { isLockedProduct } from './tripDiscount';
import { normaliseProduct, resolveCatalogue, validateEventSchedule } from './catalogue';
import { cleanStockFields } from './inventory';
import { PRODUCTS } from '../constants/products';
import { prepareResponsiveImage } from './imageProcessing';
import { validateImagePlaceholder, validateImageSources } from './responsiveImages';

export const subscribeToProducts = (onProducts, onError) => {
  if (!db) return () => {};

  return onSnapshot(
    collection(db, 'products'),
    (snapshot) => {
      if (snapshot.metadata.fromCache && snapshot.empty) {
        console.warn('Live product catalogue is unavailable; retaining previously downloaded products.');
        return;
      }
      onProducts(resolveCatalogue(PRODUCTS, snapshot.docs.map((productDoc) => ({ ...productDoc.data(), id: productDoc.id }))));
    },
    onError
  );
};

export { loadPublishedPageContent } from './publicContent';

export const loadSavedPageDrafts = async (idToken) => {
  const response = await apiFetch(apiUrl('/api/admin/page-drafts'), {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: 'no-store'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not check saved page drafts.');
  if (!result.pages || typeof result.pages !== 'object' || Array.isArray(result.pages)) throw new Error('Invalid saved page drafts response.');
  return result;
};

export const savePageContent = async (pageId, content, idToken) => {
  const response = await apiFetch(apiUrl('/api/admin/publish-page'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ pageId, content })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not publish page content.');
  return result;
};

export const reserveProductId = async (idToken) => {
  const response = await apiFetch(apiUrl('/api/admin/products/reserve-id'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not create a product ID.');
  return result.id;
};

export const saveProduct = async (product) => {
  if (!db) throw new Error('Content database is unavailable.');

  const { id, ...productData } = normaliseProduct(product);
  if (productData.pricingMode !== 'subscription') productData.hasAnnualDiscount = false;
  if (product.category === 'EVENTS') {
    productData.eventSchedule = validateEventSchedule(product.eventSchedule);
  }
  // Sizes belong to the uploaded image; a typed-in image link has none. Empty values overwrite older sizes on merge.
  // Starter products have no image fields, so restoring them leaves an uploaded image and its sizes untouched.
  if (Object.hasOwn(product, 'imageUrl')) {
    const hasImage = Boolean(productData.imageUrl);
    productData.imageSources = hasImage ? validateImageSources(product.imageSources) : [];
    productData.imagePlaceholder = hasImage ? validateImagePlaceholder(product.imagePlaceholder) : '';
  }
  await setDoc(doc(db, 'products', id), {
    ...productData,
    ...cleanStockFields(product),
    active: true,
    updatedAt: serverTimestamp()
  }, { merge: true });
};

export const removeProduct = async (id, tripDiscounts) => {
  if (!db) throw new Error('Content database is unavailable.');
  if (isLockedProduct(id, tripDiscounts)) throw new Error('This product gives the automatic trip discount, so it cannot be removed.');
  await setDoc(doc(db, 'products', id), { active: false, updatedAt: serverTimestamp() }, { merge: true });
};

export const seedProducts = async (products) => {
  await Promise.all(products.map((product) => saveProduct(product)));
};

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const extensionFor = (type) => ({ 'image/webp': 'webp', 'image/png': 'png' })[type] || 'jpg';

/**
 * Resizes a photo in the browser and uploads every size. File names are unique, so visitors' browsers can keep
 * each one for a year without checking for changes. Returns the fallback link plus the sizes and preview.
 */
const uploadResponsiveImage = async (folder, file, preset) => {
  if (!storage) throw new Error('Image storage is unavailable.');
  const prepared = await prepareResponsiveImage(file, preset);
  const id = crypto.randomUUID();
  const upload = async (blob, name) => {
    const imageRef = ref(storage, `${folder}/${id}-${name}.${extensionFor(blob.type)}`);
    await uploadBytes(imageRef, blob, { contentType: blob.type, cacheControl: IMMUTABLE_CACHE });
    return getDownloadURL(imageRef);
  };
  const [sources, fallbackUrl] = await Promise.all([
    Promise.all(prepared.renditions.map(async ({ blob, width, height }) => ({ url: await upload(blob, width), width, height }))),
    prepared.fallback.blob ? upload(prepared.fallback.blob, `${prepared.fallback.width}-fallback`) : null
  ]);
  return {
    imageUrl: fallbackUrl || sources.find((source) => source.width === prepared.fallback.reuse).url,
    sources,
    placeholder: prepared.placeholder,
    sourceWidth: prepared.sourceWidth
  };
};

export const uploadProductImage = (productId, file) => uploadResponsiveImage(`products/${productId}`, file, 'content');

export const uploadBannerImage = (pageId, file) => uploadResponsiveImage(`pages/${pageId}/banner`, file, 'banner');

export const uploadPageImage = (pageId, tileId, file, preset = 'content') => uploadResponsiveImage(`pages/${pageId}/${tileId}`, file, preset);
