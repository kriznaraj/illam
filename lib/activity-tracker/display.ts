import { format, parseISO } from 'date-fns';
import type { ActivityTrackerEvent } from '@/types';
import { daysUntil, isWithinReminderWindow } from '@/lib/utils/recurrenceUtils';
import { getTodayAppDate } from '@/lib/utils/dateUtils';

export function getEventStatusLabel(event: ActivityTrackerEvent, isHistory: boolean): string | null {
  if (isHistory || event.status === 'closed') {
    return event.event_type === 'annual' ? null : 'Closed';
  }

  if (event.event_type === 'annual') {
    const days = daysUntil(event.event_date);
    if (days < 0) return 'Past due';
    if (isWithinReminderWindow(event.event_date, event.reminder_days_before)) {
      return days === 0 ? 'Today!' : `In ${days} days`;
    }
    return format(parseISO(event.event_date), 'MMM d');
  }

  if (event.event_type === 'one_time') return 'Open';
  return 'Tracking';
}

export function getStatusBadgeClass(label: string): string {
  if (label === 'Today!' || label === 'Past due') return 'bg-orange-100 text-orange-700';
  if (label === 'Open' || label === 'Tracking') return 'bg-green-100 text-green-700';
  return 'bg-gray-100 text-gray-600';
}

export function getStatusActionCopy(event: ActivityTrackerEvent, reopen: boolean) {
  const isActivity = event.event_type === 'activity';

  if (reopen) {
    return {
      title: isActivity ? 'Resume tracking?' : 'Reopen event?',
      message: isActivity
        ? `Resume tracking "${event.title}"?`
        : `Reopen "${event.title}"?`,
      button: isActivity ? 'Resume tracking' : 'Reopen',
      toast: isActivity ? 'Tracking resumed' : 'Event reopened',
    };
  }

  return {
    title: isActivity ? 'Stop tracking?' : 'Close event?',
    message: isActivity
      ? `Stop tracking "${event.title}"? Past logs are kept — you can resume later from History.`
      : `Close "${event.title}"?`,
    button: isActivity ? 'Stop tracking' : 'Close',
    toast: isActivity ? 'Tracking stopped' : 'Event closed',
  };
}

export function getDuplicateOccurrenceMessage(date: string): string {
  const today = getTodayAppDate();
  return date === today ? 'Already logged for today' : 'Already logged for this date';
}

export function summarizeOccurrences(occurrences: { occurred_at: string }[]) {
  const today = getTodayAppDate();
  return {
    count: occurrences.length,
    lastDate: occurrences[0]?.occurred_at ?? null,
    loggedToday: occurrences.some((occ) => occ.occurred_at === today),
  };
}

export function countEventsByType(events: ActivityTrackerEvent[]) {
  return {
    one_time: events.filter((e) => e.event_type === 'one_time').length,
    activity: events.filter((e) => e.event_type === 'activity').length,
    annual: events.filter((e) => e.event_type === 'annual').length,
  };
}
