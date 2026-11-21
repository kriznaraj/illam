import { describe, it, expect, vi, beforeEach } from 'vitest';

const snapshots = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock('../PortfolioSnapshotService', () => ({
  PortfolioSnapshotService: class {
    constructor() {
      return snapshots as any;
    }
  },
}));

import { StatementBalanceService, isMonthEnd } from '../StatementBalanceService';

const mapping = { alice: { 'hdfc_account_statement:3101': 'acc-salary' } };

beforeEach(() => {
  vi.clearAllMocks();
  snapshots.upsert.mockResolvedValue({});
});

describe('isMonthEnd', () => {
  it('knows the last day of each month', () => {
    expect(isMonthEnd('2026-07-31')).toBe(true);
    expect(isMonthEnd('2026-06-30')).toBe(true);
    expect(isMonthEnd('2028-02-29')).toBe(true);
    expect(isMonthEnd('2026-07-30')).toBe(false);
    expect(isMonthEnd(null)).toBe(false);
  });
});

describe('StatementBalanceService.apply', () => {
  it("writes a mapped account's closing balance as the next month's 1st", async () => {
    const outcome = await new StatementBalanceService({} as any, mapping).apply('alice', 'hdfc_account_statement', {
      periodTo: '2026-07-31',
      balances: [
        { last4: '3101', closing: 258957.83, reconciled: true },
        { last4: '1202', closing: 31889.49, reconciled: true },
      ],
    });

    expect(snapshots.upsert).toHaveBeenCalledTimes(1);
    expect(snapshots.upsert).toHaveBeenCalledWith({ account_id: 'acc-salary', snapshot_date: '2026-08-01', amount: 258957.83 });
    expect(outcome).toEqual({
      status: 'done',
      snapshotDate: '2026-08-01',
      results: [
        { last4: '3101', status: 'applied', accountId: 'acc-salary', amount: 258957.83 },
        { last4: '1202', status: 'unmapped', amount: 31889.49 },
      ],
    });
  });

  it('never writes a balance whose statement figures do not add up', async () => {
    const outcome = await new StatementBalanceService({} as any, mapping).apply('alice', 'hdfc_account_statement', {
      periodTo: '2026-07-31',
      balances: [{ last4: '3101', closing: 258957.83, reconciled: false }],
    });
    expect(snapshots.upsert).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ results: [{ last4: '3101', status: 'not_reconciled' }] });
  });

  it('keys the mapping by source, so the same digits from another bank stay unmapped', async () => {
    await new StatementBalanceService({} as any, mapping).apply('alice', 'kotak_account_statement', {
      periodTo: '2026-07-31',
      balances: [{ last4: '3101', closing: 1, reconciled: true }],
    });
    expect(snapshots.upsert).not.toHaveBeenCalled();
  });

  it('applies nothing from a statement that does not end on a month end', async () => {
    const outcome = await new StatementBalanceService({} as any, mapping).apply('alice', 'hdfc_account_statement', {
      periodTo: '2026-07-15',
      balances: [{ last4: '3101', closing: 1, reconciled: true }],
    });
    expect(outcome).toEqual({ status: 'not_month_end', periodTo: '2026-07-15' });
    expect(snapshots.upsert).not.toHaveBeenCalled();
  });

  it('reports a failed write for that account and carries on with the rest', async () => {
    snapshots.upsert.mockRejectedValueOnce(new Error('timeout'));
    const outcome = await new StatementBalanceService({} as any, {
      alice: { 'hdfc_account_statement:3101': 'acc-a', 'hdfc_account_statement:1202': 'acc-b' },
    }).apply('alice', 'hdfc_account_statement', {
      periodTo: '2026-07-31',
      balances: [
        { last4: '3101', closing: 1, reconciled: true },
        { last4: '1202', closing: 2, reconciled: true },
      ],
    });
    expect(outcome).toMatchObject({
      results: [
        { last4: '3101', status: 'failed', message: 'timeout' },
        { last4: '1202', status: 'applied', accountId: 'acc-b' },
      ],
    });
  });
});
