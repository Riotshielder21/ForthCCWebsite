import { londonMidnight } from './clubYear.js';
import { sanitizePerson, personDetailErrors, ageOn, normaliseName } from './checkout.js';
import { isValidPersonName, normaliseName as normalisePersonName } from './personalDetails.js';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (time) => {
  const [, hours, minutes] = TIME.exec(time);
  return Number(hours) * 60 + Number(minutes);
};

/** A weekly session's London weekday and same-day start and end times. */
export const validateClubNight = (body) => {
  const weekday = body?.weekday;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: 'Choose the club-night weekday.' };
  if (!TIME.test(body?.start || '') || !TIME.test(body?.end || '')) return { error: 'Enter start and end times as HH:MM.' };
  if (minutesOf(body.end) <= minutesOf(body.start)) return { error: 'Club night must end after it starts on the same day.' };
  return { value: { weekday, start: body.start, end: body.end } };
};

export const CLUB_NIGHT_ID = 'club-night';
export const MAX_CHECKIN_SESSIONS = 12;
const SESSION_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sessionSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
const validDate = (value) => DATE.test(value || '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const checkinRecursOn = (recurrence, date) => {
  if (date < recurrence.startDate || date > recurrence.endDate) return false;
  if (recurrence.frequency === 'daily') return true;
  const first = new Date(`${recurrence.startDate}T00:00:00Z`);
  const current = new Date(`${date}T00:00:00Z`);
  if (recurrence.frequency === 'weekly') return (current - first) % (7 * 86400000) === 0;
  return date.slice(8) === recurrence.startDate.slice(8);
};

/**
 * A named check-in session. `boatHire` shows whether attendees hold boat hire, `subscriptions` whether they hold any shop
 * subscription, and `selfAssessment` whether they have passed the self-assessment checklist (safe to go by themselves).
 */
export const validateCheckinSession = (body) => {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return { error: 'Give each check-in session a name.' };
  const id = SESSION_ID.test(body.id || '') ? body.id : sessionSlug(name);
  if (!id) return { error: `${name}: use letters or numbers in the session name.` };
  let schedule;
  if (body.recurrence !== undefined) {
    const { frequency, startDate, endDate } = body.recurrence || {};
    if (!['daily', 'weekly', 'monthly'].includes(frequency) || !validDate(startDate) || !validDate(endDate) || endDate < startDate) {
      return { error: `${name}: choose a daily, weekly or monthly repeat and valid start and end dates.` };
    }
    if (!TIME.test(body.start || '') || !TIME.test(body.end || '') || minutesOf(body.end) <= minutesOf(body.start)) {
      return { error: `${name}: enter start and end times as HH:MM; the end must be later that day.` };
    }
    schedule = { recurrence: { frequency, startDate, endDate }, start: body.start, end: body.end };
  } else {
    const times = validateClubNight(body);
    if (times.error) return { error: `${name}: ${times.error.replace('the club-night weekday', 'a weekday').replace('Club night', 'The session')}` };
    schedule = times.value;
  }
  // Sessions saved before the single toggle listed specific subscription products; any listed product turns it on.
  const subscriptions = body.subscriptions === true || (Array.isArray(body.subscriptions) && body.subscriptions.length > 0);
  return { value: { id, name, ...schedule,
    ...(body.recurrence === undefined ? { weekday: schedule.weekday } : {}),
    boatHire: body.boatHire === true, subscriptions, selfAssessment: body.selfAssessment === true } };
};

/** The full list of sessions an admin saves. Session ids stay unique so check-ins from different sessions never mix. */
export const validateCheckinSessions = (body) => {
  if (!Array.isArray(body?.sessions)) return { error: 'Send the list of check-in sessions.' };
  if (body.sessions.length > MAX_CHECKIN_SESSIONS) return { error: `Add up to ${MAX_CHECKIN_SESSIONS} check-in sessions.` };
  const sessions = [];
  for (const entry of body.sessions) {
    const { error, value } = validateCheckinSession(entry);
    if (error) return { error };
    let id = value.id;
    for (let suffix = 2; sessions.some((session) => session.id === id); suffix += 1) id = `${value.id.slice(0, 36)}-${suffix}`;
    sessions.push({ ...value, id });
  }
  return { value: sessions };
};

/** Saved sessions. The original single club-night setting reads as one "Club night" session with boat hire shown. */
export const checkinSessionsFrom = (settings) => {
  if (Array.isArray(settings?.sessions)) return settings.sessions.map((session) => validateCheckinSession(session).value).filter(Boolean);
  const { value } = validateClubNight(settings);
  return value ? [{ id: CLUB_NIGHT_ID, name: 'Club night', ...value, boatHire: true, subscriptions: false, selfAssessment: false }] : [];
};

const londonFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hourCycle: 'h23'
});

/** Check-ins and volunteer access are open all day on scheduled London dates; `openSessions` are today's. */
export const clubNightStatus = (settings, now = new Date()) => {
  const parts = Object.fromEntries(londonFormat.formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const sessions = checkinSessionsFrom(settings);
  if (!sessions.length) return { configured: false, open: false, date };
  const today = WEEKDAYS.indexOf(parts.weekday);
  const openSessions = sessions.filter((session) => session.recurrence
    ? checkinRecursOn(session.recurrence, date) : session.weekday === today)
    .sort((left, right) => left.start.localeCompare(right.start));
  const dayEndsAt = londonMidnight(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1).getTime();
  return { configured: true, open: openSessions.length > 0, date, dayEndsAt, sessions, openSessions };
};

export const sessionDescription = (session) => session.recurrence
  ? `${session.recurrence.frequency}, ${session.recurrence.startDate} to ${session.recurrence.endDate}, ${session.start}–${session.end}`
  : `${WEEKDAYS[session.weekday]}s, ${session.start}–${session.end}`;
export const clubNightDescription = (status) => status.configured
  ? status.sessions.map((session) => `${session.name}: ${sessionDescription(session)}`).join('; ') : 'not scheduled yet';

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Check-in identity: name, date of birth and email. The date of birth is only used for matching. */
export const validateCheckinIdentity = (body, now = new Date()) => {
  const firstName = normalisePersonName(text(body?.firstName, 80));
  const lastName = normalisePersonName(text(body?.lastName, 80));
  const email = text(body?.email, 254).toLowerCase();
  const dob = text(body?.dob, 10);
  if (!firstName || !lastName) return { error: 'Enter your first and last name.' };
  if (!isValidPersonName(firstName)) return { error: 'Enter a valid first name using letters, spaces, apostrophes or hyphens.' };
  if (!isValidPersonName(lastName)) return { error: 'Enter a valid last name using letters, spaces, apostrophes or hyphens.' };
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (ageOn(dob, now) === null || dob < '1900-01-01') return { error: 'Enter a valid date of birth.' };
  return { value: { firstName, lastName, email, dob } };
};

/** A non-member gives the same details as a membership (without becoming a member), checked like checkout. */
export const validateGuestDetails = (identity, details, now = new Date()) => {
  const junior = ageOn(identity.dob, now) < 18;
  const person = sanitizePerson({ ...details, id: 'guest', lineIds: [], returning: false, junior,
    firstName: identity.firstName, lastName: identity.lastName, dob: identity.dob,
    ...(junior ? { guardian: { ...details?.guardian, email: identity.email } } : { email: identity.email }) });
  const errors = personDetailErrors(person, 'Your details', [], now);
  return errors.length ? { error: errors[0] } : { value: person };
};

/** Records found by email whose name and date of birth both agree with what was entered. */
export const matchingCheckinRecords = (records, identity) => {
  const name = normaliseName(`${identity.firstName} ${identity.lastName}`);
  return records.filter((record) => record.dob === identity.dob && normaliseName(`${record.firstName || ''} ${record.lastName || ''}`) === name);
};
