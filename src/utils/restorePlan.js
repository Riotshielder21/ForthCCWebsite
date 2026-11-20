import { identityEmails } from './erasure.js';
import { personLookupKeys } from './privacy.js';

const millis = (value) => (typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value).getTime());
const normaliseEmail = (value) => String(value || '').trim().toLowerCase();
const stable = (value) => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item));
const segments = (path) => path.split('/').slice(-2);

/** What GDPR erasures after the restore point removed, from the live audit log. Entries hold keyed hashes, not details. */
export const erasuresSince = (auditEntries, snapshotTime) => {
  const after = auditEntries.filter((entry) => entry.action === 'gdpr-erasure' && millis(entry.at) > millis(snapshotTime));
  return {
    count: after.length,
    lookupKeys: new Set(after.flatMap((entry) => entry.lookupKeys || [])),
    orders: new Set(after.flatMap((entry) => entry.summary?.ordersRedacted || []))
  };
};

// Erasure records every erased member by name and date of birth (and membership number), so those identify them here.
// An email address only marks other records as theirs when nobody staying uses it, since families share addresses.
const erasedPeople = (restored, erasures, secret) => {
  const households = new Map(restored.filter(({ path }) => segments(path)[0] === 'households').map(({ path, data }) => [segments(path)[1], data]));
  const members = restored.filter(({ path }) => segments(path)[0] === 'memberships').map(({ path, data }) => ({
    id: segments(path)[1], data, emails: identityEmails(data, households.get(data.householdId) || data.household || {})
  }));
  const erased = members.filter(({ data }) => personLookupKeys(secret, { firstName: data.firstName, lastName: data.lastName, dob: data.dob,
    affiliationNumber: data.affiliationNumber }).some((key) => erasures.lookupKeys.has(key)));
  const staying = new Set(members.filter((member) => !erased.includes(member)).flatMap((member) => member.emails));
  return {
    members: new Set(erased.map(({ id }) => id)),
    households: new Set(erased.map(({ data }) => data.householdId).filter(Boolean)),
    emails: new Set(erased.flatMap((member) => member.emails).filter((email) => !staying.has(email)))
  };
};

const namesErased = (path, data, people, erasures) => {
  const [collection, id] = segments(path);
  if ((collection === 'memberships' && people.members.has(id)) || (collection === 'households' && people.households.has(id))) return true;
  if ([id, data.orderRef, data.id].some((value) => erasures.orders.has(value))) return true;
  const memberIds = [data.membershipId, ...(Array.isArray(data.membershipIds) ? data.membershipIds : [])];
  const emails = [data.email, data.guardian?.email, data.payerEmail].map(normaliseEmail);
  return memberIds.some((member) => people.members.has(member)) || emails.some((email) => email && people.emails.has(email));
};

/**
 * Which documents from a restored copy may be written back to the live database. Anyone erased since the restore point
 * stays erased: documents naming them are kept out, and live documents an erasure redacted are never overwritten. Live
 * documents changed since the restore point are left as they are unless `overwriteChanged` is set.
 *
 * `restored` lists `{ path, data }`; `live` maps a path to `{ data, updateTime }` for documents that exist now.
 */
export const restorePlan = ({ restored, live, auditEntries, snapshotTime, secret, overwriteChanged = false }) => {
  const erasures = erasuresSince(auditEntries, snapshotTime);
  if (erasures.count && !secret) throw new Error('People were erased since the restore point. Set AUDIT_LOOKUP_SECRET so they stay erased.');
  const people = erasures.count ? erasedPeople(restored, erasures, secret) : { members: new Set(), households: new Set(), emails: new Set() };
  const plan = { write: [], unchanged: [], erased: [], changed: [], erasuresSince: erasures.count };
  for (const document of restored) {
    const current = live.get(document.path);
    if (current && stable(current.data) === stable(document.data)) plan.unchanged.push(document.path);
    else if (namesErased(document.path, document.data, people, erasures)
      || (current?.data.personalDataErasedAt && !document.data.personalDataErasedAt)) plan.erased.push(document.path);
    else if (current && millis(current.updateTime) > millis(snapshotTime) && !overwriteChanged) plan.changed.push(document.path);
    else plan.write.push(document);
  }
  return plan;
};
