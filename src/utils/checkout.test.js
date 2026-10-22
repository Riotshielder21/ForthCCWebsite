import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignLines, addFamilyMember, validateCheckout, peopleNeedingMembership, blankPerson, ageOn, loadDraft, saveDraft, matchMembership, personDetailErrors, personKind, withFamilyContacts, ageProblem, displayName
} from './checkout.js';

const now = new Date(2026, 9, 11);
const junior = (n) => ({ id: 'membership-junior', lineId: `j${n}`, name: 'JUNIOR', category: 'MEMBERSHIP', type: 'annual-oneoff', membershipTier: 'junior' });
const family = { id: 'membership-family', lineId: 'f1', name: 'FAMILY', category: 'MEMBERSHIP', type: 'annual-oneoff', membershipTier: 'family' };
const hire = { id: 'boat-hire', lineId: 'h1', name: 'HIRE', category: 'SERVICES', type: 'yearly-service' };
const voucher = { id: 'vouchers', lineId: 'v1', name: 'Voucher', category: 'VOUCHERS', type: 'voucher' };
let counter = 0;
const makeId = () => `p${++counter}`;

const complete = (person, overrides = {}) => ({
  ...person, firstName: 'A', lastName: 'B', dob: '1990-05-01', email: 'a@example.com', phone: '1', address: '1 St',
  postcode: 'EH1', swimming: 'basic', disclaimerAccepted: true,
  emergencyContact: { name: 'C', phone: '2', relationship: 'Friend' }, ...overrides
});

test('two junior memberships create two people; hire joins the first', () => {
  const people = assignLines([], [junior(1), junior(2), hire], makeId);
  assert.equal(people.length, 2);
  assert.deepEqual(people[0].lineIds, ['j1', 'h1']);
  assert.deepEqual(people[1].lineIds, ['j2']);
});

test('vouchers never need a person', () => {
  assert.equal(assignLines([], [voucher], makeId).length, 0);
});

test('removed lines are unassigned', () => {
  const people = assignLines([], [junior(1), hire], makeId);
  assert.deepEqual(assignLines(people, [junior(1)], makeId)[0].lineIds, ['j1']);
});

test('family membership accepts at most five people', () => {
  let people = assignLines([], [family], makeId);
  for (let i = 0; i < 6; i += 1) people = addFamilyMember(people, 'f1', makeId);
  assert.equal(people.length, 5);
});

test('age calculation rejects invalid and future dates', () => {
  assert.equal(ageOn('2010-10-12', now), 15);
  assert.equal(ageOn('2010-10-11', now), 16);
  assert.equal(ageOn('2027-01-01', now), null);
  assert.equal(ageOn('2010-02-31', now), null);
});

test('minors need a guardian instead of an emergency contact', () => {
  const [person] = assignLines([], [junior(1)], makeId);
  const kid = complete(person, { dob: '2015-01-01', email: '', emergencyContact: { name: '', phone: '', relationship: '' } });
  assert.match(validateCheckout({ lines: [junior(1)], people: [kid], now }).join(' '), /guardian/);
  const ok = { ...kid, guardian: { name: 'P', phone: '3', email: 'p@example.com', relationship: 'Parent', address: '2 St', postcode: 'EH2' } };
  assert.deepEqual(validateCheckout({ lines: [junior(1)], people: [ok], now }), []);
});

test('junior membership is restricted to ages 8-17', () => {
  const [person] = assignLines([], [junior(1)], makeId);
  assert.match(validateCheckout({ lines: [junior(1)], people: [complete(person)], now }).join(' '), /ages 8-17/);
});

test('every person needs the disclaimer and every line needs a holder', () => {
  const lines = [hire];
  const person = complete({ ...blankPerson('x'), lineIds: [] }, { disclaimerAccepted: false });
  const errors = validateCheckout({ lines, people: [person], now }).join(' ');
  assert.match(errors, /disclaimer/);
  assert.match(errors, /no items/);
  assert.match(errors, /assign to exactly one person/);
});

test('people with only non-membership items need an existing membership', () => {
  const lines = [junior(1), hire];
  const people = assignLines([], lines, makeId);
  assert.equal(peopleNeedingMembership(lines, people).length, 0);
  const hireOnly = assignLines([], [hire], makeId);
  assert.equal(peopleNeedingMembership([hire], hireOnly).length, 1);
});

test('draft storage round-trips and ignores corrupt data', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  saveDraft({ email: 'a@b.co', people: [] }, storage);
  assert.equal(loadDraft(storage).email, 'a@b.co');
  store.set('fcc-checkout-draft', '{bad');
  assert.equal(loadDraft(storage), null);
});

const rec = (over) => ({ id: 'r1', email: 'p@example.com', dob: '2012-03-04', firstName: 'Sam', lastName: 'Lee', affiliationNumber: '', status: 'active', validUntil: 0, ...over });
const who = (over) => ({ firstName: 'Sam', lastName: 'Lee', dob: '2012-03-04', affiliationNumber: '', ...over });

test('siblings sharing a guardian email are separate people', () => {
  const result = matchMembership(who({ firstName: 'Alex', dob: '2014-06-01' }), { byEmail: [rec({})] });
  assert.equal(result.match, null);
  assert.equal(result.conflict, null);
});

test('twins with the same date of birth are told apart by name', () => {
  const result = matchMembership(who({ firstName: 'Alex' }), { byEmail: [rec({})] });
  assert.equal(result.match, null);
  assert.equal(result.conflict, null);
});

test('same name on an email with a different date of birth is flagged, not duplicated', () => {
  const result = matchMembership(who({ dob: '2012-04-03' }), { byEmail: [rec({})] });
  assert.equal(result.match, null);
  assert.equal(result.reason, 'dob');
});

test('email, date of birth and name together match an existing record', () => {
  assert.equal(matchMembership(who({ firstName: ' sam ' }), { byEmail: [rec({})] }).match.id, 'r1');
});

test('membership number is primary but must agree with the date of birth', () => {
  const byNumber = [rec({ id: 'j1', affiliationNumber: '123', email: '' })];
  assert.equal(matchMembership(who({ affiliationNumber: '123', firstName: 'Samuel' }), { byNumber }).match.id, 'j1');
  assert.equal(matchMembership(who({ affiliationNumber: '123', dob: '2000-01-01' }), { byNumber }).reason, 'number');
});

test('an unknown membership number falls back to the email check', () => {
  assert.equal(matchMembership(who({ affiliationNumber: '999' }), { byNumber: [], byEmail: [rec({})] }).match.id, 'r1');
});

test('an active record is preferred over an expired one', () => {
  const records = [rec({ id: 'old', status: 'expired' }), rec({ id: 'new' })];
  assert.equal(matchMembership(who({}), { byEmail: records }).match.id, 'new');
});

test('returning members only confirm name, date of birth and the disclaimer', () => {
  const lines = [hire];
  const stub = { ...blankPerson('r'), lineIds: ['h1'], returning: true, firstName: 'Sam', lastName: 'Lee', dob: '1990-01-01', disclaimerAccepted: true };
  assert.deepEqual(personDetailErrors(stub, 'Person 1', lines, now), []);
  assert.match(personDetailErrors({ ...stub, returning: false }, 'Person 1', lines, now).join(' '), /phone/);
  assert.match(personDetailErrors({ ...stub, dob: '' }, 'Person 1', lines, now).join(' '), /date of birth/);
});

test('removing basket items drops the people attached to them and keeps the rest', () => {
  const lines = [1, 2, 3, 4].map(junior);
  let people = assignLines([], lines, makeId);
  people = people.map((person, i) => ({ ...person, firstName: `P${i}` }));
  const after = assignLines(people, lines.slice(0, 2), makeId);
  assert.deepEqual(after.map((person) => person.firstName), ['P0', 'P1']);
  const firstRemoved = assignLines(people, lines.slice(2), makeId);
  assert.deepEqual(firstRemoved.map((person) => person.firstName), ['P2', 'P3']);
});

test('a stale draft with more people than basket items is trimmed', () => {
  const stale = [1, 2, 3, 4, 5].map((n) => ({ ...blankPerson(`s${n}`), lineIds: [`gone${n}`] }));
  assert.equal(assignLines(stale, [junior(1)], makeId).length, 1);
});

test('empty people left in an old draft are dropped, but hand-added ones are kept', () => {
  const stale = [{ ...blankPerson('a'), lineIds: [] }, { ...blankPerson('b'), lineIds: [] }];
  assert.equal(assignLines(stale, [junior(1)], makeId).length, 1);
  const manual = [{ ...blankPerson('m'), lineIds: [], manual: true }];
  assert.equal(assignLines(manual, [hire], makeId).filter((person) => person.id === 'm').length, 1);
});

test('a junior membership uses the guardian layout whatever date has been typed so far', () => {
  const [person] = assignLines([], [junior(1)], makeId);
  assert.equal(personKind({ ...person, dob: '' }, [junior(1)]), 'junior');
  assert.equal(personKind({ ...person, dob: '1980-01-01' }, [junior(1)]), 'junior');
});

test('juniors give the parent address, phone and email instead of their own', () => {
  const [person] = assignLines([], [junior(1)], makeId);
  const kid = complete(person, { dob: '2015-01-01', email: '', phone: '', address: '', postcode: '', emergencyContact: { name: '', phone: '', relationship: '' },
    guardian: { name: 'P', phone: '3', email: 'p@example.com', relationship: 'Parent', address: '2 St', postcode: 'EH2' } });
  assert.deepEqual(validateCheckout({ lines: [junior(1)], people: [kid], now }), []);
  assert.match(validateCheckout({ lines: [junior(1)], people: [{ ...kid, guardian: { ...kid.guardian, address: '' } }], now }).join(' '), /address/);
});

test('family members choose adult or under 18, and the choice must match the date of birth', () => {
  const adultChosen = familyPeople([{ name: 'Kid', dob: '2015-01-01', junior: false }]);
  assert.match(validateCheckout({ lines: [family], people: adultChosen, now }).join(' '), /Under 18/);
  const juniorChosen = familyPeople([{ name: 'Grown', dob: '1990-01-01', junior: true }]);
  assert.match(validateCheckout({ lines: [family], people: juniorChosen, now }).join(' '), /only people under 18/);
});

const familyPeople = (kids) => {
  let people = assignLines([], [family], makeId).slice(0, 1);
  people[0] = complete(people[0], { phone: '07', email: 'fam@example.com', address: '9 Rd', postcode: 'EH9', emergencyContact: { name: 'Gran', phone: '08', relationship: 'Grandparent' } });
  kids.forEach((kid) => { people = addFamilyMember(people, 'f1', makeId); people[people.length - 1] = { ...people[people.length - 1], firstName: kid.name, lastName: 'Fam', dob: kid.dob, junior: kid.junior, swimming: 'basic', disclaimerAccepted: true }; });
  return people;
};

test('family members only give name, date of birth and consent; the family shares the rest', () => {
  const people = familyPeople([{ name: 'Kid', dob: '2015-01-01', junior: true }]);
  assert.deepEqual(validateCheckout({ lines: [family], people, now }), []);
  const resolved = withFamilyContacts(people, [family]);
  assert.equal(resolved[1].address, '9 Rd');
  assert.equal(resolved[1].guardian.phone, '07');
  assert.equal(resolved[1].emergencyNote, 'Parents are the emergency contact');
  assert.equal(resolved[1].emergencyContact.name, 'Gran');
});

test('a family allows at most two adults and five people', () => {
  const twoAdults = familyPeople([{ name: 'Second', dob: '1985-01-01', junior: false }, { name: 'Third', dob: '1986-01-01', junior: false }]);
  assert.match(validateCheckout({ lines: [family], people: twoAdults, now }).join(' '), /at most 2 adults/);
  const ok = familyPeople([{ name: 'Second', dob: '1985-01-01', junior: false }, { name: 'A', dob: '2015-01-01', junior: true }, { name: 'B', dob: '2016-01-01', junior: true }, { name: 'C', dob: '2017-01-01', junior: true }]);
  assert.equal(ok.length, 5);
  assert.deepEqual(validateCheckout({ lines: [family], people: ok, now }), []);
});

test('the first person on a family membership must be an adult', () => {
  const people = familyPeople([]);
  people[0] = { ...people[0], dob: '2015-01-01' };
  assert.match(validateCheckout({ lines: [family], people, now }).join(' '), /must be an adult/);
});

test('every family member needs a swimming ability', () => {
  const people = familyPeople([{ name: 'Kid', dob: '2015-01-01', junior: true }]);
  people[1] = { ...people[1], swimming: '' };
  assert.match(validateCheckout({ lines: [family], people, now }).join(' '), /swimming/);
});

test('a new family membership starts with three sets of details and is not reseeded', () => {
  const people = assignLines([], [family], makeId);
  assert.equal(people.length, 3);
  assert.ok(people.every((person) => person.lineIds.includes('f1')));
  const trimmed = people.slice(0, 2);
  assert.equal(assignLines(trimmed, [family], makeId).length, 2);
});

test('removing a membership removes its person and filled-in details, and re-homes their add-ons', () => {
  const lines = [junior(1), junior(2), hire];
  let people = assignLines([], lines, makeId).map((person, i) => ({ ...person, firstName: `Name${i}` }));
  assert.deepEqual(people[0].lineIds, ['j1', 'h1']);
  const after = assignLines(people, [junior(2), hire], makeId);
  assert.deepEqual(after.map((person) => person.firstName), ['Name1']);
  assert.deepEqual(after[0].lineIds, ['j2', 'h1']);
  const aloneHire = assignLines(people, [hire], makeId);
  assert.equal(aloneHire.length, 1);
  assert.equal(aloneHire[0].firstName, '');
});

test('a saved draft older than two hours is ignored', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  saveDraft({ email: 'a@b.co', people: [] }, storage);
  assert.equal(loadDraft(storage, Date.now() + 60 * 60 * 1000).email, 'a@b.co');
  assert.equal(loadDraft(storage, Date.now() + 3 * 60 * 60 * 1000), null);
});

test('a new family starts as two adults and a child, and added members default to child', () => {
  const people = assignLines([], [family], makeId);
  assert.deepEqual(people.map((person) => person.junior), [false, false, true]);
  assert.equal(addFamilyMember(people, 'f1', makeId)[3].junior, true);
});

test('age problems are reported as soon as a date of birth fits the membership badly', () => {
  const primary = { ...assignLines([], [family], makeId)[0], dob: '2009-12-12' };
  assert.match(ageProblem(primary, [family], 'primary', now), /must be an adult/);
  assert.equal(ageProblem({ ...primary, dob: '1990-12-12' }, [family], 'primary', now), '');
  const kid = { ...assignLines([], [junior(1)], makeId)[0], dob: '1990-01-01' };
  assert.match(ageProblem(kid, [junior(1)], null, now), /ages 8-17/);
  assert.equal(ageProblem({ ...kid, dob: '' }, [junior(1)], null, now), '');
});

const adult = (n) => ({ id: 'membership-adult', lineId: `a${n}`, name: 'ADULT', category: 'MEMBERSHIP', type: 'annual-oneoff', membershipTier: 'adult' });

test('membership assignment keeps each membership holder distinct and places add-ons consistently', () => {
  const cases = [
    { lines: [junior(1), adult(1)], expectedMemberships: [['j1'], ['a1']] },
    { lines: [adult(1), junior(1), hire], expectedMemberships: [['a1', 'h1'], ['j1']] },
    { lines: [junior(1), hire, junior(2)], expectedMemberships: [['j1', 'h1'], ['j2']] }
  ];

  for (const { lines, expectedMemberships } of cases) {
    const people = assignLines([], lines, makeId);
    assert.deepEqual(people.map((person) => person.lineIds), expectedMemberships);
    assert.equal(new Set(people.flatMap((person) => person.lineIds)).size, lines.length);
  }
});

test('membership requirement applies only to people with non-membership items and no membership of their own', () => {
  const lines = [junior(1), adult(1), hire, { ...hire, lineId: 'h2', id: 'other-hire' }];
  const people = assignLines([], lines, makeId);
  const member = people.find((person) => person.lineIds.includes('j1'));
  const adultMember = people.find((person) => person.lineIds.includes('a1'));
  const hireOnly = { ...blankPerson('hire-only'), lineIds: ['h1', 'h2'] };
  const membershipOnly = { ...blankPerson('member-only'), lineIds: ['j1'] };

  assert.deepEqual(peopleNeedingMembership(lines, people), []);
  assert.deepEqual(peopleNeedingMembership(lines, [member, adultMember, hireOnly, membershipOnly]).map((person) => person.id), ['hire-only']);

  const familyPeopleWithHire = assignLines([], [family, hire], makeId);
  assert.equal(peopleNeedingMembership([family, hire], familyPeopleWithHire).length, 0);
});

test('guardian fields are all required for junior members, including relationship', () => {
  const line = junior(1);
  const [person] = assignLines([], [line], makeId);
  const valid = complete(person, {
    dob: '2015-01-01',
    guardian: { name: 'Parent', phone: '3', email: 'parent@example.com', relationship: 'Parent', address: '2 St', postcode: 'EH2' }
  });
  const cases = [
    ['name', ''],
    ['relationship', ''],
    ['phone', ''],
    ['email', 'not-an-email'],
    ['address', ''],
    ['postcode', '']
  ];

  for (const [field, value] of cases) {
    const invalid = { ...valid, guardian: { ...valid.guardian, [field]: value } };
    assert.match(validateCheckout({ lines: [line], people: [invalid], now }).join(' '), /parent\/guardian name, relationship, phone, email, address and postcode are required/, field);
  }
});

test('adult contact and emergency-contact fields are required, including relationship', () => {
  const line = adult(1);
  const [person] = assignLines([], [line], makeId);
  const valid = complete(person);
  const cases = [
    { change: { phone: '' }, message: /phone number is required/ },
    { change: { address: '' }, message: /address and postcode are required/ },
    { change: { postcode: '' }, message: /address and postcode are required/ },
    { change: { email: 'invalid' }, message: /a valid email is required/ },
    { change: { emergencyContact: { ...valid.emergencyContact, name: '' } }, message: /emergency contact name, relationship and phone are required/ },
    { change: { emergencyContact: { ...valid.emergencyContact, relationship: '' } }, message: /emergency contact name, relationship and phone are required/ },
    { change: { emergencyContact: { ...valid.emergencyContact, phone: '' } }, message: /emergency contact name, relationship and phone are required/ }
  ];

  for (const { change, message } of cases) {
    assert.match(validateCheckout({ lines: [line], people: [{ ...valid, ...change }], now }).join(' '), message);
  }
});

test('family contacts are consistent across mixed adults and juniors without changing member details', () => {
  const lines = [family];
  const people = familyPeople([
    { name: 'Second adult', dob: '1985-01-01', junior: false },
    { name: 'Child', dob: '2015-01-01', junior: true }
  ]);
  const resolved = withFamilyContacts(people, lines);
  const primary = resolved[0];
  const shared = {
    phone: primary.phone,
    email: primary.email,
    address: primary.address,
    postcode: primary.postcode,
    emergencyContact: primary.emergencyContact,
    familyGroup: 'f1'
  };

  assert.equal(resolved.length, 3);
  for (const member of resolved.slice(1)) {
    for (const [field, value] of Object.entries(shared)) assert.deepEqual(member[field], value);
    assert.equal(member.guardian.name, 'A B');
    assert.equal(member.guardian.relationship, 'Parent');
    assert.equal(member.guardian.email, primary.email);
    assert.equal(member.guardian.address, primary.address);
  }
  assert.equal(resolved[1].emergencyNote, undefined);
  assert.equal(resolved[2].emergencyNote, 'Parents are the emergency contact');
  assert.equal(primary.familyGroup, 'f1');
});

test('existing membership lookup distinguishes matches, conflicts, and unrelated shared-email records', () => {
  const cases = [
    { label: 'normalized same-name and date match', person: who({ firstName: ' sam ' }), records: [rec({})], expectedId: 'r1' },
    { label: 'same name with a different date is a conflict', person: who({ dob: '2012-04-03' }), records: [rec({})], expectedReason: 'dob' },
    { label: 'another family member on the shared email is not a match', person: who({ firstName: 'Alex', dob: '2014-06-01' }), records: [rec({})] },
    { label: 'different name and date are not a conflict', person: who({ firstName: 'Alex', dob: '2014-06-01' }), records: [rec({ firstName: 'Taylor', dob: '2014-06-01' })] }
  ];

  for (const { label, person, records, expectedId, expectedReason } of cases) {
    const result = matchMembership(person, { byEmail: records });
    assert.equal(result.match?.id ?? null, expectedId ?? null, label);
    assert.equal(result.reason, expectedReason, label);
    if (!expectedReason) assert.equal(result.conflict, null, label);
  }
});

test('membership-number verification uses a junior guardian email and an adult member email', () => {
  const cases = [
    {
      person: { ...who({ affiliationNumber: '123' }), junior: true, email: 'child@example.com', guardian: { email: 'parent@example.com' } },
      record: rec({ affiliationNumber: '123', email: 'parent@example.com' }),
      expectedId: 'r1'
    },
    {
      person: { ...who({ affiliationNumber: '123' }), junior: false, email: 'adult@example.com', guardian: { email: 'parent@example.com' } },
      record: rec({ affiliationNumber: '123', email: 'adult@example.com' }),
      expectedId: 'r1'
    },
    {
      person: { ...who({ affiliationNumber: '123' }), junior: true, email: 'child@example.com', guardian: { email: 'other@example.com' } },
      record: rec({ affiliationNumber: '123', email: 'parent@example.com' }),
      expectedReason: 'number'
    }
  ];

  for (const { person, record, expectedId, expectedReason } of cases) {
    const result = matchMembership(person, { byNumber: [record] });
    assert.equal(result.match?.id ?? null, expectedId ?? null);
    assert.equal(result.reason, expectedReason);
  }
});

test('invalid and boundary dates produce the current age-validation results', () => {
  const cases = [
    { dob: '', expectedAge: null, expectedProblem: '' },
    { dob: 'not-a-date', expectedAge: null, expectedProblem: '' },
    { dob: '2010-02-31', expectedAge: null, expectedProblem: '' },
    { dob: '2027-01-01', expectedAge: null, expectedProblem: '' },
    { dob: '2018-10-11', expectedAge: 8, expectedProblem: '' },
    { dob: '2008-10-11', expectedAge: 18, expectedProblem: 'Junior membership is for ages 8-17.' },
    { dob: '2008-10-12', expectedAge: 17, expectedProblem: '' }
  ];
  const line = junior(1);
  const [person] = assignLines([], [line], makeId);

  for (const { dob, expectedAge, expectedProblem } of cases) {
    assert.equal(ageOn(dob, now), expectedAge, dob || '(empty date)');
    assert.equal(ageProblem({ ...person, dob }, [line], null, now), expectedProblem, dob || '(empty date)');
  }
});

test('checkout rejects duplicate people, missing items, and duplicate membership holders', () => {
  const line = junior(1);
  const person = complete({ ...blankPerson('same'), lineIds: ['j1'] }, { dob: '2015-01-01' });
  const duplicate = { ...person, lineIds: ['j1'] };
  const duplicateIdErrors = validateCheckout({ lines: [line], people: [person, duplicate], now }).join(' ');
  assert.match(duplicateIdErrors, /invalid entry/);
  assert.match(duplicateIdErrors, /assign to exactly one person/);

  const noItems = complete({ ...blankPerson('empty'), lineIds: [] });
  assert.match(validateCheckout({ lines: [line], people: [noItems], now }).join(' '), /has no items/);
});

test('a returning member name stays masked until the unlocking date of birth is entered', () => {
  const picked = { returning: true, firstName: 'Jane', lastName: 'Smith', dob: '1990-02-03', verifiedDob: '1990-02-03' };
  assert.equal(displayName(picked), 'Jane Smith');
  assert.equal(displayName({ ...picked, dob: '' }), 'J*** S***');
  assert.equal(displayName({ ...picked, dob: '1990-02-04' }), 'J*** S***');
  assert.equal(displayName({ ...picked, verifiedDob: undefined }), 'J*** S***');
  assert.equal(displayName({ returning: false, firstName: 'New', lastName: 'Person', dob: '' }), 'New Person');
});
