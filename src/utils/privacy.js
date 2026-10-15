import { createHmac, createHash } from 'node:crypto';
import { itemLabel } from './inventory.js';
import { normaliseName } from './checkout.js';

/** `John Smith` -> `J*** S***`. */
export const maskName = (value) => String(value || '').trim().split(/\s+/).filter(Boolean).map((word) => `${word[0]}***`).join(' ');

/** `john@example.co.uk` -> `j***@e***.co.uk`. */
export const maskEmail = (value) => {
  const match = /^([^@\s]+)@([^@\s.]+)(\..+)$/.exec(String(value || '').trim().toLowerCase());
  return match ? `${match[1][0]}***@${match[2][0]}***${match[3]}` : '***';
};

export const maskMembershipNumber = (value) => {
  const text = String(value || '').trim();
  return text.length > 4 ? `***${text.slice(-3)}` : text ? '***' : '';
};

const normalise = (kind, value) => kind === 'name-dob' ? normaliseName(value) : String(value || '').trim().toLowerCase();

/** Keyed one-way hash, so an admin can find an entry from details a customer supplies but cannot read the details back. */
export const lookupKey = (secret, kind, value) => createHmac('sha256', secret).update(`${kind}:${normalise(kind, value)}`).digest('hex');

/** Every key an erasure lookup can match for one person; blank details produce no key. */
export const personLookupKeys = (secret, { email, firstName, lastName, dob, affiliationNumber } = {}) => [
  email && lookupKey(secret, 'email', email),
  firstName && lastName && dob && lookupKey(secret, 'name-dob', `${firstName} ${lastName}|${dob}`),
  affiliationNumber && lookupKey(secret, 'affiliation', affiliationNumber)
].filter(Boolean);

const orderPeople = (fields) => (Array.isArray(fields.people) ? fields.people : []).map((person) => ({
  email: person.junior ? person.guardian?.email : person.email, firstName: person.firstName, lastName: person.lastName, dob: person.dob
}));

/**
 * The audit record for a deleted order or member: a masked summary for display, keyed lookups for erasure requests,
 * and a hidden snapshot so the delete can be reversed until the person asks for GDPR erasure.
 */
export const deletionAuditEntry = ({ kind, id, fields, secret, adminUid, stripeAcknowledged = false }) => {
  const isOrder = kind === 'orders';
  const people = isOrder ? orderPeople(fields) : [{
    email: fields.junior ? fields.guardian?.email : fields.email, firstName: fields.firstName, lastName: fields.lastName, dob: fields.dob, affiliationNumber: fields.affiliationNumber
  }];
  const emails = [...new Set([fields.email, ...people.map((person) => person.email)].filter(Boolean))];
  const summary = isOrder
    ? { label: 'Order', maskedEmail: maskEmail(fields.email), people: people.map((person) => ({ name: maskName(`${person.firstName || ''} ${person.lastName || ''}`), email: maskEmail(person.email) })),
        total: Number(fields.total) || 0, status: fields.status || '', items: (fields.items || []).map(itemLabel), paidAt: fields.paidAt ?? null, createdAt: fields.createdAt ?? null }
    : { label: 'Member', maskedName: maskName(`${fields.firstName || ''} ${fields.lastName || ''}`) || maskName(fields.name), maskedEmail: maskEmail(fields.email),
        membershipNumber: maskMembershipNumber(fields.affiliationNumber), tier: fields.membershipTier || '', status: fields.status || '', validUntil: fields.validUntil ?? null };
  return {
    kind, adminUid, stripeAcknowledged,
    recordId: isOrder ? id : null,
    recordIdHash: createHash('sha256').update(id).digest('hex'),
    summary,
    lookupKeys: [...new Set([...emails.map((email) => lookupKey(secret, 'email', email)), ...people.flatMap((person) => personLookupKeys(secret, { ...person, email: '' })),
      ...people.map((person) => person.affiliationNumber).filter(Boolean).map((number) => lookupKey(secret, 'affiliation', number))])],
    snapshot: fields,
    personalDataErased: false
  };
};
