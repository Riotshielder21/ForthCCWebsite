import { isValidPersonName, normalisePhoneNumber, normaliseUkPostcode } from './personalDetails.js';

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Self-service contact changes. Names and dates of birth stay with staff; email changes are confirmed separately. */
export const validateDetailsUpdate = (body, household) => {
  if (typeof body?.phone === 'string' && body.phone.length > 40) return { error: 'Phone number must be 40 characters or fewer.' };
  if (typeof body?.address === 'string' && body.address.length > 300) return { error: 'Address must be 300 characters or fewer.' };
  if (typeof body?.postcode === 'string' && body.postcode.length > 12) return { error: 'Postcode must be 12 characters or fewer.' };
  const phone = normalisePhoneNumber(text(body?.phone, 40));
  const postcode = normaliseUkPostcode(text(body?.postcode, 12));
  const value = { phone: phone || text(body?.phone, 40), address: text(body?.address, 300), postcode: postcode || text(body?.postcode, 12) };
  if (!phone) return { error: 'Enter a valid phone number.' };
  if (!value.address) return { error: 'Enter the address.' };
  if (!postcode) return { error: 'Enter a valid UK postcode.' };
  if (household?.emergencyContact) {
    const contact = body?.emergencyContact || {};
    if (typeof contact.name === 'string' && contact.name.length > 120) return { error: 'Emergency contact name must be 120 characters or fewer.' };
    if (typeof contact.relationship === 'string' && contact.relationship.length > 60) return { error: 'Emergency contact relationship must be 60 characters or fewer.' };
    if (typeof contact.phone === 'string' && contact.phone.length > 40) return { error: 'Emergency contact phone number must be 40 characters or fewer.' };
    const emergencyPhone = normalisePhoneNumber(text(contact.phone, 40));
    value.emergencyContact = { name: text(contact.name, 120), relationship: text(contact.relationship, 60), phone: emergencyPhone || text(contact.phone, 40) };
    if (!value.emergencyContact.name || !value.emergencyContact.relationship || !value.emergencyContact.phone) {
      return { error: 'Enter the emergency contact name, relationship and phone.' };
    }
    if (!isValidPersonName(value.emergencyContact.name)) return { error: 'Enter a valid emergency contact name.' };
    if (!emergencyPhone) return { error: 'Enter a valid emergency contact phone number.' };
  }
  return { value };
};

/** Field names that differ, for the audit record (values are not copied into the audit). */
export const changedFields = (before, after) => Object.keys(after)
  .filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after[key]));

export const managedByJustgo = (member) => member?.justgoSyncStatus === 'synced' || member?.renewalMethod === 'justgo';
