import { productMembershipRule } from './catalogue.js';
// Placeholder wording: replace with the club's approved disclaimer; the new wording is recorded as the next policy version after release.
export const DISCLAIMER_TEXT = 'I confirm the details given are correct and I accept the Forth Canoe Club participation and safety disclaimer. For under-18s, the parent/guardian accepts on their behalf.';
export const PHOTO_CONSENT_TEXT = 'Photo and video consent';
export const SWIMMING_LEVELS = [
  ['non-swimmer', 'Non-swimmer'],
  ['basic', 'Can swim a short distance'],
  ['confident', 'Confident swimmer']
];
export const FAMILY_MAX = 5;
export const FAMILY_ADULT_MAX = 2;
export const FAMILY_DEFAULT = 3;

export const needsPerson = (item) => item.type !== 'voucher' && item.type !== 'external' && item.category !== 'MERCHANDISE';
export const isMembership = (item) => item.category === 'MEMBERSHIP';
export const isFamilyMembership = (item) => item.membershipTier === 'family';

export const blankPerson = (id) => ({
  id, lineIds: [], returning: false, junior: false, firstName: '', lastName: '', dob: '', email: '', phone: '', address: '', postcode: '',
  affiliationNumber: '', swimming: '', medical: '', photoConsent: false, disclaimerAccepted: false,
  emergencyContact: { name: '', phone: '', relationship: '' },
  guardian: { name: '', phone: '', email: '', relationship: '', address: '', postcode: '' }
});

export const ageOn = (dob, now = new Date()) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day || birth > now) return null;
  let age = now.getFullYear() - year;
  if (now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day)) age -= 1;
  return age;
};

// Junior or adult comes from the membership held, never from the date of birth, so the form does not change while a date is typed.
// Family memberships (and add-ons for existing members) use the person's own choice.
export const personKind = (person, lines) => {
  const tiers = person.lineIds.map((id) => lines.find((line) => line.lineId === id)?.membershipTier);
  if (tiers.includes('junior')) return 'junior';
  if (tiers.includes('adult')) return 'adult';
  return person.junior === true ? 'junior' : 'adult';
};

export const contactEmail = (person) =>
  String((person.junior ? person.guardian?.email : person.email) || '').trim().toLowerCase();

const holdsEquivalent = (person, line, lines) => person.lineIds.some((id) => {
  const held = lines.find((candidate) => candidate.lineId === id);
  return held && (isMembership(line) ? isMembership(held) : held.id === line.id);
});

// Keeps every per-person basket line assigned to a person, creating people as needed.
export const assignLines = (people, lines, makeId) => {
  const personLines = lines.filter(needsPerson);
  const valid = new Set(personLines.map((line) => line.lineId));
  // A person goes with the membership they were created for, even if already filled in; their add-ons are reassigned below.
  // People with no basket items go too, unless they were added by hand and are still waiting for one.
  const keepsMembership = (person) => person.lineIds.some((id) => isMembership(lines.find((line) => line.lineId === id)));
  const next = people
    .map((person) => ({ ...person, lineIds: person.lineIds.filter((id) => valid.has(id)) }))
    .filter((person) => person.manual === true || (person.lineIds.length > 0 && !(person.ownsMembership && !keepsMembership(person))));
  const assigned = new Set(next.flatMap((person) => person.lineIds));
  for (const line of personLines) {
    if (assigned.has(line.lineId)) continue;
    let target = next.find((person) => !holdsEquivalent(person, line, lines));
    if (!target) {
      target = blankPerson(makeId());
      next.push(target);
    }
    target.lineIds = [...target.lineIds, line.lineId];
    if (isMembership(line)) target.ownsMembership = true;
    assigned.add(line.lineId);
    // A new family membership starts as two adults and a child; later edits are never reseeded.
    if (isFamilyMembership(line)) {
      for (let seat = 1; seat < FAMILY_DEFAULT; seat += 1) next.push({ ...blankPerson(makeId()), lineIds: [line.lineId], ownsMembership: true, junior: seat >= 2 });
    }
  }
  return next;
};

export const addFamilyMember = (people, familyLineId, makeId) => {
  if (people.filter((person) => person.lineIds.includes(familyLineId)).length >= FAMILY_MAX) return people;
  return [...people, { ...blankPerson(makeId()), lineIds: [familyLineId], ownsMembership: true, junior: true }];
};

export const assignLine = (people, lineId, personId) => people.map((person) => {
  const without = person.lineIds.filter((id) => id !== lineId);
  return { ...person, lineIds: person.id === personId ? [...without, lineId] : without };
});

export const toggleFamilyLine = (people, lineId, personId) => people.map((person) => person.id === personId
  ? { ...person, lineIds: person.lineIds.includes(lineId) ? person.lineIds.filter((id) => id !== lineId) : [...person.lineIds, lineId] }
  : person);

/** A returning member's name came from our records, so it stays masked (`J*** S***`) unless the date of birth that unlocked it is entered. */
export const displayName = (person) => {
  const name = [person?.firstName, person?.lastName].filter(Boolean).join(' ');
  if (!person?.returning || (person.verifiedDob && person.dob === person.verifiedDob)) return name;
  return name.split(/\s+/).filter(Boolean).map((word) => `${word[0]}***`).join(' ');
};

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export const sanitizePerson = (person) => ({
  id: text(person?.id, 64),
  lineIds: Array.isArray(person?.lineIds) ? person.lineIds.filter((id) => typeof id === 'string').map((id) => id.slice(0, 64)) : [],
  returning: person?.returning === true, junior: person?.junior === true,
  firstName: text(person?.firstName, 80), lastName: text(person?.lastName, 80), dob: text(person?.dob, 10),
  email: text(person?.email, 254).toLowerCase(), phone: text(person?.phone, 40),
  address: text(person?.address, 300), postcode: text(person?.postcode, 12),
  affiliationNumber: text(person?.affiliationNumber, 40), swimming: text(person?.swimming, 20), medical: text(person?.medical, 1000),
  photoConsent: person?.photoConsent === true, disclaimerAccepted: person?.disclaimerAccepted === true,
  ownKitLineIds: Array.isArray(person?.ownKitLineIds) ? person.ownKitLineIds.filter((id) => typeof id === 'string').map((id) => id.slice(0, 64)).slice(0, 20) : [],
  emergencyContact: { name: text(person?.emergencyContact?.name, 120), phone: text(person?.emergencyContact?.phone, 40), relationship: text(person?.emergencyContact?.relationship, 60) },
  guardian: { name: text(person?.guardian?.name, 120), phone: text(person?.guardian?.phone, 40), email: text(person?.guardian?.email, 254).toLowerCase(), relationship: text(person?.guardian?.relationship, 60), address: text(person?.guardian?.address, 300), postcode: text(person?.guardian?.postcode, 12) }
});

const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

// The first age-related problem for a person, or '' (also shown inline next to the date of birth).
export const ageProblem = (person, lines, role = null, now = new Date()) => {
  const age = ageOn(person.dob, now);
  if (age === null) return '';
  const tiers = person.lineIds.map((id) => lines.find((line) => line.lineId === id)?.membershipTier);
  if (role === 'primary' && age < 18) return 'The family contact must be an adult (18 or over).';
  if (tiers.includes('junior') && !(age >= 8 && age < 18)) return 'Junior membership is for ages 8-17.';
  if (tiers.includes('adult') && age < 18) return 'Adult membership is for ages 18 and over.';
  if (role !== 'primary' && !tiers.some((tier) => ['junior', 'adult'].includes(tier))) {
    const kind = personKind(person, lines);
    if (kind === 'junior' && age >= 18) return 'Only people under 18 can be registered as juniors.';
    if (kind === 'adult' && age < 18) return 'Choose "Under 18" for anyone under 18.';
  }
  return '';
};

// The first person on a family membership gives the contact details the whole family shares.
export const familyRole = (person, people, lines) => {
  const line = person.lineIds.map((id) => lines.find((candidate) => candidate.lineId === id)).find((candidate) => candidate && isFamilyMembership(candidate));
  if (!line) return null;
  return people.find((candidate) => candidate.lineIds.includes(line.lineId))?.id === person.id ? 'primary' : 'member';
};

export const resolvedKind = (person, people, lines) => familyRole(person, people, lines) === 'primary' ? 'adult' : personKind(person, lines);

// Family members copy the primary's contact details; children are noted as having their parents as emergency contact.
export const withFamilyContacts = (people, lines) => people.map((person) => {
  const role = familyRole(person, people, lines);
  if (!role) return person;
  const familyLine = person.lineIds.map((id) => lines.find((line) => line.lineId === id)).find((line) => line && isFamilyMembership(line));
  if (role === 'primary') return { ...person, familyGroup: familyLine.lineId };
  const primary = people.find((candidate) => candidate.lineIds.includes(familyLine.lineId));
  const contact = { phone: primary.phone, email: primary.email, address: primary.address, postcode: primary.postcode };
  return {
    ...person, ...contact, familyGroup: familyLine.lineId, emergencyContact: primary.emergencyContact,
    guardian: { name: `${primary.firstName} ${primary.lastName}`.trim(), relationship: 'Parent', ...contact },
    ...(person.junior ? { emergencyNote: 'Parents are the emergency contact' } : {})
  };
});

// Detail problems for one person. Returning members only confirm name, date of birth and the disclaimer;
// the server then checks those against their stored record. Family members share the primary's contact details.
export const personDetailErrors = (person, label, lines, now = new Date(), role = null) => {
  const errors = [];
  const lineMap = new Map(lines.map((line) => [line.lineId, line]));
  if (!person.firstName || !person.lastName) errors.push(`${label}: first and last name are required.`);
  const age = ageOn(person.dob, now);
  if (age === null) errors.push(`${label}: enter a valid date of birth.`);
  if (!person.disclaimerAccepted) errors.push(`${label}: the disclaimer must be accepted.`);
  const kind = role === 'primary' ? 'adult' : personKind(person, lines);
  const problem = ageProblem(person, lines, role, now);
  if (problem) errors.push(`${label}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
  if (!person.returning && !SWIMMING_LEVELS.some(([value]) => value === person.swimming)) errors.push(`${label}: choose a swimming ability.`);
  if (!person.returning && role !== 'member') {
    if (kind === 'junior') {
      const { name, phone, email, address, postcode } = person.guardian;
      if (!name || !person.guardian.relationship || !phone || !address || !postcode || !EMAIL.test(email)) errors.push(`${label}: parent/guardian name, relationship, phone, email, address and postcode are required.`);
    } else {
      if (!person.phone) errors.push(`${label}: phone number is required.`);
      if (!person.address || !person.postcode) errors.push(`${label}: address and postcode are required.`);
      if (!EMAIL.test(person.email)) errors.push(`${label}: a valid email is required.`);
      if (!person.emergencyContact.name || !person.emergencyContact.relationship || !person.emergencyContact.phone) errors.push(`${label}: emergency contact name, relationship and phone are required.`);
    }
  }
  return errors;
};

// Returns human-readable problems; an empty array means the details are complete.
export const validateCheckout = ({ lines, people, now = new Date() }) => {
  const errors = [];
  const personLines = lines.filter(needsPerson);
  const lineMap = new Map(lines.map((line) => [line.lineId, line]));
  const ids = new Set();
  people.forEach((person, index) => {
    const label = `Person ${index + 1}`;
    if (!person.id || ids.has(person.id)) errors.push(`${label}: invalid entry.`);
    ids.add(person.id);
    if (!person.lineIds.length) errors.push(`${label}: has no items. Remove them or assign an item.`);
    if (person.lineIds.some((id) => !lineMap.has(id) || !needsPerson(lineMap.get(id)))) errors.push(`${label}: assigned an invalid item.`);
    errors.push(...personDetailErrors(person, label, lines, now, familyRole(person, people, lines)));
  });
  for (const line of personLines) {
    const holders = people.filter((person) => person.lineIds.includes(line.lineId));
    if (isFamilyMembership(line)) {
      if (holders.length < 1 || holders.length > FAMILY_MAX) errors.push(`${line.name}: assign 1 to ${FAMILY_MAX} people.`);
      if (holders.filter((person) => resolvedKind(person, people, lines) === 'adult').length > FAMILY_ADULT_MAX) errors.push(`${line.name}: a family can have at most ${FAMILY_ADULT_MAX} adults.`);
    } else if (holders.length !== 1) {
      errors.push(`${line.name}: assign to exactly one person.`);
    }
  }
  return errors;
};

// Membership lines never need one. Events, services and subscriptions follow their membership rule; anything else does.
export const lineMembershipRule = (line) => isMembership(line) ? null : productMembershipRule(line) || 'required';
export const requiresMembership = (line) => !isMembership(line) && lineMembershipRule(line) === 'required';
export const grantsMembership = (line) => !isMembership(line) && lineMembershipRule(line) === 'included';

// People buying items that need membership who have no membership line (or membership-included item) of their own.
export const peopleNeedingMembership = (lines, people) => people.filter((person) => {
  const held = person.lineIds.map((id) => lines.find((line) => line.lineId === id)).filter(Boolean);
  return held.some(requiresMembership) && !held.some((line) => isMembership(line) || grantsMembership(line));
});

// People who become members through a membership-included item rather than a membership line.
export const peopleGrantedMembership = (lines, people) => people.filter((person) => {
  const held = person.lineIds.map((id) => lines.find((line) => line.lineId === id)).filter(Boolean);
  return held.some(grantsMembership) && !held.some(isMembership);
});

export const normaliseName = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const recordName = (record) => normaliseName(`${record.firstName || ''} ${record.lastName || ''}`);

const bestRecord = (records, now) => records.find((record) => record.status === 'active' && !(record.validUntil && record.validUntil <= now)) || records[0] || null;

// Email addresses are shared (families, guardians), so a match needs the date of birth and name too.
// Membership number is primary but must agree with the date of birth and email when the record has them.
// `conflict` means the same name is on this email with another date of birth: likely a typo, not a new person.
export const matchMembership = (person, { byNumber = [], byEmail = [] }, now = Date.now()) => {
  if (person.affiliationNumber && byNumber.length) {
    const email = contactEmail(person);
    const agreeing = byNumber.filter((record) => (!record.dob || record.dob === person.dob) && (!record.email || !email || record.email === email));
    if (!agreeing.length) return { match: null, conflict: byNumber[0], reason: 'number' };
    return { match: bestRecord(agreeing, now), conflict: null };
  }
  const name = normaliseName(`${person.firstName} ${person.lastName}`);
  const sameDob = byEmail.filter((record) => record.dob === person.dob && (!recordName(record) || recordName(record) === name));
  if (sameDob.length) return { match: bestRecord(sameDob, now), conflict: null };
  const conflict = byEmail.find((record) => recordName(record) === name && record.dob !== person.dob);
  return { match: null, conflict: conflict || null, reason: conflict ? 'dob' : undefined };
};

export const DRAFT_KEY = 'fcc-checkout-draft';

// sessionStorage keeps personal data in this tab only and drops it when the tab closes.
export const DRAFT_MAX_AGE = 2 * 60 * 60 * 1000;

export const loadDraft = (storage = globalThis.sessionStorage, now = Date.now()) => {
  try {
    const draft = JSON.parse(storage?.getItem(DRAFT_KEY) || 'null');
    if (!draft || !Array.isArray(draft.people)) return null;
    return typeof draft.savedAt === 'number' && now - draft.savedAt > DRAFT_MAX_AGE ? null : draft;
  } catch {
    return null;
  }
};
export const saveDraft = (draft, storage = globalThis.sessionStorage) => {
  try { storage?.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() })); } catch { /* storage unavailable */ }
};
export const clearDraft = (storage = globalThis.sessionStorage) => {
  try { storage?.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
};
