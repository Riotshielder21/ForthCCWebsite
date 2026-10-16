import { normaliseName } from './checkout.js';

export const normaliseEmail = (value) => String(value || '').trim().toLowerCase();

/** Contact emails held on a member record; for juniors this is the guardian's. */
export const identityEmails = (fields, household = fields.household || {}) =>
  [...new Set([fields.email, fields.guardian?.email, household.email].map(normaliseEmail).filter(Boolean))];

/** Whether a member record is the person described by an erasure request. The membership number is optional. */
export const matchesIdentity = (fields, { email, firstName, lastName, dob, affiliationNumber }, household = fields.household || {}) => {
  const sameName = normaliseName(`${fields.firstName || ''} ${fields.lastName || ''}`) === normaliseName(`${firstName || ''} ${lastName || ''}`);
  const sameEmail = identityEmails(fields, household).includes(normaliseEmail(email));
  const given = String(affiliationNumber || '').trim().toLowerCase();
  const held = String(fields.affiliationNumber || '').trim().toLowerCase();
  return sameName && sameEmail && Boolean(dob) && fields.dob === dob && (!given || !held || given === held);
};

/** Everyone sharing the record's family membership, or just the record when it is not part of a family. */
export const familyOf = (records, record) => record.householdId
  ? records.filter((candidate) => candidate.householdId === record.householdId)
  : record.familyGroup ? records.filter((candidate) => candidate.familyGroup === record.familyGroup) : [record];

/** The order entry for an erased person keeps only references, never identifying details. */
export const redactOrderPerson = (person) => ({ id: person.id, lineIds: person.lineIds || [], membershipId: person.membershipId || '', erased: true });

/**
 * Field updates that strip an order of the erased people's details. The order itself, its items and its amount stay for the accounts.
 * The payer email goes too once it belongs only to erased people.
 */
export const redactOrder = (order, erasedMembershipIds, erasedEmails, erasedHouseholdIds = []) => {
  const erased = new Set(erasedMembershipIds);
  const gone = new Set([...erasedEmails].map(normaliseEmail));
  const erasedHouseholds = new Set(erasedHouseholdIds);
  const people = (Array.isArray(order.people) ? order.people : []).map((person) => {
    if (erased.has(person.membershipId)) return redactOrderPerson(person);
    if (!person.householdId || !erasedHouseholds.has(person.householdId)) return person;
    const { email, phone, address, postcode, guardian, emergencyContact, emergencyNote, familyGroup, ...details } = person;
    return details;
  });
  const stillUsed = new Set(people.filter((person) => !person.erased).flatMap((person) => [person.email, person.guardian?.email].map(normaliseEmail).filter(Boolean)));
  const payer = normaliseEmail(order.email);
  const emailErased = order.email !== '***' && gone.has(payer) && !stillUsed.has(payer);
  const changed = people.some((person, index) => person !== order.people[index]);
  if (!changed && !emailErased) return null;
  return { people, ...(emailErased ? { email: '***', receipt: {}, accessTokenHash: '', receiptViewTokenHash: '' } : {}), personalDataErasedAt: true };
};

const REQUIRED_SHARED = [['contactName', 'a contact name'], ['contactRelationship', 'the contact\'s relationship'], ['phone', 'a phone number'], ['address', 'an address'],
  ['postcode', 'a postcode'], ['emergencyName', 'an emergency contact name'], ['emergencyPhone', 'an emergency contact phone'], ['emergencyRelationship', 'the emergency contact\'s relationship']];

/** Problems with the replacement shared details required when a family member is erased but the family stays. */
export const sharedDetailsErrors = (details = {}) => [
  ...REQUIRED_SHARED.filter(([key]) => !String(details[key] || '').trim()).map(([, label]) => `Enter ${label}.`),
  ...(/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(String(details.email || '').trim()) ? [] : ['Enter a valid email address.'])
];

/** The update applied to each remaining family member so none still points at the erased person's details. */
export const sharedDetailsUpdate = (details) => ({
  contactName: details.contactName.trim(),
  contactRelationship: details.contactRelationship.trim(),
  email: details.email.trim().toLowerCase(),
  phone: details.phone.trim(),
  address: details.address.trim(),
  postcode: details.postcode.trim(),
  emergencyContact: { name: details.emergencyName.trim(), phone: details.emergencyPhone.trim(), relationship: details.emergencyRelationship.trim() }
});
