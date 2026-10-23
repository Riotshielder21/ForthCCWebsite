import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingsClosed, rosterDue, cleanEventDetails, kitStatus, KIT, buildRoster, rosterEmail } from './eventRoster.js';
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
        emergencyContact: { name: 'Bob', relationship: 'Partner', phone: '0711' }, membershipId: 'M1' },
      { id: 'z', lineIds: ['t2'], returning: true, firstName: 'Zed', lastName: 'Member', dob: '1985-02-02', membershipId: 'M2', existingMember: true }] },
    { id: 'ORD-2', status: 'paid', email: 'cara@example.com', items: [{ id: 'trip', lineId: 't3', category: 'EVENTS' }],
      people: [{ id: 'c', lineIds: ['t3'], firstName: 'Cara', lastName: 'Contact', dob: '2000-03-03', membershipId: 'M3' }] },
    { id: 'ORD-3', status: 'pending', items: [{ id: 'trip', lineId: 't4', category: 'EVENTS' }], people: [{ id: 'p', lineIds: ['t4'], firstName: 'Pending' }] },
    { id: 'ORD-4', status: 'paid', items: [{ id: 'other', lineId: 'o1', category: 'EVENTS' }], people: [{ id: 'o', lineIds: ['o1'], firstName: 'Other' }] }
  ];
  const members = new Map([
    ['M1', { status: 'active', validUntil: '2028-02-28' }],
    ['M2', { status: 'active', validUntil: '2028-02-28', phone: '0799', medical: 'Diabetic', emergencyContact: { name: 'Yan', relationship: 'Sister', phone: '0722' },
      privileges: [{ productId: 'boat-hire', grantedAt: '2026-04-01T00:00:00Z' }] }],
    ['M3', { contactOnly: true }]
  ]);
  const roster = buildRoster('trip', orders, members, now);
  assert.deepEqual(roster.map((row) => [row.name, row.kit, row.membership]), [
    ['Ann Adult', KIT.boatHire, 'Current'],
    ['Cara Contact', KIT.needsHire, 'Not a member'],
    ['Zed Member', KIT.ownKit, 'Current']
  ], 'last club year\'s boat hire does not count; pending orders and other events are left out');
  assert.equal(roster[0].emergencyContact, 'Bob, Partner, 0711');
  assert.equal(roster[2].medical, 'Diabetic', 'existing members\' details come from their record');
  assert.equal(roster[2].phone, '0799');

  const { subject, body } = rosterEmail(event, roster);
  assert.match(subject, /^Attendee list: River trip \(/);
  assert.match(body, /^Hello Lee,/);
  assert.match(body, /Attendees: 3\. 1 needs boat hire and has not paid for it\./);
  assert.match(body, /1\. Ann Adult \(Adult, born 1990-01-01\)\n {3}Phone: 0700 {3}Email: ann@example\.com\n {3}Emergency contact: Bob, Partner, 0711\n {3}Medical: Asthma/);
  assert.match(body, /Kit: Bringing own kit/);
  assert.match(body, /Membership: Not a member/);
  assert.match(rosterEmail(event, []).body, /Nobody has booked\./);
});
