import { londonMidnight } from './clubYear.js';
import { sanitizePerson, personDetailErrors, ageOn, normaliseName } from './checkout.js';

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
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const sessionSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

/**
 * A named weekly check-in session. `boatHire` shows whether attendees hold boat hire; `subscriptions` lists the
 * subscription products ({ id, name }) any one of which an attendee needs, so volunteers can see who holds one.
 */
export const validateCheckinSession = (body) => {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return { error: 'Give each check-in session a name.' };
  const times = validateClubNight(body);
  if (times.error) return { error: `${name}: ${times.error.replace('the club-night weekday', 'a weekday').replace('Club night', 'The session')}` };
  const id = SESSION_ID.test(body.id || '') ? body.id : sessionSlug(name);
  if (!id) return { error: `${name}: use letters or numbers in the session name.` };
  const subscriptions = [];
  for (const entry of Array.isArray(body.subscriptions) ? body.subscriptions : []) {
    const productId = typeof entry === 'string' ? entry : entry?.id;
    if (!PRODUCT_ID.test(productId || '') || subscriptions.some((existing) => existing.id === productId)) continue;
    const productName = typeof entry?.name === 'string' ? entry.name.trim().slice(0, 80) : '';
    subscriptions.push({ id: productId, name: productName || productId });
  }
  return { value: { id, name, ...times.value, boatHire: body.boatHire === true, subscriptions: subscriptions.slice(0, 10) } };
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
  return value ? [{ id: CLUB_NIGHT_ID, name: 'Club night', ...value, boatHire: true, subscriptions: [] }] : [];
};

const londonFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hourCycle: 'h23'
});

/** Check-ins and volunteer access are open all day on each session's London weekday; `openSessions` are today's. */
export const clubNightStatus = (settings, now = new Date()) => {
  const parts = Object.fromEntries(londonFormat.formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const sessions = checkinSessionsFrom(settings);
  if (!sessions.length) return { configured: false, open: false, date };
  const today = WEEKDAYS.indexOf(parts.weekday);
  const openSessions = sessions.filter((session) => session.weekday === today).sort((left, right) => left.start.localeCompare(right.start));
  const dayEndsAt = londonMidnight(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1).getTime();
  return { configured: true, open: openSessions.length > 0, date, dayEndsAt, sessions, openSessions };
};

export const sessionDescription = (session) => `${WEEKDAYS[session.weekday]}s, ${session.start}–${session.end}`;
export const clubNightDescription = (status) => status.configured
  ? status.sessions.map((session) => `${session.name}: ${sessionDescription(session)}`).join('; ') : 'not scheduled yet';

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Check-in identity: name, date of birth and email. The date of birth is only used for matching. */
export const validateCheckinIdentity = (body, now = new Date()) => {
  const firstName = text(body?.firstName, 80);
  const lastName = text(body?.lastName, 80);
  const email = text(body?.email, 254).toLowerCase();
  const dob = text(body?.dob, 10);
  if (!firstName || !lastName) return { error: 'Enter your first and last name.' };
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
