import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db } from './firebase';
import { storage } from './firebase';
import { PAGE_CONTENT } from '../constants/pageContent';
import { apiUrl } from './api';

export const subscribeToProducts = (onProducts, onError) => {
  if (!db) return () => {};

  return onSnapshot(
    collection(db, 'products'),
    (snapshot) => {
      onProducts(snapshot.docs.map((productDoc) => ({ id: productDoc.id, ...productDoc.data() })));
    },
    onError
  );
};

export const loadPublishedPageContent = (onContent, onError) => {
  let active = true;
  Promise.all(Object.keys(PAGE_CONTENT).map(async (pageId) => {
    try {
      const response = await fetch(`/content/pages/${pageId}.json`, { cache: 'no-cache' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return [pageId, {}];
      return [pageId, await response.json()];
    } catch (error) {
      onError?.(error);
      return [pageId, {}];
    }
  })).then((entries) => {
    if (active) onContent(Object.fromEntries(entries));
  }).catch(onError);

  return () => { active = false; };
};

export const savePageContent = async (pageId, content, idToken) => {
  const response = await fetch(apiUrl('/api/admin/publish-page'), {
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

export const saveProduct = async (product) => {
  if (!db) throw new Error('Content database is unavailable.');

  const { id, ...productData } = product;
  await setDoc(doc(db, 'products', id), {
    ...productData,
    updatedAt: serverTimestamp()
  }, { merge: true });
};

export const removeProduct = async (id) => {
  if (!db) throw new Error('Content database is unavailable.');
  await deleteDoc(doc(db, 'products', id));
};

export const seedProducts = async (products) => {
  await Promise.all(products.map((product) => saveProduct(product)));
};

export const uploadProductImage = async (productId, file) => {
  if (!storage) throw new Error('Image storage is unavailable.');
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller.');

  const imageRef = ref(storage, `products/${productId}/${file.name}`);
  await uploadBytes(imageRef, file, { contentType: file.type });
  return getDownloadURL(imageRef);
};
