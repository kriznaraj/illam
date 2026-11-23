import { describe, it, expect } from 'vitest';
import { parseTodoFrom } from '../todoFrom';

describe('parseTodoFrom', () => {
  it('starts at the beginning when unset, so a new install shows everything', () => {
    expect(parseTodoFrom(undefined)).toBe('1970-01-01T00:00:00+05:30');
    expect(parseTodoFrom('')).toBe('1970-01-01T00:00:00+05:30');
  });

  it('starts at midnight IST on the given date', () => {
    expect(parseTodoFrom('2026-09-01')).toBe('2026-09-01T00:00:00+05:30');
    expect(parseTodoFrom(' 2026-09-01 ')).toBe('2026-09-01T00:00:00+05:30');
  });

  it('rejects anything that is not a real yyyy-mm-dd date', () => {
    expect(() => parseTodoFrom('01-09-2026')).toThrow(/ILLAM_TODO_FROM/);
    expect(() => parseTodoFrom('2026-13-01')).toThrow(/ILLAM_TODO_FROM/);
  });
});
