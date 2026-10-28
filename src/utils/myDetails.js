const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Self-service contact changes. Names and dates of birth stay with staff; email changes are confirmed separately. */
export const validateDetailsUpdate = (body, household) => {
  const value = { phone: text(body?.phone, 40), address: text(body?.address, 300), postcode: text(body?.postcode, 12) };
  if (!value.phone) return { error: 'Enter a phone number.' };
  if (!value.address || !value.postcode) return { error: 'Enter the address and postcode.' };
  if (household?.emergencyContact) {
    const contact = body?.emergencyContact || {};
    value.emergencyContact = { name: text(contact.name, 120), relationship: text(contact.relationship, 60), phone: text(contact.phone, 40) };
    if (!value.emergencyContact.name || !value.emergencyContact.relationship || !value.emergencyContact.phone) {
      return { error: 'Enter the emergency contact name, relationship and phone.' };
    }
  }
  return { value };
};

/** Field names that differ, for the audit record (values are not copied into the audit). */
export const changedFields = (before, after) => Object.keys(after)
  .filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after[key]));

export const managedByJustgo = (member) => member?.justgoSyncStatus === 'synced' || member?.renewalMethod === 'justgo';
