import { describe, expect, it } from 'vitest';
import {
  candidateMatchesLink,
  findContributionCandidates,
  findMatchingTransfer,
  monthEndDate,
  preselectCandidate,
  sipClaimKey,
  type ContributionRow,
  type SipFund,
} from '../contributionMatch';

// Shapes from the live data (2026-09-14): IND Money US Stocks had ₹47,500 entered by hand on
// 2026-07-08 and the same debit waiting in review; May's hand entries drifted to ₹47,590.

const row = (over: Partial<ContributionRow> & { id: string }): ContributionRow => ({
  investment_date: '2026-07-08',
  amount: 47500,
  note: null,
  transfer_id: null,
  ...over,
});

const find = (params: { date: string; amount: number; rows?: ContributionRow[]; funds?: SipFund[]; claimed?: string[] }) =>
  findContributionCandidates({ rows: [], funds: [], ...params, claimedSips: new Set(params.claimed ?? []) });

describe('findContributionCandidates', () => {
  it('finds the hand-entered row for the same deposit, allowing drift in amount and date', () => {
    const candidates = find({
      date: '2026-05-16',
      amount: 47500,
      rows: [row({ id: 'typo', investment_date: '2026-05-17', amount: 47590 }), row({ id: 'far', investment_date: '2026-06-08' })],
    });
    expect(candidates).toEqual([{ kind: 'manual', rowId: 'typo', date: '2026-05-17', amount: 47590, note: null, daysApart: 1 }]);
    expect(preselectCandidate(candidates)?.kind).toBe('manual');
  });

  it('never offers a row another transfer already claimed', () => {
    expect(find({ date: '2026-07-08', amount: 47500, rows: [row({ id: 'claimed', transfer_id: 'transfer-other' })] })).toEqual([]);
  });

  it('offers an auto-monthly row for the same month and amount', () => {
    const candidates = find({
      date: '2026-07-24',
      amount: 25980,
      rows: [row({ id: 'auto-jul', investment_date: '2026-07-01', amount: 25980, note: '__AUTO_MONTHLY__' })],
    });
    expect(candidates).toEqual([{ kind: 'auto_monthly', rowId: 'auto-jul', date: '2026-07-01', amount: 25980 }]);
  });

  it('offers a SIP instalment in effect that month, until another transfer claims it', () => {
    const funds: SipFund[] = [
      { name: 'Parag Parikh Flexi Cap', sip_amount: 5000, amount_history: [{ from_month: '2026-03', amount: 5000 }] },
      { name: 'Stopped fund', sip_amount: 5000, active: false },
    ];
    expect(find({ date: '2026-07-05', amount: 5000, funds })).toEqual([
      { kind: 'sip', fund: 'Parag Parikh Flexi Cap', month: '2026-07', amount: 5000 },
    ]);
    // Before its first instalment the fund was not running.
    expect(find({ date: '2026-02-05', amount: 5000, funds })).toEqual([]);
    expect(find({ date: '2026-07-05', amount: 5000, funds, claimed: [sipClaimKey('Parag Parikh Flexi Cap', '2026-07')] })).toEqual([]);
  });

  it('does not preselect when two records could match', () => {
    const candidates = find({
      date: '2026-07-08',
      amount: 47500,
      rows: [row({ id: 'a', investment_date: '2026-07-07' }), row({ id: 'b', investment_date: '2026-07-10' })],
    });
    expect(candidates.map((c) => (c.kind === 'sip' ? c.fund : c.rowId))).toEqual(['a', 'b']);
    expect(preselectCandidate(candidates)).toBeNull();
  });

  it('matches a redemption only to a hand-entered negative row', () => {
    const rows = [
      row({ id: 'closed', investment_date: '2026-05-20', amount: -107353, note: 'Fund closed' }),
      row({ id: 'deposit', investment_date: '2026-05-20', amount: 107353 }),
    ];
    expect(find({ date: '2026-05-21', amount: -107353, rows }).map((c) => (c.kind === 'sip' ? c.fund : c.rowId))).toEqual(['closed']);
  });
});

describe('candidateMatchesLink', () => {
  it('compares a pick from the sheet with the candidates computed on the server', () => {
    const manual = { kind: 'manual' as const, rowId: 'r1', date: '2026-07-08', amount: 47500, note: null, daysApart: 0 };
    const sip = { kind: 'sip' as const, fund: 'F', month: '2026-07', amount: 5000 };
    expect(candidateMatchesLink(manual, { kind: 'manual', row_id: 'r1' })).toBe(true);
    expect(candidateMatchesLink(manual, { kind: 'auto_monthly', row_id: 'r1' })).toBe(false);
    expect(candidateMatchesLink(sip, { kind: 'sip', fund: 'F', month: '2026-07' })).toBe(true);
    expect(candidateMatchesLink(sip, { kind: 'manual', row_id: 'r1' })).toBe(false);
  });
});

describe('findMatchingTransfer', () => {
  it('finds the confirmed transfer a hand entry would duplicate', () => {
    const transfers = [
      { id: 't-0731', date: '2026-07-31', amount: 47500 },
      { id: 't-0708', date: '2026-07-08', amount: 47500 },
    ];
    expect(findMatchingTransfer('2026-07-09', 47590, transfers)?.id).toBe('t-0708');
    expect(findMatchingTransfer('2026-07-20', 47500, transfers)).toBeNull();
    expect(findMatchingTransfer('2026-07-09', 20000, transfers)).toBeNull();
  });
});

describe('monthEndDate', () => {
  it('handles short months and leap years', () => {
    expect(monthEndDate('2026-02')).toBe('2026-02-28');
    expect(monthEndDate('2028-02')).toBe('2028-02-29');
    expect(monthEndDate('2026-07')).toBe('2026-07-31');
  });
});
