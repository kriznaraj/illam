/**
 * Where the Inbox To-do view starts. Items received before it stay in Money and All, but no
 * longer ask for a decision: on an install that has been running a while, years of old open
 * items would bury the handful that are current.
 *
 * Set `ILLAM_TODO_FROM=yyyy-mm-dd` to choose the day (midnight IST). Unset, nothing is hidden.
 */
export function parseTodoFrom(value: string | undefined): string {
  const day = (value ?? '').trim();
  if (!day) return '1970-01-01T00:00:00+05:30';
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!valid) throw new Error(`ILLAM_TODO_FROM must be a date like 2026-09-01, got "${day}"`);
  return `${day}T00:00:00+05:30`;
}
