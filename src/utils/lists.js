import { normaliseName } from './checkout.js';

export const LIST_TYPES = ['Equipment Needed', 'Volunteer Sign-ups', 'Event Participants', 'Maintenance Tasks', 'Other'];
export const VOLUNTEER_LIST = 'Volunteer Sign-ups';
export const LIST_LIMITS = { name: 120, email: 254, item: 500, items: 20, notes: 2000 };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const text = (value) => typeof value === 'string' ? value.trim() : '';

/** Checks a public list submission; the volunteer form sends `category`, older clients send `listType`. */
export const validateListSubmission = (body = {}) => {
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const listType = text(body.listType || body.category);
  const notes = text(body.notes);
  const items = Array.isArray(body.items) ? body.items.map(text).filter(Boolean) : null;
  if (!name || name.length > LIST_LIMITS.name) return { error: 'Enter your name.' };
  if (email.length > LIST_LIMITS.email || !EMAIL_PATTERN.test(email)) return { error: 'Enter a valid email address.' };
  if (!LIST_TYPES.includes(listType)) return { error: 'Choose a list type.' };
  if (!items?.length || items.length > LIST_LIMITS.items || body.items.length > LIST_LIMITS.items) return { error: 'Please answer the questions.' };
  if (items.some((item) => item.length > LIST_LIMITS.item)) return { error: `Keep each answer under ${LIST_LIMITS.item} characters.` };
  if (notes.length > LIST_LIMITS.notes) return { error: `Keep notes under ${LIST_LIMITS.notes} characters.` };
  if (listType === VOLUNTEER_LIST && body.tier !== undefined && !['20', '40', '60'].includes(body.tier)) return { error: 'Choose a volunteer hours bracket.' };
  return { value: { name, email, listType, items, notes, ...(listType === VOLUNTEER_LIST && body.tier ? { tier: body.tier } : {}) } };
};

/** Stops spreadsheet apps treating submitted text as a formula. */
export const sheetCell = (value) => {
  const cell = String(value ?? '');
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
};

/** A volunteer belongs to a membership only when both the name and the contact email match. */
export const matchesVolunteer = (member, { name, email }) => {
  const memberName = normaliseName(`${member.firstName || ''} ${member.lastName || ''}`);
  return Boolean(memberName) && memberName === normaliseName(name) && member.contactEmails.includes(email);
};

/** A volunteer code is only issued once: after induction, while the linked membership is active. */
export const volunteerCodeDecision = ({ inducted, codeIssued, memberActive }) => {
  if (codeIssued) return 'issued';
  if (!inducted) return 'awaiting-induction';
  if (!memberActive) return 'awaiting-membership';
  return 'issue';
};

/**
 * Active volunteers (inducted, an active member, and ticked "Active" by an admin) are emailed each boathouse code once:
 * `sentVersion` is the code version they last received.
 */
export const boathouseCodeDecision = ({ inducted, active, memberActive, codeVersion, sentVersion }) => {
  if (!codeVersion) return 'no-code';
  if (!inducted || !active || !memberActive) return 'not-active';
  return sentVersion === codeVersion ? 'up-to-date' : 'send';
};
