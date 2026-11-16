import crypto from 'node:crypto';

// Erased records stay suppressed for good; the address block only covers late Stripe webhooks, so a returning member can rejoin.
export const EMAIL_BLOCK_DAYS = 30;
export const emailBlockId = (email) => crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
export const suppressesNormalEmail = (record) => Boolean(record?.gdprErasurePending || record?.suppressNormalEmails || record?.payerErased);

export const normalEmailBlocked = async (db, email, record = {}) => {
  if (record.kind === 'gdpr-erasure') return false;
  const references = [db.collection('gdprEmailBlocks').doc(emailBlockId(email))];
  if (record.subscriptionId) references.push(db.collection('subscriptions').doc(record.subscriptionId));
  if (record.orderRef) references.push(db.collection('orders').doc(record.orderRef));
  for (const id of record.membershipIds || []) references.push(db.collection('memberships').doc(id));
  const documents = await db.getAll(...references);
  const block = documents[0].exists ? documents[0].data() : null;
  const blocked = Boolean(block) && !(block.expiresAt && block.expiresAt.toMillis() <= Date.now());
  return blocked || documents.slice(1).some((document) => suppressesNormalEmail(document.data()));
};
