import { describe, it, expect } from 'vitest';
import {
  advanceAnnualDate,
  daysUntil,
  isWithinReminderWindow,
  getTodayAppDate,
} from '../recurrenceUtils';
import { format, addDays, subDays, parseISO } from 'date-fns';

describe('ActivityTracker recurrence helpers', () => {
  describe('advanceAnnualDate', () => {
    it('advances by one year', () => {
      expect(advanceAnnualDate('2024-04-07')).toBe('2025-04-07');
    });

    it('handles leap year dates', () => {
      expect(advanceAnnualDate('2024-02-29')).toBe('2025-02-28');
    });
  });

  describe('daysUntil', () => {
    it('returns 0 for today', () => {
      expect(daysUntil(getTodayAppDate())).toBe(0);
    });

    it('returns positive for future dates', () => {
      const future = format(addDays(parseISO(getTodayAppDate()), 5), 'yyyy-MM-dd');
      expect(daysUntil(future)).toBe(5);
    });

    it('returns negative for past dates', () => {
      const past = format(subDays(parseISO(getTodayAppDate()), 3), 'yyyy-MM-dd');
      expect(daysUntil(past)).toBe(-3);
    });
  });

  describe('isWithinReminderWindow', () => {
    it('returns true when event is within reminder window', () => {
      const in3Days = format(addDays(parseISO(getTodayAppDate()), 3), 'yyyy-MM-dd');
      expect(isWithinReminderWindow(in3Days, 7)).toBe(true);
    });

    it('returns true on the event day', () => {
      expect(isWithinReminderWindow(getTodayAppDate(), 7)).toBe(true);
    });

    it('returns false when outside reminder window', () => {
      const in10Days = format(addDays(parseISO(getTodayAppDate()), 10), 'yyyy-MM-dd');
      expect(isWithinReminderWindow(in10Days, 7)).toBe(false);
    });

    it('returns false for past dates', () => {
      const past = format(subDays(parseISO(getTodayAppDate()), 1), 'yyyy-MM-dd');
      expect(isWithinReminderWindow(past, 7)).toBe(false);
    });
  });
});
