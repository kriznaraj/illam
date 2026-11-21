import { describe, it, expect } from 'vitest';
import {
  latestPerAccountMonth,
  latestRowPerAccountMonth,
  monthlyTotals,
  totalForMonth,
} from '../monthlySnapshots';

const snap = (account_id: string, snapshot_date: string, amount: number) => ({
  account_id,
  snapshot_date,
  amount,
});

/**
 * The rows that caused this: Kite Alice and Alice MF each carry both a
 * 2026-02-01 and a 2026-02-27 snapshot. Summing them added ₹36,78,752 of value that
 * was never there and spiked /portfolio/types/Stocks to ₹1.00Cr between two ₹75L
 * months.
 */
const FEB_DUPLICATES = [
  snap('kite-alice', '2026-02-01', 2_503_751.85),
  snap('kite-alice', '2026-02-27', 2_556_769.63),
  snap('alice-mf', '2026-02-01', 1_175_000),
  snap('alice-mf', '2026-02-27', 1_159_385.83),
];

describe('latestPerAccountMonth', () => {
  it('keeps the latest snapshot within a month, not the first', () => {
    const byAccount = latestPerAccountMonth(FEB_DUPLICATES);

    expect(byAccount.get('kite-alice')!.get('2026-02')).toBe(2_556_769.63);
    expect(byAccount.get('alice-mf')!.get('2026-02')).toBe(1_159_385.83);
  });

  it('is independent of the order rows arrive in', () => {
    // /portfolio/report is correct only because its query happens to ORDER BY
    // snapshot_date; this must not depend on that.
    const forwards = latestPerAccountMonth(FEB_DUPLICATES);
    const backwards = latestPerAccountMonth([...FEB_DUPLICATES].reverse());

    expect(backwards.get('kite-alice')!.get('2026-02')).toBe(
      forwards.get('kite-alice')!.get('2026-02')
    );
  });

  it('keeps months separate for the same account', () => {
    const byAccount = latestPerAccountMonth([
      snap('a', '2026-01-01', 100),
      snap('a', '2026-02-01', 200),
      snap('a', '2026-02-27', 250),
      snap('a', '2026-03-01', 300),
    ]);

    expect(Array.from(byAccount.get('a')!.entries())).toEqual([
      ['2026-01', 100],
      ['2026-02', 250],
      ['2026-03', 300],
    ]);
  });

  it('handles an empty input', () => {
    expect(latestPerAccountMonth([]).size).toBe(0);
  });
});

describe('monthlyTotals', () => {
  it('counts a duplicated account once', () => {
    const totals = monthlyTotals(FEB_DUPLICATES);

    // Not 2322980.97 + 2724238.04 + 1175000 + 1232543.08 = 7394907.31.
    expect(totals.get('2026-02')).toBeCloseTo(2_556_769.63 + 1_159_385.83, 2);
  });

  it('quantifies exactly what the double-count was worth', () => {
    const summedNaively = FEB_DUPLICATES.reduce((sum, s) => sum + s.amount, 0);
    const deduped = monthlyTotals(FEB_DUPLICATES).get('2026-02')!;

    expect(summedNaively - deduped).toBeCloseTo(3_678_751.85, 2);
  });

  it('narrows to a subset of accounts', () => {
    // How the type pages scope a trend to one account type.
    const stocksOnly = monthlyTotals(FEB_DUPLICATES, ['kite-alice']);

    expect(stocksOnly.get('2026-02')).toBe(2_556_769.63);
  });

  it('ignores an account id that has no snapshots', () => {
    expect(monthlyTotals(FEB_DUPLICATES, ['nobody']).size).toBe(0);
  });

  it('sums across accounts and keeps months apart', () => {
    const totals = monthlyTotals([
      snap('a', '2026-01-01', 100),
      snap('b', '2026-01-01', 50),
      snap('a', '2026-02-01', 200),
    ]);

    expect(totals.get('2026-01')).toBe(150);
    expect(totals.get('2026-02')).toBe(200);
  });
});

describe('totalForMonth', () => {
  it('returns the deduped total for one month', () => {
    expect(totalForMonth(FEB_DUPLICATES, '2026-02')).toBeCloseTo(3_716_155.46, 2);
  });

  it('returns 0 for a month with no snapshots', () => {
    expect(totalForMonth(FEB_DUPLICATES, '2026-05')).toBe(0);
  });
});

describe('latestRowPerAccountMonth', () => {
  it('returns the winning row, not just its amount', () => {
    // /portfolio/snapshots needs the row itself: editing or deleting a month has to
    // act on the row being shown, which is the latest one.
    const rows = latestRowPerAccountMonth(FEB_DUPLICATES);

    expect(rows.get('kite-alice')!.get('2026-02')).toMatchObject({
      snapshot_date: '2026-02-27',
      amount: 2_556_769.63,
    });
  });

  it('finds a month whose only row is mid-month', () => {
    // Matching `${month}-01` exactly made such a month read as never recorded.
    const rows = latestRowPerAccountMonth([snap('a', '2026-02-27', 500)]);

    expect(rows.get('a')!.get('2026-02')).toMatchObject({ snapshot_date: '2026-02-27' });
  });

  it('is independent of input order', () => {
    const forwards = latestRowPerAccountMonth(FEB_DUPLICATES);
    const backwards = latestRowPerAccountMonth([...FEB_DUPLICATES].reverse());

    expect(backwards.get('alice-mf')!.get('2026-02')!.snapshot_date).toBe(
      forwards.get('alice-mf')!.get('2026-02')!.snapshot_date
    );
  });
});
