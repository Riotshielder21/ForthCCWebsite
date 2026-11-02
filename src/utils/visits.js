import { clubYearOf, clubYearDates } from './clubYear.js';
import { productMembershipRule } from './catalogue.js';

/** Non-members may come to this many sessions or open events in a club year; after that volunteers are warned. */
export const NON_MEMBER_VISIT_LIMIT = 3;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const yearOfDate = (date) => clubYearOf(new Date(`${date}T12:00:00Z`));

/** The London dates (YYYY-MM-DD) a club year covers, for comparing with check-in dates. */
export const clubYearDateRange = (clubYear) => {
  const format = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const { start, end } = clubYearDates(clubYear);
  return { first: format(start), last: format(new Date(end.getTime() - 1)) };
};

/** Check-ins made while not an active member, one per session date. */
export const nonMemberCheckinVisits = (checkins, clubYear) => {
  const { first, last } = clubYearDateRange(clubYear);
  return new Set(checkins.filter((checkin) => checkin.membershipActive !== true && DATE.test(checkin.date || '')
    && checkin.date >= first && checkin.date <= last).map((checkin) => `${checkin.date}|${checkin.sessionId}`)).size;
};

/**
 * Paid tickets a person holds for events open to non-members in the club year, counted once per event or course
 * however many dates it has. The event's first date decides the club year; tickets without a schedule use the paid date.
 */
export const nonMemberEventVisits = (orders, membershipId, products, clubYear) => {
  const byId = new Map(products.map((product) => [product.id, product]));
  const events = new Set();
  for (const order of orders) {
    if (order.status !== 'paid') continue;
    const person = (order.people || []).find((candidate) => candidate.membershipId === membershipId);
    if (!person) continue;
    for (const item of order.items || []) {
      if (item.revokedAt || !(person.lineIds || []).includes(item.lineId)) continue;
      const product = byId.get(item.id);
      if (!product || product.category !== 'EVENTS' || productMembershipRule(product) !== 'none') continue;
      const startDate = product.eventSchedule?.startDate || item.eventSchedule?.startDate;
      const paidAt = order.paidAt?.toDate?.() || (order.paidAt instanceof Date ? order.paidAt : null);
      const year = DATE.test(startDate || '') ? yearOfDate(startDate) : paidAt ? clubYearOf(paidAt) : null;
      if (year === clubYear) events.add(item.id);
    }
  }
  return events.size;
};

/** e.g. "2 of 3 this club year", with `overLimit` once the count passes the limit. */
export const visitSummary = (count) => ({
  count, overLimit: count > NON_MEMBER_VISIT_LIMIT,
  label: `${count} of ${NON_MEMBER_VISIT_LIMIT} this club year${count > NON_MEMBER_VISIT_LIMIT ? ' – membership needed' : ''}`
});

/** A volunteer's note when unticking self-assessment: required, 3 to 500 characters. */
export const validateSelfAssessmentChange = (body) => {
  if (typeof body?.passed !== 'boolean') return { error: 'Choose whether they have passed the self-assessment.' };
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  if (!body.passed && note.length < 3) return { error: 'Add a note saying why they are not safe to go by themselves, and any advice given.' };
  return { value: { passed: body.passed, note } };
};
