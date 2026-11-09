export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MAX_REGULAR_SESSIONS = 40;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const DEFAULT_REGULAR_SESSIONS = [
  { id: 'slalom-tuesday', discipline: 'Slalom', name: '', weekday: 2, startTime: '19:00', endTime: '', season: '', location: 'Canal', timeZone: 'Europe/London', active: true },
  { id: 'polo-friday-beginners', discipline: 'Polo', name: 'Beginner friendly', weekday: 5, startTime: '18:00', endTime: '', season: '', location: 'Canal', timeZone: 'Europe/London', active: true },
  { id: 'polo-wednesday-intermediate', discipline: 'Polo', name: 'Intermediate', weekday: 3, startTime: '19:00', endTime: '', season: '', location: 'Canal', timeZone: 'Europe/London', active: true },
  { id: 'polo-monday-advanced', discipline: 'Polo', name: 'Advanced', weekday: 1, startTime: '18:00', endTime: '', season: '', location: 'Canal', timeZone: 'Europe/London', active: true },
  { id: 'sprint-thursday', discipline: 'Sprint & Marathon', name: 'Coached session', weekday: 4, startTime: '18:00', endTime: '', season: 'Summer Only', location: 'Canal', timeZone: 'Europe/London', active: true },
  { id: 'sprint-sunday', discipline: 'Sprint & Marathon', name: 'Coached session', weekday: 0, startTime: '14:00', endTime: '', season: 'Winter Only', location: 'Canal', timeZone: 'Europe/London', active: true }
];

const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');

export const validateRegularSessions = (body) => {
  if (!Array.isArray(body?.sessions)) return { error: 'Send the list of regular sessions.' };
  if (body.sessions.length > MAX_REGULAR_SESSIONS) return { error: `Add up to ${MAX_REGULAR_SESSIONS} regular sessions.` };

  const sessions = [];
  for (const entry of body.sessions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { error: 'Each regular session must be an object.' };
    const discipline = text(entry?.discipline, 60);
    const name = text(entry?.name, 60);
    const location = text(entry?.location, 100);
    const season = text(entry?.season, 60);
    if (!discipline) return { error: 'Give each regular session a discipline.' };
    if (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6) return { error: `${discipline}: choose a weekday.` };
    if (!TIME.test(entry.startTime || '') || (entry.endTime && !TIME.test(entry.endTime))) {
      return { error: `${discipline}: enter valid start and optional end times as HH:MM.` };
    }
    if (entry.endTime && entry.endTime <= entry.startTime) return { error: `${discipline}: the end time must be later than the start time.` };

    const baseId = ID.test(entry.id || '') ? entry.id : slug(`${discipline}-${name || WEEKDAYS[entry.weekday]}-${entry.startTime}`);
    if (!baseId) return { error: `${discipline}: use letters or numbers for the session ID.` };
    let id = baseId;
    for (let suffix = 2; sessions.some((session) => session.id === id); suffix += 1) id = `${baseId.slice(0, 36)}-${suffix}`;
    sessions.push({
      id, discipline, name, weekday: entry.weekday, startTime: entry.startTime, endTime: entry.endTime || '',
      season, location, timeZone: 'Europe/London', active: entry.active !== false
    });
  }
  return { value: sessions };
};

export const sortRegularSessions = (sessions) => [...sessions].sort((a, b) =>
  a.weekday - b.weekday || a.startTime.localeCompare(b.startTime) || a.discipline.localeCompare(b.discipline));
