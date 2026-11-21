import { describe, it, expect } from 'vitest';
import { findStaleAccounts, type StaleSnapshotInput } from '../staleness';

const acct = (id: string, name: string, type = 'Long Term', is_active = true) => ({ id, name, type, is_active });

/** Monthly snapshots on the 1st, from the given month→amount map. */
function series(accountId: string, amounts: Record<string, number>): StaleSnapshotInput[] {
  return Object.entries(amounts).map(([month, amount]) => ({
    account_id: accountId,
    snapshot_date: `${month}-01`,
    amount,
  }));
}

describe('findStaleAccounts', () => {
  it('reports a balance frozen across several months, with the month it froze', () => {
    // Real Estate in the live database: unchanged since 2025-07.
    const stale = findStaleAccounts({
      accounts: [acct('flat', 'Flat - AGP Homes', 'Real Estate')],
      snapshots: series('flat', {
        '2025-06': 5_800_000,
        '2025-07': 6_000_000,
        '2025-08': 6_000_000,
        '2025-09': 6_000_000,
        '2025-10': 6_000_000,
      }),
      asOfMonth: '2025-10',
    });

    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      name: 'Flat - AGP Homes',
      amount: 6_000_000,
      monthsAtSameValue: 4,
      since: '2025-07',
    });
  });

  it('leaves an account that moved recently alone', () => {
    const stale = findStaleAccounts({
      accounts: [acct('mf', 'Mutual Funds', 'Mutual Funds')],
      snapshots: series('mf', {
        '2026-06': 1_000_000,
        '2026-07': 1_050_000,
        '2026-08': 1_090_000,
      }),
      asOfMonth: '2026-08',
    });

    expect(stale).toEqual([]);
  });

  it('ignores balances below the materiality bar', () => {
    // SBM & Federal Super Saving holds ₹110 and has been flat for 11 months. True,
    // and not worth a nudge.
    const stale = findStaleAccounts({
      accounts: [acct('sbm', 'SBM & Federal Super Saving', 'Saving Account')],
      snapshots: series('sbm', {
        '2026-05': 110, '2026-06': 110, '2026-07': 110, '2026-08': 110,
      }),
      asOfMonth: '2026-08',
    });

    expect(stale).toEqual([]);
  });

  it('does not mistake a gap in the history for a frozen balance', () => {
    // Only three snapshots exist, months apart, and each one differs. The account is
    // under-snapshotted, not stale — a different problem with a different fix.
    const stale = findStaleAccounts({
      accounts: [acct('ppf', 'PPF Alice')],
      snapshots: series('ppf', { '2025-10': 40_000, '2026-02': 44_000, '2026-08': 48_712 }),
      asOfMonth: '2026-08',
    });

    expect(stale).toEqual([]);
  });

  it('takes the latest row within a month rather than summing duplicates', () => {
    // Two rows dated inside 2026-02 otherwise double-count the account, the same
    // mistake that once manufactured a 17% drawdown.
    const stale = findStaleAccounts({
      accounts: [acct('esop', 'ESOPS', 'ESOPs')],
      snapshots: [
        ...series('esop', { '2025-12': 678_286, '2026-01': 678_286 }),
        { account_id: 'esop', snapshot_date: '2026-02-01', amount: 999_999 },
        { account_id: 'esop', snapshot_date: '2026-02-27', amount: 678_286 },
      ],
      asOfMonth: '2026-02',
    });

    expect(stale).toHaveLength(1);
    expect(stale[0].amount).toBe(678_286);
    expect(stale[0].monthsAtSameValue).toBe(3);
  });

  it('skips archived accounts and ignores months after the one being reviewed', () => {
    const snapshots = [
      ...series('old', { '2026-01': 500_000, '2026-02': 500_000, '2026-03': 500_000 }),
      ...series('gold', { '2026-01': 2_261_475, '2026-02': 2_261_475, '2026-03': 2_261_475, '2026-04': 3_000_000 }),
    ];

    expect(
      findStaleAccounts({ accounts: [acct('old', 'Closed FD', 'Fixed Deposit', false)], snapshots, asOfMonth: '2026-03' })
    ).toEqual([]);

    // Reviewed as of March, the April update has not happened yet.
    const asMarch = findStaleAccounts({ accounts: [acct('gold', 'Physical Gold', 'Gold')], snapshots, asOfMonth: '2026-03' });
    expect(asMarch).toHaveLength(1);
    expect(asMarch[0].monthsAtSameValue).toBe(3);

    // Reviewed as of April it has moved, so it is no longer stale.
    expect(
      findStaleAccounts({ accounts: [acct('gold', 'Physical Gold', 'Gold')], snapshots, asOfMonth: '2026-04' })
    ).toEqual([]);
  });

  it('sorts by the size of the frozen number, biggest first', () => {
    const snapshots = [
      ...series('a', { '2026-01': 50_000, '2026-02': 50_000, '2026-03': 50_000 }),
      ...series('b', { '2026-01': 6_000_000, '2026-02': 6_000_000, '2026-03': 6_000_000 }),
      ...series('c', { '2026-01': 678_286, '2026-02': 678_286, '2026-03': 678_286 }),
    ];
    const stale = findStaleAccounts({
      accounts: [acct('a', 'PPF'), acct('b', 'Flat'), acct('c', 'ESOPS')],
      snapshots,
      asOfMonth: '2026-03',
    });

    expect(stale.map((s) => s.name)).toEqual(['Flat', 'ESOPS', 'PPF']);
  });
});
