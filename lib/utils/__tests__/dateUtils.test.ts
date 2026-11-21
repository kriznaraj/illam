import { describe, it, expect } from 'vitest';
import {
  formatters,
  dateOps,
  dateCompare,
  monthKeys,
  toAppTimezoneDate,
  getTodayAppDate,
  daysFromTodayApp,
  getAppMonthKey,
} from '../dateUtils';
import { addDays, addYears, startOfMonth, endOfMonth, parseISO, format } from 'date-fns';

describe('App timezone (IST)', () => {
  it('maps late UTC to the next IST calendar day', () => {
    expect(toAppTimezoneDate(new Date('2026-06-06T19:30:00Z'))).toBe('2026-06-07');
  });

  it('maps early UTC to the same IST calendar day', () => {
    expect(toAppTimezoneDate(new Date('2026-06-06T18:29:59Z'))).toBe('2026-06-06');
  });

  it('daysFromTodayApp returns 0 for IST today', () => {
    expect(daysFromTodayApp(getTodayAppDate())).toBe(0);
  });
});

describe('Date Formatters', () => {
  describe('formatters.toISODate', () => {
    it('should format dates as YYYY-MM-DD', () => {
      const date = new Date('2024-01-15T12:30:00');
      expect(formatters.toISODate(date)).toBe('2024-01-15');
    });

    it('should accept string dates', () => {
      expect(formatters.toISODate('2024-01-15')).toBe('2024-01-15');
    });

    it('should handle edge of month dates', () => {
      expect(formatters.toISODate('2024-01-31')).toBe('2024-01-31');
      expect(formatters.toISODate('2024-02-29')).toBe('2024-02-29'); // Leap year
    });

    it('should return empty string for invalid dates', () => {
      expect(formatters.toISODate('invalid-date')).toBe('');
      expect(formatters.toISODate('')).toBe('');
    });
  });

  describe('formatters.toFullDate', () => {
    it('should format dates in human-readable format', () => {
      const date = new Date('2024-01-15T12:30:00');
      const result = formatters.toFullDate(date);
      expect(result).toBe('15 Jan 2024');
    });

    it('should handle different months correctly', () => {
      expect(formatters.toFullDate('2024-12-25')).toBe('25 Dec 2024');
      expect(formatters.toFullDate('2024-06-01')).toBe('01 Jun 2024');
    });
  });

  describe('formatters.toCompactDate', () => {
    it('should format dates with day name', () => {
      const date = new Date('2024-01-15T14:30:00');
      const result = formatters.toCompactDate(date);
      expect(result).toMatch(/Mon, Jan 15, 2024/);
    });
  });

  describe('formatters.toTime', () => {
    it('should format time in 12-hour format', () => {
      const date = new Date('2024-01-15T14:30:00');
      const result = formatters.toTime(date);
      expect(result).toMatch(/2:30.*PM/);
    });

    it('should handle AM times', () => {
      const date = new Date('2024-01-15T09:15:00');
      const result = formatters.toTime(date);
      expect(result).toMatch(/9:15.*AM/);
    });

    it('should handle midnight and noon', () => {
      const midnight = new Date('2024-01-15T00:00:00');
      const noon = new Date('2024-01-15T12:00:00');
      expect(formatters.toTime(midnight)).toMatch(/12:00.*AM/);
      expect(formatters.toTime(noon)).toMatch(/12:00.*PM/);
    });
  });

  describe('formatters.toMonthYear', () => {
    it('should format as MMM yyyy', () => {
      expect(formatters.toMonthYear('2024-01-15')).toBe('Jan 2024');
      expect(formatters.toMonthYear('2024-12-25')).toBe('Dec 2024');
    });
  });

  describe('formatters.toMonthKey', () => {
    it('should format as yyyy-MM', () => {
      expect(formatters.toMonthKey('2024-01-15')).toBe('2024-01');
      expect(formatters.toMonthKey('2024-12-25')).toBe('2024-12');
    });
  });

  describe('formatters.toWeekLabel', () => {
    it('should format as W##', () => {
      const result = formatters.toWeekLabel('2024-01-15');
      expect(result).toMatch(/W\d+/);
    });
  });

  describe('formatters.safe', () => {
    it('should format with custom format string', () => {
      const result = formatters.safe('2024-01-15', 'yyyy/MM/dd');
      expect(result).toBe('2024/01/15');
    });

    it('should return fallback for invalid dates', () => {
      expect(formatters.safe('invalid', 'yyyy-MM-dd', 'N/A')).toBe('N/A');
      expect(formatters.safe('', 'yyyy-MM-dd', 'Unknown')).toBe('Unknown');
    });

    it('should use default fallback if not specified', () => {
      expect(formatters.safe('invalid', 'yyyy-MM-dd')).toBe('N/A');
    });
  });
});

describe('Date Operations', () => {
  describe('dateOps.addMonths', () => {
    it('should add months correctly', () => {
      const result = dateOps.addMonths('2024-01-15', 3);
      expect(result).toBe('2024-04-15');
    });

    it('should handle year boundary', () => {
      const result = dateOps.addMonths('2023-11-15', 3);
      expect(result).toBe('2024-02-15');
    });

    it('should handle month-end dates', () => {
      const result = dateOps.addMonths('2024-01-31', 1);
      // February doesn't have 31 days, so it should adjust to Feb 29 (2024 is leap year)
      expect(result).toBe('2024-02-29');
    });

    it('should handle non-leap year February', () => {
      const result = dateOps.addMonths('2023-01-31', 1);
      expect(result).toBe('2023-02-28');
    });

    it('should return empty string for invalid dates', () => {
      expect(dateOps.addMonths('invalid', 1)).toBe('');
    });
  });

  describe('dateOps.subMonths', () => {
    it('should subtract months correctly', () => {
      const result = dateOps.subMonths('2024-04-15', 3);
      expect(result).toBe('2024-01-15');
    });

    it('should handle year boundary', () => {
      const result = dateOps.subMonths('2024-02-15', 3);
      expect(result).toBe('2023-11-15');
    });

    it('should return empty string for invalid dates', () => {
      expect(dateOps.subMonths('invalid', 1)).toBe('');
    });
  });

  describe('dateOps.getCurrentMonth', () => {
    it('should return current month as yyyy-MM', () => {
      const result = dateOps.getCurrentMonth();
      expect(result).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('dateOps.getCurrentDate', () => {
    it('should return current date as yyyy-MM-dd', () => {
      const result = dateOps.getCurrentDate();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('dateOps.getMonthRange', () => {
    it('should return start and end dates for month', () => {
      const result = dateOps.getMonthRange('2024-01');
      expect(result.start).toBe('2024-01-01');
      expect(result.end).toBe('2024-01-31');
    });

    it('should handle February in leap year', () => {
      const result = dateOps.getMonthRange('2024-02');
      expect(result.start).toBe('2024-02-01');
      expect(result.end).toBe('2024-02-29');
    });

    it('should handle February in non-leap year', () => {
      const result = dateOps.getMonthRange('2023-02');
      expect(result.start).toBe('2023-02-01');
      expect(result.end).toBe('2023-02-28');
    });

    it('should handle months with 30 days', () => {
      const result = dateOps.getMonthRange('2024-04');
      expect(result.start).toBe('2024-04-01');
      expect(result.end).toBe('2024-04-30');
    });

    it('should return current month for invalid input', () => {
      const result = dateOps.getMonthRange('invalid');
      expect(result.start).toMatch(/^\d{4}-\d{2}-01$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('dateOps.getMonthBoundaries', () => {
    it('should return Date objects for month boundaries', () => {
      const date = new Date('2024-01-15');
      const result = dateOps.getMonthBoundaries(date);

      expect(result.start).toBeInstanceOf(Date);
      expect(result.end).toBeInstanceOf(Date);
      expect(formatters.toISODate(result.start)).toBe('2024-01-01');
      expect(formatters.toISODate(result.end)).toBe('2024-01-31');
    });

    it('should use current date if none provided', () => {
      const result = dateOps.getMonthBoundaries();
      expect(result.start).toBeInstanceOf(Date);
      expect(result.end).toBeInstanceOf(Date);
    });
  });

  describe('dateOps.getWeekRange', () => {
    it('should return week boundaries (Monday to Sunday)', () => {
      const date = new Date('2024-01-15'); // Monday
      const result = dateOps.getWeekRange(date);

      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should use current date if none provided', () => {
      const result = dateOps.getWeekRange();
      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('dateOps.isValid', () => {
    it('should return true for valid dates', () => {
      expect(dateOps.isValid('2024-01-15')).toBe(true);
      expect(dateOps.isValid(new Date('2024-01-15'))).toBe(true);
    });

    it('should return false for invalid dates', () => {
      expect(dateOps.isValid('invalid')).toBe(false);
      expect(dateOps.isValid('')).toBe(false);
    });
  });

  describe('dateOps.parse', () => {
    it('should parse valid date strings', () => {
      const result = dateOps.parse('2024-01-15');
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2024);
    });

    it('should return null for invalid dates', () => {
      expect(dateOps.parse('invalid')).toBeNull();
      expect(dateOps.parse('')).toBeNull();
    });
  });
});

describe('Date Comparisons', () => {
  describe('dateCompare.isSameDay', () => {
    it('should return true for same calendar day', () => {
      const date1 = new Date('2024-01-15T10:00:00');
      const date2 = new Date('2024-01-15T18:00:00');
      expect(dateCompare.isSameDay(date1, date2)).toBe(true);
    });

    it('should return false for different days', () => {
      const date1 = new Date('2024-01-15T23:59:59');
      const date2 = new Date('2024-01-16T00:00:01');
      expect(dateCompare.isSameDay(date1, date2)).toBe(false);
    });

    it('should handle string dates', () => {
      expect(dateCompare.isSameDay('2024-01-15', '2024-01-15')).toBe(true);
      expect(dateCompare.isSameDay('2024-01-15', '2024-01-16')).toBe(false);
    });

    it('should return false for invalid dates', () => {
      expect(dateCompare.isSameDay('invalid', '2024-01-15')).toBe(false);
    });
  });

  describe('dateCompare.isSameMonth', () => {
    it('should return true for dates in same month', () => {
      expect(dateCompare.isSameMonth('2024-01-15', '2024-01-20')).toBe(true);
      expect(dateCompare.isSameMonth('2024-01-01', '2024-01-31')).toBe(true);
    });

    it('should return false for dates in different months', () => {
      expect(dateCompare.isSameMonth('2024-01-31', '2024-02-01')).toBe(false);
      expect(dateCompare.isSameMonth('2023-12-31', '2024-01-01')).toBe(false);
    });

    it('should return false for invalid dates', () => {
      expect(dateCompare.isSameMonth('invalid', '2024-01-15')).toBe(false);
    });
  });

  describe('dateCompare.isFuture', () => {
    it('should return true for future dates', () => {
      const futureDate = addDays(new Date(), 5);
      expect(dateCompare.isFuture(futureDate)).toBe(true);
    });

    it('should return false for past dates', () => {
      const pastDate = addDays(new Date(), -5);
      expect(dateCompare.isFuture(pastDate)).toBe(false);
    });

    it('should return false for invalid dates', () => {
      expect(dateCompare.isFuture('invalid')).toBe(false);
    });
  });

  describe('dateCompare.isPast', () => {
    it('should return true for past dates', () => {
      const pastDate = addDays(new Date(), -5);
      expect(dateCompare.isPast(pastDate)).toBe(true);
    });

    it('should return false for future dates', () => {
      const futureDate = addDays(new Date(), 5);
      expect(dateCompare.isPast(futureDate)).toBe(false);
    });

    it('should return false for invalid dates', () => {
      expect(dateCompare.isPast('invalid')).toBe(false);
    });
  });

  describe('dateCompare.isToday', () => {
    it('should return true for today', () => {
      expect(dateCompare.isToday(getTodayAppDate())).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = format(addDays(parseISO(getTodayAppDate()), -1), 'yyyy-MM-dd');
      expect(dateCompare.isToday(yesterday)).toBe(false);
    });

    it('should return false for tomorrow', () => {
      const tomorrow = format(addDays(parseISO(getTodayAppDate()), 1), 'yyyy-MM-dd');
      expect(dateCompare.isToday(tomorrow)).toBe(false);
    });
  });
});

describe('monthKeys', () => {
  describe('isValid', () => {
    it('accepts a well-formed month key', () => {
      expect(monthKeys.isValid('2026-09')).toBe(true);
      expect(monthKeys.isValid('2026-01')).toBe(true);
      expect(monthKeys.isValid('2026-12')).toBe(true);
    });

    it('rejects out-of-range and malformed months', () => {
      expect(monthKeys.isValid('2026-00')).toBe(false);
      expect(monthKeys.isValid('2026-13')).toBe(false);
      expect(monthKeys.isValid('2026-9')).toBe(false);
      expect(monthKeys.isValid('2026-09-01')).toBe(false);
      expect(monthKeys.isValid('')).toBe(false);
      expect(monthKeys.isValid(null)).toBe(false);
      expect(monthKeys.isValid(undefined)).toBe(false);
    });
  });

  describe('shift', () => {
    it('moves within a year', () => {
      expect(monthKeys.shift('2026-09', 1)).toBe('2026-10');
      expect(monthKeys.shift('2026-09', -1)).toBe('2026-08');
      expect(monthKeys.shift('2026-09', 0)).toBe('2026-09');
    });

    it('crosses year boundaries in both directions', () => {
      expect(monthKeys.shift('2026-12', 1)).toBe('2027-01');
      expect(monthKeys.shift('2026-01', -1)).toBe('2025-12');
      expect(monthKeys.shift('2026-01', -13)).toBe('2024-12');
      expect(monthKeys.shift('2026-06', 18)).toBe('2027-12');
    });

    // The pages this replaced did the same arithmetic through
    // `parseISO(month + '-01')`, which drifts a day either side of the IST
    // offset. String maths cannot.
    it('is independent of the host timezone', () => {
      expect(monthKeys.shift('2026-03', -1)).toBe('2026-02');
      expect(monthKeys.shift('2026-02', 1)).toBe('2026-03');
    });

    it('returns a malformed input untouched', () => {
      expect(monthKeys.shift('nonsense', 1)).toBe('nonsense');
    });
  });

  describe('clamp', () => {
    it('pulls a month inside the range', () => {
      expect(monthKeys.clamp('2026-01', '2026-04', '2026-09')).toBe('2026-04');
      expect(monthKeys.clamp('2026-12', '2026-04', '2026-09')).toBe('2026-09');
      expect(monthKeys.clamp('2026-06', '2026-04', '2026-09')).toBe('2026-06');
    });

    it('treats missing bounds as unbounded', () => {
      expect(monthKeys.clamp('2030-01', '2026-04', undefined)).toBe('2030-01');
      expect(monthKeys.clamp('1999-01', undefined, '2026-09')).toBe('1999-01');
      expect(monthKeys.clamp('2026-06')).toBe('2026-06');
    });

    it('ignores malformed bounds rather than clamping to them', () => {
      expect(monthKeys.clamp('2026-06', 'garbage', '2026-13')).toBe('2026-06');
    });
  });

  describe('isWithin', () => {
    it('is inclusive at both ends', () => {
      expect(monthKeys.isWithin('2026-04', '2026-04', '2026-09')).toBe(true);
      expect(monthKeys.isWithin('2026-09', '2026-04', '2026-09')).toBe(true);
      expect(monthKeys.isWithin('2026-03', '2026-04', '2026-09')).toBe(false);
      expect(monthKeys.isWithin('2026-10', '2026-04', '2026-09')).toBe(false);
    });

    it('rejects a malformed month whatever the bounds', () => {
      expect(monthKeys.isWithin('2026-13', '2026-01', '2026-12')).toBe(false);
    });
  });

  describe('label', () => {
    it('renders the same label the navigator shows on every browser', () => {
      expect(monthKeys.label('2026-09')).toBe('September 2026');
      expect(monthKeys.shortLabel('2026-09')).toBe('Sep 2026');
    });

    it('returns an empty string rather than throwing on bad input', () => {
      expect(monthKeys.label('2026-13')).toBe('');
      expect(monthKeys.shortLabel('')).toBe('');
    });
  });

  describe('current', () => {
    it('follows the app timezone, not the host clock', () => {
      expect(monthKeys.current()).toBe(getAppMonthKey());
      expect(monthKeys.isValid(monthKeys.current())).toBe(true);
    });
  });
});

describe('Date Edge Cases', () => {
  describe('Leap Year Handling', () => {
    it('should correctly handle Feb 29 in leap year', () => {
      const leapDate = new Date('2024-02-29');
      expect(leapDate.getDate()).toBe(29);
      expect(formatters.toISODate(leapDate)).toBe('2024-02-29');
    });

    it('should handle operations around Feb 29', () => {
      const feb28 = new Date('2024-02-28');
      const nextDay = addDays(feb28, 1);
      expect(formatters.toISODate(nextDay)).toBe('2024-02-29');

      const feb29 = new Date('2024-02-29');
      const dayAfter = addDays(feb29, 1);
      expect(formatters.toISODate(dayAfter)).toBe('2024-03-01');
    });

    it('should handle adding months from Feb 29', () => {
      const result = dateOps.addMonths('2024-02-29', 1);
      expect(result).toBe('2024-03-29');
    });

    it('should handle adding year from Feb 29 to non-leap year', () => {
      const feb29 = new Date('2024-02-29');
      const nextYear = addYears(feb29, 1);
      // 2025 is not a leap year
      expect(formatters.toISODate(nextYear)).toBe('2025-02-28');
    });
  });

  describe('Month Boundary Operations', () => {
    it('should handle adding days across month boundaries', () => {
      const jan31 = new Date('2024-01-31');
      const feb1 = addDays(jan31, 1);
      expect(formatters.toISODate(feb1)).toBe('2024-02-01');
    });

    it('should handle subtracting days across month boundaries', () => {
      const feb1 = new Date('2024-02-01');
      const jan31 = addDays(feb1, -1);
      expect(formatters.toISODate(jan31)).toBe('2024-01-31');
    });

    it('should handle month operations with different month lengths', () => {
      const mar31 = '2024-03-31';
      const apr30 = dateOps.addMonths(mar31, 1);
      // April has 30 days
      expect(apr30).toBe('2024-04-30');
    });
  });

  describe('Year Boundary Operations', () => {
    it('should handle new year transition', () => {
      const dec31 = new Date('2023-12-31');
      const jan1 = addDays(dec31, 1);
      expect(formatters.toISODate(jan1)).toBe('2024-01-01');
    });

    it('should handle year subtraction', () => {
      const jan1 = new Date('2024-01-01');
      const dec31 = addDays(jan1, -1);
      expect(formatters.toISODate(dec31)).toBe('2023-12-31');
    });

    it('should handle adding months across year boundary', () => {
      const result = dateOps.addMonths('2023-11-15', 3);
      expect(result).toBe('2024-02-15');
    });
  });
});

describe('Real-World Use Cases', () => {
  describe('Expense Due Dates', () => {
    it('should calculate next month credit card statement date', () => {
      const statementDate = '2024-01-15';
      const nextStatement = dateOps.addMonths(statementDate, 1);
      expect(nextStatement).toBe('2024-02-15');
    });

    it('should handle recurring monthly expenses on 31st', () => {
      // Gas cylinder refill on Jan 31, next should be Feb 29 (2024 is leap year)
      const jan31 = '2024-01-31';
      const nextMonth = dateOps.addMonths(jan31, 1);
      expect(nextMonth).toBe('2024-02-29');
    });

    it('should calculate quarterly expense (3 months)', () => {
      const jan15 = '2024-01-15';
      const apr15 = dateOps.addMonths(jan15, 3);
      expect(apr15).toBe('2024-04-15');
    });
  });

  describe('Date Range Calculations', () => {
    it('should calculate month start and end for reports', () => {
      const monthRange = dateOps.getMonthRange('2024-01');
      expect(monthRange.start).toBe('2024-01-01');
      expect(monthRange.end).toBe('2024-01-31');
    });

    it('should calculate previous month for reports', () => {
      const today = '2024-06-15';
      const lastMonth = dateOps.subMonths(today, 1);
      expect(lastMonth).toBe('2024-05-15');

      const monthKey = formatters.toMonthKey(lastMonth);
      const range = dateOps.getMonthRange(monthKey);
      expect(range.start).toBe('2024-05-01');
      expect(range.end).toBe('2024-05-31');
    });
  });

  describe('Birthday/Anniversary Recurrence', () => {
    it('should calculate next birthday - Bob (Apr 7)', () => {
      const birthday = new Date('2024-04-07');
      const nextYear = addYears(birthday, 1);
      expect(formatters.toISODate(nextYear)).toBe('2025-04-07');
    });

    it('should calculate next birthday - Alice (Nov 15)', () => {
      const birthday = new Date('2024-11-15');
      const nextYear = addYears(birthday, 1);
      expect(formatters.toISODate(nextYear)).toBe('2025-11-15');
    });

    it('should calculate wedding anniversary (Jun 12)', () => {
      const anniversary = new Date('2024-06-12');
      const nextYear = addYears(anniversary, 1);
      expect(formatters.toISODate(nextYear)).toBe('2025-06-12');
    });

    it('should handle leap year birthdays', () => {
      const leapBirthday = new Date('2024-02-29');
      const nextYear = addYears(leapBirthday, 1);
      // In non-leap year, Feb 29 → Feb 28
      expect(formatters.toISODate(nextYear)).toBe('2025-02-28');
    });
  });

  describe('Monthly Bill Cycles', () => {
    it('should calculate next electric bill (EB)', () => {
      const lastBill = '2024-01-05';
      const nextBill = dateOps.addMonths(lastBill, 1);
      expect(nextBill).toBe('2024-02-05');
    });

    it('should calculate next broadband bill', () => {
      const lastBill = '2024-01-01';
      const nextBill = dateOps.addMonths(lastBill, 1);
      expect(nextBill).toBe('2024-02-01');
    });

    it('should calculate next mobile recharge (monthly)', () => {
      const lastRecharge = '2024-01-20';
      const nextRecharge = dateOps.addMonths(lastRecharge, 1);
      expect(nextRecharge).toBe('2024-02-20');
    });
  });

  describe('Gas Cylinder Refill Tracking', () => {
    it('should calculate next refill from last refill date', () => {
      const lastRefill = '2024-01-15';
      const nextRefill = dateOps.addMonths(lastRefill, 1);
      expect(nextRefill).toBe('2024-02-15');
    });

    it('should handle delayed refill (from actual completion date)', () => {
      // Due: Jan 15, but actually refilled on Jan 20
      const actualRefill = '2024-01-20';
      const nextDue = dateOps.addMonths(actualRefill, 1);
      expect(nextDue).toBe('2024-02-20'); // Next due from actual completion
    });
  });
});

describe('formatters.toClock', () => {
  it('formats a stored time of day', () => {
    expect(formatters.toClock('16:50:04')).toBe('4:50 PM');
    expect(formatters.toClock('00:05:00')).toBe('12:05 AM');
    expect(formatters.toClock('12:30:00')).toBe('12:30 PM');
  });

  it('marks an approximate time', () => {
    expect(formatters.toClock('11:25:13', true)).toBe('~11:25 AM');
  });

  it('is empty for nothing or junk', () => {
    expect(formatters.toClock(null)).toBe('');
    expect(formatters.toClock('soon')).toBe('');
  });
});
