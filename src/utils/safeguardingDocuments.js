import { getDownloadURL, getMetadata, listAll, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase.js';

export const MAX_SAFEGUARDING_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOCUMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.pdf$/i;

export const listSafeguardingDocuments = async () => {
  if (!storage) throw new Error('Document storage is unavailable.');
  const { items } = await listAll(ref(storage, 'safeguarding'));
  return Promise.all(items.map(async (item) => {
    const [metadata, url] = await Promise.all([getMetadata(item), getDownloadURL(item)]);
    return {
      name: item.name,
      title: metadata.customMetadata?.title || item.name,
      updatedAt: metadata.updated || '',
      url
    };
  }));
};

export const uploadSafeguardingDocument = async ({ file, title, replaceName = '' }) => {
  if (!storage) throw new Error('Document storage is unavailable.');
  if (!file || file.type !== 'application/pdf') throw new Error('Choose a PDF document.');
  if (file.size > MAX_SAFEGUARDING_DOCUMENT_BYTES) throw new Error('Safeguarding PDFs must be 10 MB or smaller.');
  const label = typeof title === 'string' ? title.trim() : '';
  if (!label || label.length > 120) throw new Error('Enter a document title of 1 to 120 characters.');
  const name = replaceName || `${crypto.randomUUID()}.pdf`;
  if (!DOCUMENT_NAME.test(name)) throw new Error('Choose a valid safeguarding document to replace.');
  const documentRef = ref(storage, `safeguarding/${name}`);
  await uploadBytes(documentRef, file, {
    contentType: 'application/pdf',
    customMetadata: { title: label }
  });
  return { name, title: label, url: await getDownloadURL(documentRef) };
};
