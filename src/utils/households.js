const text = (value) => typeof value === 'string' ? value.trim() : '';

export const HOUSEHOLD_MEMBER_FIELDS = [
  'email', 'phone', 'address', 'postcode', 'guardian', 'emergencyContact', 'emergencyNote', 'photoConsent',
  'familyGroup', 'junior', 'returning', 'disclaimerAccepted'
];

export const householdForPerson = (person, id, createdAt) => {
  const junior = memberIsJunior(person);
  const guardian = person.guardian || {};
  const emergencyContact = person.emergencyContact || {};
  const contactName = junior
    ? text(guardian.name)
    : `${text(person.firstName)} ${text(person.lastName)}`.trim();
  const household = {
    id,
    contactName,
    contactRelationship: junior ? text(guardian.relationship) || 'Parent/Guardian' : person.familyGroup ? 'Parent/Guardian' : 'Member',
    email: text(junior ? guardian.email : person.email).toLowerCase(),
    phone: text(junior ? guardian.phone : person.phone),
    address: text(junior ? guardian.address : person.address),
    postcode: text(junior ? guardian.postcode : person.postcode),
    updatedAt: createdAt
  };
  if (createdAt) household.createdAt = createdAt;
  if (!junior) {
    household.emergencyContact = {
      name: text(emergencyContact.name),
      relationship: text(emergencyContact.relationship),
      phone: text(emergencyContact.phone)
    };
  }
  return household;
};

export const memberIsJunior = (member = {}, now = new Date()) => {
  if (member.membershipTier === 'junior' || member.junior === true) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(member.dob || '');
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day || birth > now) return false;
  let age = now.getFullYear() - year;
  if (now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day)) age -= 1;
  return age < 18;
};

export const householdGroupKey = (person) => {
  if (person.familyGroup) return `family:${person.familyGroup}`;
  if (memberIsJunior(person)) {
    const guardian = person.guardian || {};
    const email = text(guardian.email || person.email).toLowerCase();
    const name = text(guardian.name).toLowerCase().replace(/\s+/g, ' ');
    if (email && name) return `guardian:${email}|${name}`;
  }
  if (person.householdId) return `household:${person.householdId}`;
  return `person:${person.id || person.membershipId}`;
};
