import { describe, it, expect } from 'vitest';
import { findLateStatements, isStatementArrival, type StatementArrival } from '../statementCadence';

const monthly = (owner: 'alice' | 'bob', source: string, dates: string[]): StatementArrival[] =>
  dates.map((date) => ({ owner, source, date }));

describe('findLateStatements', () => {
  // The case that prompted it: the CAS came on the 9th, 8th and 10th, then not in October.
  const cas = monthly('alice', 'cdsl_cas', ['2026-07-09', '2026-08-08', '2026-09-10']);

  it('flags a monthly statement once it is past its usual gap plus grace', () => {
    expect(findLateStatements(cas, '2026-10-14')).toEqual([
      {
        owner: 'alice',
        source: 'cdsl_cas',
        institution: 'CDSL',
        lastReceived: '2026-09-10',
        // Its usual day (the 9th), not "the last arrival plus a gap".
        expectedBy: '2026-10-09',
        usualGapDays: 32,
      },
    ]);
  });

  it('says nothing while a statement is still within its rhythm', () => {
    expect(findLateStatements(cas, '2026-10-11')).toEqual([]);
  });

  it('learns a weekly rhythm as readily as a monthly one', () => {
    const weekly = monthly('bob', 'indmoney', ['2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04']);
    expect(findLateStatements(weekly, '2026-10-13')).toEqual([]);
    expect(findLateStatements(weekly, '2026-10-14')).toHaveLength(1);
  });

  it('counts two statements on one day (two cards) as one arrival', () => {
    const cards = monthly('alice', 'hdfc_card_statement', ['2026-07-09', '2026-07-09', '2026-08-09', '2026-08-09', '2026-09-09']);
    expect(findLateStatements(cards, '2026-10-11')).toEqual([]);
  });

  it('does not expect a monthly statement days after a late one', () => {
    // Arrived on the 30th instead of the 9th: the next is due the 9th of the month after.
    const lateOne = monthly('alice', 'cdsl_cas', ['2026-06-09', '2026-07-09', '2026-08-09', '2026-09-30']);
    expect(findLateStatements(lateOne, '2026-10-14')).toEqual([]);
    expect(findLateStatements(lateOne, '2026-11-12')).toHaveLength(1);
  });

  it('waits for enough history before judging', () => {
    expect(findLateStatements(monthly('alice', 'nps_protean', ['2026-07-10', '2026-08-09']), '2026-12-01')).toEqual([]);
  });

  it('judges each owner separately', () => {
    const both = [...cas, ...monthly('bob', 'cdsl_cas', ['2026-08-08', '2026-09-10', '2026-10-09'])];
    expect(findLateStatements(both, '2026-10-14').map((s) => s.owner)).toEqual(['alice']);
  });
});

describe('isStatementArrival', () => {
  it('counts statements, and bank account statements stored as notices', () => {
    expect(isStatementArrival('cdsl_cas', 'investment_statement')).toBe(true);
    expect(isStatementArrival('icici_cards', 'card_statement')).toBe(true);
    expect(isStatementArrival('hdfc_account_statement', 'notice')).toBe(true);
  });

  it('does not count other mail that carries a PDF', () => {
    // INDmoney deposit confirmations and tax reports.
    expect(isStatementArrival('indmoney', 'notice')).toBe(false);
  });
});
