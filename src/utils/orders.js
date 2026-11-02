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

const LEGACY_ORDER_FIELDS = ['total', 'discountCodeId', 'accessTokenHash', 'receiptViewTokenHash', 'stripeSessionId', 'stripeMode',
  'stripePaymentIntentId', 'stripeSetupIntentId', 'paymentProcessing', 'processingSince', 'reconciledAt', 'recordsWritten', 'emailSent',
  'emailSentAt', 'emailSendingUntil', 'lastPaymentFailureAt', 'lastPaymentFailureCode', 'lastPaymentFailureDeclineCode', 'paymentFailedAt',
  'failedAt', 'failure', 'receipt'];

const lineInPence = (item) => {
  if (!item || typeof item !== 'object') return item;
  const { price, monthlyAmount, tripDiscount, refunds, ...line } = item;
  return {
    ...line,
    ...(price !== undefined && line.pricePence === undefined ? { pricePence: toPence(price) } : {}),
    ...(monthlyAmount !== undefined && line.monthlyPence === undefined ? { monthlyPence: toPence(monthlyAmount) } : {}),
    ...(tripDiscount !== undefined && line.tripDiscountPence === undefined ? { tripDiscountPence: toPence(tripDiscount) } : {}),
    // Refunds were already recorded in pence.
    ...(Array.isArray(refunds) ? { refunds: refunds.map(({ amount, ...refund }) => ({ ...refund, amountPence: refund.amountPence ?? (Number(amount) || 0) })) } : {})
  };
};

/**
 * Version 2 of an order: money in pence, one receipt token, Stripe, fulfilment and payment-failure details grouped, the
 * legacy `receipt` dropped, and people reduced to references once the purchase is recorded on the member records.
 */
export const orderVersion2 = (fields) => {
  const items = Array.isArray(fields.items) ? fields.items.map(lineInPence) : null;
  const linesPence = (items || []).reduce((sum, item) => sum + (Number(item?.pricePence) || 0), 0);
  const totalPence = fields.totalPence ?? ('total' in fields ? toPence(fields.total) : linesPence);
  const discountPence = fields.discountPence ?? Math.max(0, linesPence - totalPence);
  const failed = ['lastPaymentFailureAt', 'lastPaymentFailureCode', 'lastPaymentFailureDeclineCode', 'paymentFailedAt', 'failedAt', 'failure'].some((key) => fields[key]);
  const recorded = fields.recordsWritten === true || fields.fulfilment?.recordsWritten === true;
  const people = Array.isArray(fields.people) ? fields.people : null;
  const references = recorded && people ? people.map((person) => person.membershipId
    ? orderPersonReference(person)
    : { ...orderPersonReference(person), firstName: person.firstName || '', lastName: person.lastName || '' }) : null;
  const membershipIds = recorded && people ? [...new Set([...(fields.membershipIds || []), ...people.map((person) => person.membershipId).filter(Boolean)])] : null;
  const set = {
    ...(items ? { items } : {}),
    totalPence, subtotalPence: fields.subtotalPence ?? totalPence + discountPence, discountPence,
    discountCode: fields.discountCode ?? (fields.discountCodeId || ''),
    receiptTokenHash: fields.receiptTokenHash || fields.accessTokenHash || fields.receiptViewTokenHash || '',
    stripe: {
      sessionId: fields.stripeSessionId || '', mode: fields.stripeMode || '', paymentIntentId: fields.stripePaymentIntentId || '',
      setupIntentId: fields.stripeSetupIntentId || '', processing: fields.paymentProcessing === true,
      processingSince: fields.processingSince || null, reconciledAt: fields.reconciledAt || null, ...(fields.stripe || {})
    },
    fulfilment: {
      recordsWritten: fields.recordsWritten === true, emailSent: fields.emailSent === true, emailSentAt: fields.emailSentAt || null,
      emailSendingUntil: fields.emailSendingUntil || null, ...(fields.fulfilment || {})
    },
    paymentFailure: fields.paymentFailure ?? (failed ? paymentFailureRecord(null, {
      at: fields.paymentFailedAt || fields.failedAt || fields.lastPaymentFailureAt || null, code: fields.lastPaymentFailureCode || '',
      declineCode: fields.lastPaymentFailureDeclineCode || '', message: String(fields.failure || '')
    }) : null),
    ...(references ? { people: references } : {}),
    ...(membershipIds ? { membershipIds } : {})
  };
  return { set, remove: LEGACY_ORDER_FIELDS.filter((key) => key in fields) };
};
