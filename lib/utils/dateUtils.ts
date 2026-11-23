import { format, parseISO, isValid, differenceInDays } from 'date-fns';

/** App calendar timezone — all date-only boundaries (today, month, etc.) use this. */
export const APP_TIMEZONE = 'Asia/Kolkata';

/**
 * Calendar date (yyyy-MM-dd) in APP_TIMEZONE for the given instant.
 * Use instead of `new Date().toISOString().slice(0, 10)` which is UTC.
 */
export function toAppTimezoneDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Today's calendar date (yyyy-MM-dd) in APP_TIMEZONE. */
export function getTodayAppDate(): string {
  return toAppTimezoneDate(new Date());
}

/** Current month key (yyyy-MM) in APP_TIMEZONE. */
export function getAppMonthKey(date: Date = new Date()): string {
  return toAppTimezoneDate(date).slice(0, 7);
}

/** Parse a yyyy-MM-dd string as a local date-only value for day arithmetic. */
export function parseAppDate(dateString: string): Date {
  return parseISO(dateString.slice(0, 10));
}

/** Whole-day difference: event date minus today in APP_TIMEZONE. */
export function daysFromTodayApp(dateString: string): number {
  return differenceInDays(parseAppDate(dateString), parseAppDate(getTodayAppDate()));
}

/**
 * Safe date parser
 * Handles both Date objects and ISO strings
 */
function parseDate(date: Date | string): Date {
  if (date instanceof Date) {
    return date;
  }
  return parseISO(date);
}

/**
 * Centralized date formatters
 * Single source of truth for all date formatting
 */
export const formatters = {
  /**
   * Format to ISO date string (YYYY-MM-DD)
   */
  toISODate: (date: Date | string): string => {
    try {
      return format(parseDate(date), 'yyyy-MM-dd');
    } catch {
      return '';
    }
  },

  /**
   * Format to month-year (MMM yyyy) - e.g., "Jan 2026"
   */
  toMonthYear: (date: Date | string): string => {
    try {
      return format(parseDate(date), 'MMM yyyy');
    } catch {
      return '';
    }
  },

  /**
   * Format to full month-year (MMMM yyyy) - e.g., "January 2026"
   */
  toFullMonthYear: (date: Date | string): string => {
    try {
      return format(parseDate(date), 'MMMM yyyy');
    } catch {
      return '';
    }
  },

  /**
   * Format to full date (dd MMM yyyy) - e.g., "15 Jan 2026"
   */
  toFullDate: (date: Date | string): string => {
    try {
      return format(parseDate(date), 'dd MMM yyyy');
    } catch {
      return '';
    }
  },

  /**
   * Format to compact date (EEE, MMM dd, yyyy) - e.g., "Thu, Jan 15, 2026"
   */
  toCompactDate: (date: Date | string): string => {
    try {
      return format(parseDate(date), 'EEE, MMM dd, yyyy');
    } catch {
      return '';
    }
  },

  /**
   * Format to month key (yyyy-MM) - e.g., "2026-01"
   */
  toMonthKey: (date: Date | string): string => {
    try {
      return format(parseDate(date), 'yyyy-MM');
    } catch {
      return '';
    }
  },

  /**
   * Format to week label (W##) - e.g., "W7"
   */
  toWeekLabel: (date: Date | string): string => {
    try {
      return format(parseDate(date), "'W'w");
    } catch {
      return '';
    }
  },

  /**
   * A stored time of day ("16:50:04") as "4:50 PM"; "~4:50 PM" when it is only
   * the alert's arrival. Empty for anything unreadable, like every formatter here.
   */
  toClock: (time: string | null | undefined, approx = false): string => {
    const match = time?.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    const hour = Number(match[1]);
    if (hour > 23) return '';
    const label = `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
    return approx ? `~${label}` : label;
  },

  /**
   * Format to display time (h:mm a) - e.g., "2:30 PM"
   */
  toTime: (date: Date | string): string => {
    try {
      return format(parseDate(date), 'h:mm a');
    } catch {
      return '';
    }
  },

  /**
   * Format to full datetime (dd MMM yyyy, h:mm a) - e.g., "15 Jan 2026, 2:30 PM"
   */
  toFullDateTime: (date: Date | string): string => {
    try {
      return format(parseDate(date), 'dd MMM yyyy, h:mm a');
    } catch {
      return '';
    }
  },

  /**
   * Safe formatter with fallback
   * Use when you're not sure if the date is valid
   */
  safe: (date: string | Date, formatString: string, fallback: string = 'N/A'): string => {
    if (!date) return fallback;
    try {
      const parsed = parseDate(date);
      return isValid(parsed) ? format(parsed, formatString) : fallback;
    } catch {
      return fallback;
    }
  },
};

/**
 * Month-key arithmetic (`yyyy-MM`), done on the string itself.
 *
 * Working on the string keeps it timezone-free (no `parseISO(month + '-01')`
 * drifting a day near midnight); `current()` is the only part that needs a
 * clock, and it goes through `getAppMonthKey()`.
 */
export const monthKeys = {
  /** `true` for a well-formed `yyyy-MM` with a real month number. */
  isValid: (month: string | null | undefined): boolean => {
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return false;
    const monthIndex = Number(month.slice(5));
    return monthIndex >= 1 && monthIndex <= 12;
  },

  /** The current month in Asia/Kolkata. */
  current: (): string => getAppMonthKey(),

  /** Move `delta` months; returns `month` unchanged if it is malformed. */
  shift: (month: string, delta: number): string => {
    if (!monthKeys.isValid(month)) return month;
    const year = Number(month.slice(0, 4));
    const monthIndex = Number(month.slice(5)) - 1 + delta;
    const shiftedYear = year + Math.floor(monthIndex / 12);
    const shiftedMonth = ((monthIndex % 12) + 12) % 12 + 1;
    return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}`;
  },

  /**
   * Pull `month` inside `[min, max]`. `yyyy-MM` sorts lexicographically, so
   * plain string comparison is the same as chronological comparison.
   */
  clamp: (month: string, min?: string, max?: string): string => {
    if (!monthKeys.isValid(month)) return month;
    if (monthKeys.isValid(max) && month > max!) return max!;
    if (monthKeys.isValid(min) && month < min!) return min!;
    return month;
  },

  /** `true` when `month` sits inside `[min, max]`. */
  isWithin: (month: string, min?: string, max?: string): boolean => {
    if (!monthKeys.isValid(month)) return false;
    if (monthKeys.isValid(min) && month < min!) return false;
    if (monthKeys.isValid(max) && month > max!) return false;
    return true;
  },

  /** Display label — "September 2026". Empty string for a malformed key. */
  label: (month: string): string =>
    monthKeys.isValid(month) ? formatters.toFullMonthYear(`${month}-01`) : '',

  /** Compact display label — "Sep 2026". */
  shortLabel: (month: string): string =>
    monthKeys.isValid(month) ? formatters.toMonthYear(`${month}-01`) : '',
};
