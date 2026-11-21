import { describe, expect, it } from 'vitest';
import { autoApplyKind, evidenceKey, quoteFound, relevantHistory } from '../claudeResolve';

const line = 'UPI-ACMEHQ-acmehq@ yespay-YESB0YESUPI-••0001-Pay out Request Value Dt 03/09/2026';

describe('quoteFound', () => {
  it('finds a quote despite case, spacing and punctuation', () => {
    expect(quoteFound('acmehq@ YESPAY', [line])).toBe(true);
    expect(quoteFound('pay out  request', [line])).toBe(true);
  });

  it('refuses a quote that is not in the evidence', () => {
    expect(quoteFound('Salary credit', [line])).toBe(false);
  });

  it('refuses a quote too short to prove anything', () => {
    expect(quoteFound('UPI', [line])).toBe(false);
    expect(quoteFound(null, [line])).toBe(false);
  });
});

describe('autoApplyKind', () => {
  const sure = { confidence: 'high' as const, reason: 'r', quote: 'A1-K BOB' };
  const evidence = ['50100…1303-TPT-HDFC1B87 A1-K BOB'];

  it('applies a confident, quoted, re-labelling kind', () => {
    expect(autoApplyKind({ ...sure, kind: 'family' }, 'debit', evidence)).toBe('family');
  });

  it('only suggests when the quote is not really there', () => {
    expect(autoApplyKind({ ...sure, kind: 'family', quote: 'BOB ALICE' }, 'debit', evidence)).toBeNull();
  });

  it('only suggests when Claude is less than sure', () => {
    expect(autoApplyKind({ ...sure, kind: 'family', confidence: 'medium' }, 'debit', evidence)).toBeNull();
  });

  it('never applies an investment, an expense or income — those write other records', () => {
    for (const kind of ['investment', 'expense', 'income', 'unsure'] as const) {
      expect(autoApplyKind({ ...sure, kind }, 'debit', evidence)).toBeNull();
    }
  });

  it('applies only household moves to money in: "other" would count as income', () => {
    expect(autoApplyKind({ ...sure, kind: 'other' }, 'credit', evidence)).toBeNull();
    expect(autoApplyKind({ ...sure, kind: 'family' }, 'credit', evidence)).toBe('family');
  });
});

describe('evidenceKey', () => {
  it('changes when the statement line arrives', () => {
    const before = { note: 'Account transfer (NEFT/IMPS)', counterparty: null, amount: 50000, date: '2026-10-14' };
    expect(evidenceKey(before)).not.toBe(evidenceKey({ ...before, note: 'Statement: NEFT DR-ACME' }));
    expect(evidenceKey(before)).toBe(evidenceKey({ ...before }));
  });
});

describe('relevantHistory', () => {
  it('puts the same payee first, then the same amount, then the newest', () => {
    const history = [
      { id: 'a', date: '2026-09-01', amount: 100, counterparty: 'X' },
      { id: 'b', date: '2026-08-01', amount: 25000, counterparty: null },
      { id: 'c', date: '2026-07-01', amount: 999, counterparty: 'ZERODHA' },
      { id: 'self', date: '2026-10-07', amount: 25000, counterparty: 'ZERODHA' },
    ];
    expect(relevantHistory({ id: 'self', amount: 25000, counterparty: 'Zerodha' }, history).map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });
});
