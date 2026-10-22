import { personReport, memberState } from './adminReports.js';
import { eventScheduleLabel } from './catalogue.js';
import { currentPrivilegeIds } from './tripDiscount.js';

/**
 * Event leaders: each event can name a leader (shown publicly), a booking close date, and whether attendees must be
 * club members. After bookings close the leader is emailed the attendee list once, with emergency contacts, medical
 * details and each person's kit situation.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export const BOAT_HIRE_ID = 'boat-hire';

const londonDate = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Bookings are taken up to the end of the close date (UK time). */
export const bookingsClosed = (product, now = new Date()) => DATE.test(product?.closeDate || '') && londonDate(now) > product.closeDate;

/** The automatic send: bookings have closed, there is a leader to send to, and the event has not already happened. */
export const rosterDue = (product, now = new Date()) => product?.category === 'EVENTS' && Boolean(product.leaderEmail)
  && bookingsClosed(product, now) && (product.eventSchedule?.startDate || '') >= londonDate(now);

export const formatDate = (value) => (DATE.test(value || '')
  ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
  : '');

/** Cleans the leader fields an admin enters on an event; throws with a readable message when they do not fit together. */
export const cleanEventDetails = (product) => {
  const leaderName = text(product.leaderName, 120);
  const leaderEmail = text(product.leaderEmail, 254).toLowerCase();
  const closeDate = text(product.closeDate, 10);
  if (leaderEmail && !EMAIL.test(leaderEmail)) throw new Error('Enter a valid email address for the event leader.');
  if (closeDate && (!DATE.test(closeDate) || !Number.isFinite(new Date(`${closeDate}T00:00:00Z`).getTime()))) throw new Error('Enter a valid booking close date.');
  if (closeDate && product.eventSchedule?.startDate && closeDate > product.eventSchedule.startDate) throw new Error('Bookings must close on or before the event date.');
  if (closeDate && !leaderEmail) throw new Error('Add the event leader\'s email so the attendee list can be sent when bookings close.');
  return { leaderName, leaderEmail, closeDate, membershipRequired: product.membershipRequired !== false };
};

export const KIT = { boatHire: 'Has annual boat hire', ownKit: 'Bringing own kit', needsHire: 'Needs boat hire (not paid)' };

export const kitStatus = ({ ownKit = false, heldIds = [] }) => {
  if (heldIds.includes(BOAT_HIRE_ID)) return KIT.boatHire;
  return ownKit ? KIT.ownKit : KIT.needsHire;
};

/**
 * One row per paid ticket for the event. `orders` are `{ id, ...fields }`; `members` maps a membership id to its record
 * (with `household` merged in) so details existing members did not re-enter at checkout still appear.
 */
export const buildRoster = (productId, orders, members = new Map(), now = new Date()) => orders
  .filter((order) => order.status === 'paid')
  .flatMap((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    return items.filter((item) => item.id === productId).map((ticket) => {
      const person = (order.people || []).find((candidate) => (candidate.lineIds || []).includes(ticket.lineId));
      if (!person) return { name: 'Attendee details not recorded', orderRef: order.id, bookedBy: order.email || '', kit: KIT.needsHire, membership: '' };
      const member = members.get(person.membershipId) || {};
      const report = personReport(person, items, member);
      const ownLineIds = (person.lineIds || []).map((lineId) => items.find((item) => item.lineId === lineId)?.id).filter(Boolean);
      const heldIds = [...currentPrivilegeIds(member.privileges, now), ...ownLineIds];
      return {
        name: report.name, kind: report.kind, dob: report.dob, phone: report.phone, email: report.email,
        emergencyContact: report.emergencyContact, medical: report.medical, swimming: report.swimming,
        kit: kitStatus({ ownKit: ticket.ownKit === true, heldIds }),
        membership: member.contactOnly ? 'Not a member' : memberState({ status: member.status, expiry: member.validUntil || member.expiry }, now),
        orderRef: order.id, bookedBy: order.email || ''
      };
    });
  })
  .sort((first, second) => first.name.localeCompare(second.name));

export const rosterEmail = (product, roster) => {
  const schedule = product.eventSchedule ? eventScheduleLabel(product.eventSchedule) : '';
  const needsHire = roster.filter((row) => row.kit === KIT.needsHire).length;
  const attendees = roster.map((row, index) => [
    `${index + 1}. ${row.name}${row.kind ? ` (${row.kind}${row.dob ? `, born ${row.dob}` : ''})` : ''}`,
    `   Phone: ${row.phone || 'not given'}   Email: ${row.email || 'not given'}`,
    `   Emergency contact: ${row.emergencyContact || 'not given'}`,
    `   Medical: ${row.medical || 'none given'}`,
    `   Swimming: ${row.swimming || 'not given'}`,
    `   Kit: ${row.kit}`,
    ...(row.membership ? [`   Membership: ${row.membership}`] : []),
    `   Order: ${row.orderRef}${row.bookedBy ? `, booked by ${row.bookedBy}` : ''}`
  ].join('\n'));
  return {
    subject: `Attendee list: ${product.name}${schedule ? ` (${schedule})` : ''}`,
    body: [
      `Hello${product.leaderName ? ` ${product.leaderName}` : ''},`, '',
      `Here is the attendee list for ${product.name}.`,
      ...(schedule ? [`When: ${schedule}`] : []),
      ...(product.closeDate ? [`Bookings closed: ${formatDate(product.closeDate)}`] : []),
      `Attendees: ${roster.length}${needsHire ? `. ${needsHire} need${needsHire === 1 ? 's' : ''} boat hire and ${needsHire === 1 ? 'has' : 'have'} not paid for it.` : ''}`, '',
      ...(roster.length ? attendees.flatMap((block) => [block, '']) : ['Nobody has booked.', '']),
      'This email contains personal and medical details. Keep it private and delete it after the event.',
      'Questions: secretary@forthcanoeclub.co.uk'
    ].join('\n')
  };
};
