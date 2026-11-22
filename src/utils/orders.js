import { memberIsJunior } from './households.js';

/** Order money is whole pence. Catalogue prices, discount codes and voucher values stay in pounds. */
export const toPence = (pounds) => Math.round(Number(pounds || 0) * 100);
export const toPounds = (pence) => Number(pence || 0) / 100;

/** The Stripe, fulfilment and payment-failure groups a new order starts with. */
export const newOrderGroups = (sessionId = '') => ({
  stripe: { sessionId, mode: '', paymentIntentId: '', setupIntentId: '', processing: false, processingSince: null, reconciledAt: null },
  fulfilment: { recordsWritten: false, emailSent: false, emailSentAt: null, emailSendingUntil: null },
  paymentFailure: null
});

export const paymentFailureRecord = (previous, changes) => ({ at: null, code: '', declineCode: '', message: '', ...(previous || {}), ...changes });

/** Non-personal checkout fields an order keeps about each person once their records hold the rest. */
const REFERENCE_FIELDS = ['id', 'membershipId', 'householdId', 'lineIds', 'junior', 'returning', 'existingMember', 'grantMembership',
  'grantMembershipYears', 'heldClubYears', 'ownKitLineIds', 'erased'];

export const orderPersonReference = (person) => Object.fromEntries(REFERENCE_FIELDS
  .filter((key) => person[key] !== undefined).map((key) => [key, person[key]]));

export const UNRESOLVED_PERSON_NAME = 'Name not held';

/**
 * A recorded order's person reference filled in from the member and household records, for display. People still holding
 * their checkout details (unfulfilled orders, or older ones with no member record) are returned as they are; erased or
 * missing records give a neutral placeholder.
 */
export const resolvedOrderPerson = (person, member, household = {}) => {
  if (person.firstName || person.lastName) return person;
  if (person.erased || !member) return { ...person, firstName: UNRESOLVED_PERSON_NAME, lastName: '' };
  const junior = typeof person.junior === 'boolean' ? person.junior : memberIsJunior(member);
  const email = String(household.email || member.email || '').trim().toLowerCase();
  return { ...person, firstName: member.firstName || '', lastName: member.lastName || '', dob: member.dob || '',
    affiliationNumber: member.affiliationNumber || '', junior, fromRecord: true,
    ...(junior ? { guardian: { name: household.contactName || '', relationship: household.contactRelationship || '', email } } : { email }) };
};
