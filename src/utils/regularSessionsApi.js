import { apiFetch, apiUrl } from './api';

export async function loadRegularSessions() {
  const response = await apiFetch(apiUrl('/api/regular-sessions'), { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load the timetable.');
  if (!Array.isArray(result.sessions)) throw new Error('Invalid timetable response.');
  return result.sessions;
}
