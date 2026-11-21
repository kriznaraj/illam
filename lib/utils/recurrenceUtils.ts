import { addYears, parseISO, format } from 'date-fns';
import { daysFromTodayApp, getTodayAppDate } from './dateUtils';

/**
 * Advance an annual event date by one year
 */
export function advanceAnnualDate(date: string | Date): string {
  const base = typeof date === 'string' ? parseISO(date) : date;
  return format(addYears(base, 1), 'yyyy-MM-dd');
}

/**
 * Days until a date (negative = overdue), using APP_TIMEZONE calendar today.
 */
export function daysUntil(dateString: string): number {
  return daysFromTodayApp(dateString);
}

/**
 * Whether an annual event is within its reminder window
 */
export function isWithinReminderWindow(eventDate: string, reminderDaysBefore: number): boolean {
  const days = daysUntil(eventDate);
  return days >= 0 && days <= reminderDaysBefore;
}

export { getTodayAppDate };
