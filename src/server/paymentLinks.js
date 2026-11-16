import crypto from 'node:crypto';
import { splitLinkKey } from '../utils/failedPayments.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const createPaymentLink = async (db, kind, id, tokenHash) => {
  const key = crypto.randomBytes(16).toString('base64url');
  await db.collection('paymentLinks').doc(hash(key)).create({ kind, id, tokenHash });
  return key;
};

/** Old emails keep working; neither form stores a plaintext access token. */
export const resolvePaymentLink = async (db, key, kind) => {
  if (typeof key !== 'string') return null;
  const legacy = splitLinkKey(key);
  if (legacy) return { id: legacy.id, tokenHash: hash(legacy.token) };
  if (!/^[A-Za-z0-9_-]{22}$/.test(key) || !db) return null;
  const link = (await db.collection('paymentLinks').doc(hash(key)).get()).data();
  return link?.kind === kind ? { id: link.id, tokenHash: link.tokenHash } : null;
};
