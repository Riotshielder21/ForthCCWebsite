import { membershipActivity } from './membership.js';
import { itemLabel } from './inventory.js';
import { memberIsJunior } from './households.js';
import { checkLabel } from './safeguarding.js';

export const reportDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string') {
    const british = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (british) {
      const [, day, month, year] = british;
      const parsed = new Date(`${year}-${month}-${day}T23:59:59.999Z`);
      if (parsed.getUTCDate() !== Number(day) || parsed.getUTCMonth() + 1 !== Number(month)) return null;
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
    const parsed = new Date(value.length === 10 ? `${value}T23:59:59.999Z` : value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return null;
};

export const memberState = (fields, now = new Date()) => {
  const expiry = reportDate(fields.expiry);
  if (expiry && new Date(expiry) < now) return 'Expired';
  if (fields.status && !/^active$/i.test(fields.status)) return fields.status;
  return expiry ? 'Current' : 'Unverified expiry';
};

export const subscriptionWarning = (fields) => Boolean(fields.stripeSubscriptionId
  || (fields.items || []).some((item) => item.type === 'subscription'));

// `member` is the person's current membership record: existing members only confirm a few details at checkout,
// so the rest (contact, emergency, medical) is read from their record.
export const personReport = (person, items, member = {}) => {
  const household = member.household || {};
  const junior = person.junior === true || Boolean(member.emergencyNote) || memberIsJunior(member);
  const guardian = person.guardian || {};
  const emergency = person.emergencyContact || {};
  const memberEmergency = member.emergencyContact || {};
  const contact = (own, guardianValue, fromRecord, householdValue) => householdValue || (junior ? guardianValue : own) || fromRecord || '';
  const householdEmergency = household.emergencyContact || {};
  const juniorEmergency = [household.contactName, household.contactRelationship, household.phone].filter(Boolean).join(', ');
  return {
    name: `${person.firstName || ''} ${person.lastName || ''}`.trim(), dob: person.dob || member.dob || '',
    kind: junior ? 'Under 18' : 'Adult', returningMember: person.returning === true,
    items: (person.lineIds || []).map((lineId) => items.find((item) => item.lineId === lineId)).filter(Boolean).map(itemLabel),
    email: contact(person.email, guardian.email, member.email, household.email), phone: contact(person.phone, guardian.phone, member.phone, household.phone),
    address: [contact(person.address, guardian.address, member.address, household.address), contact(person.postcode, guardian.postcode, member.postcode, household.postcode)].filter(Boolean).join(', '),
    emergencyContact: person.emergencyNote || member.emergencyNote
      || (junior ? juniorEmergency : [householdEmergency.name || emergency.name || memberEmergency.name,
        householdEmergency.relationship || emergency.relationship || memberEmergency.relationship,
        householdEmergency.phone || emergency.phone || memberEmergency.phone].filter(Boolean).join(', ')),
    medical: person.medical || member.medical || '', swimming: person.swimming || member.swimming || '',
    photoConsent: person.photoConsent === true || member.photoConsent === true,
    membershipId: person.membershipId || '', existingMember: person.existingMember === true,
    events: (person.lineIds || []).map((lineId) => items.find((item) => item.lineId === lineId)).filter((item) => item?.category === 'EVENTS')
      .map((item) => ({ name: String(item.name || item.id || ''), ...(item.eventSchedule ? { eventSchedule: item.eventSchedule } : {}) }))
  };
};

export const orderReport = (id, fields, members = new Map()) => ({
  id,
  email: fields.email || '',
  status: fields.status || 'unknown',
  total: Number.isFinite(Number(fields.total)) ? Number(fields.total) : 0,
  createdAt: reportDate(fields.createdAt),
  paidAt: reportDate(fields.paidAt),
  // Orders for several people hold one Stripe subscription per person (or family).
  stripeSubscriptionId: [...new Set([fields.stripeSubscriptionId, ...(Array.isArray(fields.stripeSubscriptionIds) ? fields.stripeSubscriptionIds : [])].filter(Boolean))].join(', '),
  ...(fields.subscriptionSetupNeedsStaff === true ? { monthlyPaymentSetupFailed: true } : {}),
  stripePaymentIntentId: fields.stripePaymentIntentId || '',
  subscriptionWarning: subscriptionWarning(fields),
  items: (Array.isArray(fields.items) ? fields.items : []).map((item) => ({
    name: itemLabel(item), category: String(item.category || ''),
    type: String(item.type || ''), price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    ...(item.eventSchedule ? { eventSchedule: item.eventSchedule } : {})
  })),
  people: (Array.isArray(fields.people) ? fields.people : []).map((person) => personReport(person, Array.isArray(fields.items) ? fields.items : [], members.get(person.membershipId) || {}))
});


// One register for JustGo-synced and website members; legacy register rows (name, expiry) map onto the same shape.
const justgoState = (fields) => {
  const upload = fields.justgoUpload || {};
  if (fields.justgoSyncStatus === 'pending') {
    if (upload.needsStaff) return 'Needs staff upload';
    if (upload.status === 'invited') return 'Invitation sent';
    if (upload.status === 'manual') return 'Added by staff, awaiting sync';
    return 'Awaiting upload';
  }
  return fields.justgoSyncStatus === 'synced' || fields.affiliationNumber ? 'In JustGo' : 'Not in JustGo';
};

export const membershipReport = (id, fields, now = new Date(), household = fields.household || {}) => {
  const upload = fields.justgoUpload || {};
  const emergency = fields.emergencyContact || {};
  const guardian = fields.guardian || {};
  const householdEmergency = household.emergencyContact || {};
  const junior = memberIsJunior(fields, now);
  const expiry = reportDate(fields.validUntil || fields.expiry);
  return {
    id, name: `${fields.firstName || ''} ${fields.lastName || ''}`.trim() || fields.name || '', email: household.email || fields.email || '',
    affiliationNumber: fields.affiliationNumber || '', tier: fields.membershipTier || '',
    includedWith: fields.membershipIncludedWith?.name || '',
    status: membershipActivity({ status: fields.status, validUntil: expiry, renewalMethod: fields.renewalMethod, justgoSyncStatus: fields.justgoSyncStatus, lastJustgoSync: reportDate(fields.lastJustgoSync) }, now) === 'awaiting-renewal'
      ? 'Awaiting renewal'
      : memberState({ status: fields.status, expiry: fields.validUntil || fields.expiry }, now),
    expiry, lastUpdated: reportDate(fields.updatedAt || fields.lastUpdated), lastJustgoSync: reportDate(fields.lastJustgoSync), source: fields.source || (fields.affiliationNumber ? 'justgo' : ''),
    justgoSync: fields.justgoSyncStatus || '', renewalMethod: fields.renewalMethod || '',
    justgo: justgoState(fields),
    uploadAttempts: upload.attempts || 0, uploadFailures: upload.failures || 0, uploadError: upload.lastError || '',
    inviteExpiresAt: reportDate(upload.inviteExpiresAt), lastUploadAttempt: reportDate(upload.lastAttemptAt),
    firstName: fields.firstName || '', lastName: fields.lastName || '', postcode: household.postcode || fields.postcode || '',
    dob: fields.dob || '', phone: household.phone || fields.phone || '',
    address: [household.address || fields.address, household.postcode || fields.postcode].filter(Boolean).join(', '),
    emergencyContact: junior
      ? [household.contactName, household.contactRelationship, household.phone].filter(Boolean).join(', ')
      : [householdEmergency.name || emergency.name, householdEmergency.relationship || emergency.relationship,
        householdEmergency.phone || emergency.phone].filter(Boolean).join(', '),
    parent: [household.contactName || guardian.name, household.contactRelationship || guardian.relationship, household.phone || guardian.phone].filter(Boolean).join(', '),
    householdId: fields.householdId || '',
    medical: fields.medical || '', swimming: fields.swimming || '',
    photoConsent: fields.consents?.photoVideo?.accepted === true || fields.photoConsent === true,
    pvg: checkLabel(fields.checks?.pvg?.expiresOn, now), safeguarding: checkLabel(fields.checks?.safeguarding?.expiresOn, now),
    familyGroup: fields.familyGroup || '', stripeSubscriptionIds: (Array.isArray(fields.subscriptionIds) ? fields.subscriptionIds : []).join(', '), privileges: [...new Set((fields.privileges || []).filter((privilege) => !privilege.endedAt).map((privilege) => String(privilege.name || privilege.productId || '')))],
    history: (fields.history || []).map((entry) => ({ orderRef: entry.orderRef || '', paidAt: reportDate(entry.paidAt), items: (entry.items || []).map((item) => String(item.name || item.id || '')) }))
  };
};
export const memberReport = membershipReport;

export const eventAttendeeHeaders = ['Event', 'Schedule', 'Attendee', 'Date of birth', 'Phone', 'Email', 'Emergency contact', 'Medical', 'Swimming', 'Photo consent', 'Order ID', 'Order status', 'Paid'];

// One row per attendee per event ticket; orders without recorded people still list the ticket.
export const eventAttendeeRows = (records, scheduleLabel) => records.flatMap((record) => {
  const attendees = (record.people || []).flatMap((person) => (person.events || []).map((event) => [
    event.name, event.eventSchedule ? scheduleLabel(event.eventSchedule) : '', person.name, person.dob, person.phone, person.email,
    person.emergencyContact, person.medical, person.swimming, person.photoConsent ? 'Yes' : 'No', record.id, record.status, record.paidAt
  ]));
  return attendees.length ? attendees : (record.items || []).map((item) => [
    item.name, item.eventSchedule ? scheduleLabel(item.eventSchedule) : '', 'Attendee details not recorded', '', '', record.email, '', '', '', '', record.id, record.status, record.paidAt
  ]);
});

export const justgoUploadHeaders = ['Membership ID', 'First name', 'Last name', 'Date of birth', 'Email', 'Phone', 'Address', 'Postcode', 'Tier', 'Valid until', 'Affiliation number', 'Failed attempts', 'Last problem', 'Emergency contact', 'Parent or guardian', 'Medical'];

// The staff list: members the automatic upload could not complete, with everything needed to add them by hand.
export const justgoUploadRows = (records) => records.filter((record) => record.justgo === 'Needs staff upload').map((record) => [
  record.id, record.firstName, record.lastName, record.dob, record.email, record.phone, record.address.split(', ')[0] || '', record.postcode,
  record.tier, record.expiry, record.affiliationNumber, record.uploadFailures, record.uploadError, record.emergencyContact, record.parent, record.medical
]);

export const uniqueReportEmails = (records) => [...new Set(records.map((record) => String(record.email || '').trim().toLowerCase())
  .filter((email) => /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)))].sort();

export const reportCsv = (headers, rows) => [headers, ...rows].map((row) => row.map((value) => {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}).join(',')).join('\r\n');