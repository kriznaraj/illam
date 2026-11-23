import { describe, it, expect } from 'vitest';
import { computeScopedPortfolioData } from '../dashboardCalculations';

const account = (id: string, type: string) => ({ id, name: id, type }) as never;
const snap = (account_id: string, snapshot_date: string, amount: number) => ({ account_id, snapshot_date, amount }) as never;

describe('computeScopedPortfolioData growth', () => {
  // October fully recorded; November only has one of the two accounts so far, as on the
  // 23rd when most of the month's statements had not arrived yet.
  const input = {
    accountsData: [account('kite', 'Stocks'), account('mf', 'Mutual Funds')],
    snapshotsData: [
      snap('kite', '2026-10-01', 1_000_000),
      snap('mf', '2026-10-01', 1_000_000),
      snap('kite', '2026-11-01', 990_000),
    ],
    reportData: null,
    scope: 'all',
    equityTypeSet: new Set<string>(),
  } as never;

  it('carries an unrecorded account forward instead of reading it as zero', () => {
    const { growthMetrics } = computeScopedPortfolioData(input);

    // 1,990,000 against 2,000,000, not 990,000 against 2,000,000 (−50.5%).
    expect(growthMetrics.mom).toBeCloseTo(-0.5, 5);
  });

  it('carries forward in the per-type month change too', () => {
    const { typeSummaries } = computeScopedPortfolioData(input);
    const mf = typeSummaries.find((t) => t.type === 'Mutual Funds')!;

    expect(mf.diff).toBe(0);
  });
});
