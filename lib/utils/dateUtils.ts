import { format, parseISO, isValid, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, differenceInDays } from 'date-fns';

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
   * A stored time of day ("16:50:04", migration 038) as "4:50 PM"; "~4:50 PM" when it is only
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
 * Common date operations
 */
export const dateOps = {
  /**
   * Get current month as YYYY-MM
   */
  getCurrentMonth: (): string => {
    return getAppMonthKey();
  },

  /**
   * Get current date as YYYY-MM-DD
   */
  getCurrentDate: (): string => {
    return getTodayAppDate();
  },

  /**
   * Get month range (start and end dates)
   */
  getMonthRange: (monthString: string): { start: string; end: string } => {
    try {
      const date = parseISO(monthString + '-01');
      return {
        start: format(startOfMonth(date), 'yyyy-MM-dd'),
        end: format(endOfMonth(date), 'yyyy-MM-dd'),
      };
    } catch {
      const now = new Date();
      return {
        start: format(startOfMonth(now), 'yyyy-MM-dd'),
        end: format(endOfMonth(now), 'yyyy-MM-dd'),
      };
    }
  },

  /**
   * Get month boundaries as Date objects
   */
  getMonthBoundaries: (date: Date = new Date()): { start: Date; end: Date } => {
    return {
      start: startOfMonth(date),
      end: endOfMonth(date),
    };
  },

  /**
   * Get week range (start and end dates)
   */
  getWeekRange: (date: Date = new Date()): { start: string; end: string } => {
    return {
      start: format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      end: format(endOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    };
  },

  /**
   * Add months to a date
   */
  addMonths: (date: Date | string, months: number): string => {
    try {
      return format(addMonths(parseDate(date), months), 'yyyy-MM-dd');
    } catch {
      return '';
    }
  },

  /**
   * Subtract months from a date
   */
  subMonths: (date: Date | string, months: number): string => {
    try {
      return format(subMonths(parseDate(date), months), 'yyyy-MM-dd');
    } catch {
      return '';
    }
  },

  /**
   * Check if date is valid
   */
  isValid: (date: Date | string): boolean => {
    try {
      return isValid(parseDate(date));
    } catch {
      return false;
    }
  },

  /**
   * Parse date safely
   */
  parse: (dateString: string): Date | null => {
    try {
      const date = parseISO(dateString);
      return isValid(date) ? date : null;
    } catch {
      return null;
    }
  },
};

function toCalendarDateString(date: Date | string): string | null {
  try {
    const d = typeof date === 'string' ? date.slice(0, 10) : formatters.toISODate(date);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch {
    return null;
  }
}

/**
 * Date comparison utilities
 */
export const dateCompare = {
  /**
   * Check if two dates are the same day
   */
  isSameDay: (date1: Date | string, date2: Date | string): boolean => {
    try {
      const d1 = typeof date1 === 'string' ? date1.slice(0, 10) : formatters.toISODate(date1);
      const d2 = typeof date2 === 'string' ? date2.slice(0, 10) : formatters.toISODate(date2);
      return d1 === d2;
    } catch {
      return false;
    }
  },

  /**
   * Check if two dates are in the same month
   */
  isSameMonth: (date1: Date | string, date2: Date | string): boolean => {
    try {
      return formatters.toMonthKey(date1) === formatters.toMonthKey(date2);
    } catch {
      return false;
    }
  },

  /**
   * Check if date is in the future
   */
  isFuture: (date: Date | string): boolean => {
    const d = toCalendarDateString(date);
    if (!d) return false;
    return d > getTodayAppDate();
  },

  /**
   * Check if date is in the past
   */
  isPast: (date: Date | string): boolean => {
    const d = toCalendarDateString(date);
    if (!d) return false;
    return d < getTodayAppDate();
  },

  /**
   * Check if date is today
   */
  isToday: (date: Date | string): boolean => {
    const d = toCalendarDateString(date);
    if (!d) return false;
    return d === getTodayAppDate();
  },
};

/**
 * Month-key arithmetic (`yyyy-MM`), done on the string itself.
 *
 * Every month navigator used to do this inline with `parseISO(month + '-01')`
 * and `new Date()`, which meant six pages each had their own idea of what the
 * current month was — and, near midnight IST, a different one from the server.
 * Working on the string keeps it timezone-free; `current()` is the only part
 * that needs a clock, and it goes through `getAppMonthKey()`.
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

const dateUtils = {
  formatters,
  dateOps,
  dateCompare,
  monthKeys,
};

export default dateUtils;
