import { describe, expect, it } from 'vitest';
import { awaitsStatement } from '../statementWait';

describe('awaitsStatement', () => {
  it('waits for the following month’s statement', () => {
    expect(awaitsStatement({ date: '2026-10-14', note: 'Account transfer (NEFT/IMPS)' }, '2026-10-18')).toBe(true);
    expect(awaitsStatement({ date: '2026-10-14', note: null }, '2026-11-14')).toBe(true);
  });

  it('is work once the statement is overdue', () => {
    expect(awaitsStatement({ date: '2026-10-14', note: null }, '2026-11-15')).toBe(false);
  });

  it('is work once a statement line was matched, whatever the date', () => {
    expect(awaitsStatement({ date: '2026-10-14', note: 'Statement: NEFT DR-…-ACME' }, '2026-10-18')).toBe(false);
  });

  it('rolls over the year', () => {
    expect(awaitsStatement({ date: '2026-12-20', note: null }, '2027-01-14')).toBe(true);
    expect(awaitsStatement({ date: '2026-12-20', note: null }, '2027-01-15')).toBe(false);
  });
});
