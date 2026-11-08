import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingsClosed, rosterDue, rosterViewable, lastEventDate, cleanRosterViewers, MAX_ROSTER_VIEWERS, cleanEventDetails, kitStatus, KIT, NO_PHOTOS, buildRoster, rosterEmail } from './eventRoster.js';
import { peopleNeedingMembership, requiresMembership } from './checkout.js';

const schedule = { mode: 'single', startDate: '2027-05-10', startTime: '09:00', endTime: '17:00', days: 1, timeZone: 'Europe/London' };
const event = { id: 'trip', name: 'River trip', category: 'EVENTS', eventSchedule: schedule, leaderName: 'Lee', leaderEmail: 'lee@example.com', closeDate: '2027-05-07' };

test('bookings stay open until the end of the close date, UK time', () => {
  assert.equal(bookingsClosed(event, new Date('2027-05-07T22:59:00Z')), false, '23:59 BST on the close date');
  assert.equal(bookingsClosed(event, new Date('2027-05-07T23:00:00Z')), true, 'midnight BST');
  assert.equal(bookingsClosed({ ...event, closeDate: '' }, new Date('2030-01-01')), false, 'no close date never closes');
});

test('the roster is due after bookings close until the event day, and only with a leader email', () => {
  assert.equal(rosterDue(event, new Date('2027-05-06T12:00:00Z')), false);
  assert.equal(rosterDue(event, new Date('2027-05-08T12:00:00Z')), true);
  assert.equal(rosterDue(event, new Date('2027-05-10T12:00:00Z')), true, 'still sent on the morning of the event');
  assert.equal(rosterDue(event, new Date('2027-05-11T12:00:00Z')), false, 'events already held are skipped');
  assert.equal(rosterDue({ ...event, leaderEmail: '' }, new Date('2027-05-08T12:00:00Z')), false);
});

test('event leader details are cleaned and checked', () => {
  assert.deepEqual(cleanEventDetails({ ...event, leaderEmail: ' Lee@Example.com ' }),
    { leaderName: 'Lee', leaderEmail: 'lee@example.com', closeDate: '2027-05-07', membershipRequired: true });
  assert.equal(cleanEventDetails({ ...event, membershipRequired: false }).membershipRequired, false);
  assert.throws(() => cleanEventDetails({ ...event, leaderEmail: 'nope' }), /valid email/);
  assert.throws(() => cleanEventDetails({ ...event, closeDate: '2027-05-11' }), /on or before/);
  assert.throws(() => cleanEventDetails({ ...event, leaderEmail: '' }), /leader's email/);
  assert.deepEqual(cleanEventDetails({ eventSchedule: schedule }), { leaderName: '', leaderEmail: '', closeDate: '', membershipRequired: true });
});

test('events only need membership when the admin leaves it ticked', () => {
  const open = { lineId: 'a', category: 'EVENTS', membershipRequired: false };
  const closed = { lineId: 'b', category: 'EVENTS' };
  const hire = { lineId: 'c', category: 'SERVICES' };
  assert.equal(requiresMembership(open), false);
  assert.equal(requiresMembership(closed), true);
  assert.equal(requiresMembership({ lineId: 'm', category: 'MEMBERSHIP' }), false);
  const people = [{ id: 'p1', lineIds: ['a'] }, { id: 'p2', lineIds: ['b'] }, { id: 'p3', lineIds: ['a', 'c'] }];
  assert.deepEqual(peopleNeedingMembership([open, closed, hire], people).map((person) => person.id), ['p2', 'p3']);
});

test('kit status: annual boat hire, then own kit, otherwise boat hire is needed', () => {
  assert.equal(kitStatus({ heldIds: ['boat-hire'], ownKit: true }), KIT.boatHire);
  assert.equal(kitStatus({ heldIds: ['keyhire'], ownKit: true }), KIT.ownKit);
  assert.equal(kitStatus({ heldIds: [] }), KIT.needsHire);
});

test('the roster lists each paid ticket with contacts, medical details, membership and kit', () => {
  const now = new Date('2027-05-08T12:00:00Z');
  const orders = [
    { id: 'ORD-1', status: 'paid', email: 'family@example.com', items: [
      { id: 'trip', lineId: 't1', category: 'EVENTS', name: 'River trip' }, { id: 'trip', lineId: 't2', category: 'EVENTS', name: 'River trip', ownKit: true },
      { id: 'boat-hire', lineId: 'h1', category: 'SERVICES', name: 'Boat hire' }],
    people: [
      { id: 'a', lineIds: ['t1', 'h1'], firstName: 'Ann', lastName: 'Adult', dob: '1990-01-01', phone: '0700', email: 'ann@example.com', medical: 'Asthma', swimming: 'Confident',
        emergencyContact: { name: 'Bob', relationship: 'Partner', phone: '0711' }, membershipId: 'M1', photoConsent: true },
      { id: 'z', lineIds: ['t2'], returning: true, firstName: 'Zed', lastName: 'Member', dob: '1985-02-02', membershipId: 'M2', existingMember: true, photoConsent: true }] },
    { id: 'ORD-2', status: 'paid', email: 'cara@example.com', items: [{ id: 'trip', lineId: 't3', category: 'EVENTS' }],
      people: [{ id: 'c', lineIds: ['t3'], firstName: 'Cara', lastName: 'Contact', dob: '2000-03-03', membershipId: 'M3' }] },
    { id: 'ORD-3', status: 'pending', items: [{ id: 'trip', lineId: 't4', category: 'EVENTS' }], people: [{ id: 'p', lineIds: ['t4'], firstName: 'Pending' }] },
    { id: 'ORD-4', status: 'paid', items: [{ id: 'other', lineId: 'o1', category: 'EVENTS' }], people: [{ id: 'o', lineIds: ['o1'], firstName: 'Other' }] }
  ];
  const members = new Map([
    ['M1', { status: 'active', validUntil: '2028-02-28' }],
    ['M2', { status: 'active', validUntil: '2028-02-28', phone: '0799', medical: 'Diabetic', emergencyContact: { name: 'Yan', relationship: 'Sister', phone: '0722' },
      entitlements: [{ productId: 'boat-hire', grantedAt: '2026-04-01T00:00:00Z' }], consents: { photoVideo: { accepted: false, source: 'my-details' } } }],
    ['M3', { contactOnly: true }]
  ]);
  const roster = buildRoster('trip', orders, members, now, undefined, new Map([['M1', 5], ['M3', 2]]), new Set(['M1']));
  assert.deepEqual(roster.map((row) => [row.name, row.kit, row.membership]), [
    ['Ann Adult', KIT.boatHire, 'Active'],
    ['Cara Contact', KIT.needsHire, 'No'],
    ['Zed Member', KIT.ownKit, 'Active']
  ], 'last club year\'s boat hire does not count; pending orders and other events are left out');
  assert.equal(roster[0].emergencyContact, 'Bob, Partner, 0711');
  assert.equal(roster[2].medical, 'Diabetic', 'existing members\' details come from their record');
  assert.equal(roster[2].phone, '0799');
  assert.deepEqual(roster.map((row) => row.nonMemberVisits), [undefined, '2 of 3 this club year', undefined], 'visits are only shown for non-members');
  assert.deepEqual(roster.map((row) => row.firstClubNight), [false, true, true], 'members and non-members are flagged if they have never checked in');
  assert.equal(buildRoster('trip', orders, members, now)[0].firstClubNight, undefined, 'unknown without check-in history');
  assert.deepEqual(roster.map((row) => row.photoConsent), [true, false, false], 'no answer is a no, and a withdrawal on the record beats the order');

  const { subject, body } = rosterEmail(event, roster);
  assert.match(subject, /^Attendee list: River trip \(/);
  assert.match(body, /^Hello Lee,/);
  assert.match(body, /Attendees: 3\. 1 needs boat hire and has not paid for it\.\nPhoto and video consent: 2 people have not given it \(marked below\), so do not photograph or film them\./);
  assert.equal(body.split(`Photos: ${NO_PHOTOS}`).length - 1, 2, 'only those without consent are marked');
  assert.doesNotMatch(body.split('2. Cara')[0], /Photos:/, 'Ann gave consent');
  assert.doesNotMatch(rosterEmail(event, [roster[0]]).body, /Photo and video consent:/);
  assert.match(body, /1\. Ann Adult \(Adult, born 1990-01-01\)\n {3}Phone: 0700 {3}Email: ann@example\.com\n {3}Emergency contact: Bob, Partner, 0711\n {3}Medical: Asthma/);
  assert.match(body, /Kit: Bringing own kit/);
  assert.match(body, /Membership: No\n {3}Non-member visits: 2 of 3 this club year\n {3}First club night: Yes\n/);
  assert.match(body, /Membership: Active\n {3}First club night: No\n/);
  assert.match(rosterEmail(event, []).body, /Nobody has booked\./);

  const erased = [{ id: 'ORD-5', status: 'paid', items: [{ id: 'trip', lineId: 'e1', category: 'EVENTS', pricePence: 2000 }, { id: 'trip', lineId: 'e2', category: 'EVENTS', attendeeErased: true }],
    people: [{ lineIds: ['e1'], membershipId: 'M9', erased: true }, { lineIds: ['e2'], firstName: 'Old' }] }];
  assert.deepEqual(buildRoster('trip', erased, members, now), [], 'erased attendees and their tickets are left out');
});

test('leaders and named viewers can open the list while the event is in the shop, until the end of its last day', () => {
  const twoDays = { ...event, eventSchedule: { ...schedule, mode: 'consecutive', days: 2 } };
  assert.equal(lastEventDate(twoDays), '2027-05-11');
  assert.equal(lastEventDate({ ...event, eventSchedule: undefined }), '');
  assert.equal(rosterViewable(twoDays, new Date('2027-04-01T12:00:00Z')), true);
  assert.equal(rosterViewable(twoDays, new Date('2027-05-11T22:59:00Z')), true, '23:59 BST on the last day');
  assert.equal(rosterViewable(twoDays, new Date('2027-05-11T23:00:00Z')), false);
  assert.equal(rosterViewable({ ...twoDays, active: false }, new Date('2027-04-01T12:00:00Z')), false, 'not while the event is hidden from the shop');
  assert.equal(rosterViewable({ ...twoDays, category: 'SERVICES' }, new Date('2027-04-01T12:00:00Z')), false);
});

test('extra roster viewers are unique, valid, lower-case emails', () => {
  assert.deepEqual(cleanRosterViewers([' Amy@Example.com', 'amy@example.com', '', 'bo@example.org']), ['amy@example.com', 'bo@example.org']);
  assert.deepEqual(cleanRosterViewers(undefined), []);
  assert.throws(() => cleanRosterViewers(['not-an-email']), /not-an-email is not a valid email/);
  assert.throws(() => cleanRosterViewers(Array.from({ length: MAX_ROSTER_VIEWERS + 1 }, (_, index) => `p${index}@example.com`)), /up to 10/);
});
