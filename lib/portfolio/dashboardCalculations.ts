import { formatMonth } from '@/lib/utils';
import type { PortfolioAccount, PortfolioSnapshot } from '@/types';
import { carriedPerAccountMonth, monthlyTotals } from './monthlySnapshots';

export interface AccountWithLatestBalance extends PortfolioAccount {
  latestBalance: number;
  latestDate: string;
}

export interface TypeSummary {
  type: string;
  total: number;
  diff: number | null;
  diffPercent: number | null;
  accounts: AccountWithLatestBalance[];
}

export interface TrendPoint {
  month: string;
  value?: number;
  movingAvg?: number;
}

type ReportGroupedEntry = {
  monthlyBalances?: Record<string, number | null>;
};

export interface PortfolioDashboardReport {
  months?: string[];
  monthlyTotals?: Record<string, number>;
  groupedData?: Record<string, ReportGroupedEntry[]>;
}

export interface GrowthMetrics {
  mom: number;
  ytd: number;
  yoy: number;
}

export interface ScopedPortfolioData {
  accounts: AccountWithLatestBalance[];
  snapshots: PortfolioSnapshot[];
  typeSummaries: TypeSummary[];
  totalNetWorth: number;
  growthMetrics: GrowthMetrics;
  portfolioTrend: TrendPoint[];
  medianNetWorth: number;
}

interface ScopedDataInput {
  accountsData: PortfolioAccount[];
  snapshotsData: PortfolioSnapshot[];
  reportData: PortfolioDashboardReport | null;
  scope: 'all' | 'equity';
  equityTypeSet: Set<string>;
}

export const computeScopedPortfolioData = ({
  accountsData,
  snapshotsData,
  reportData,
  scope,
  equityTypeSet,
}: ScopedDataInput): ScopedPortfolioData => {
  const includeType = (type: string) => scope === 'all' || equityTypeSet.size === 0 || equityTypeSet.has(type);
  const filteredAccountsData = accountsData.filter((account) => includeType(account.type));
  const includedAccountIds = new Set(filteredAccountsData.map((account) => account.id));
  const filteredSnapshotsData = snapshotsData.filter((snapshot) => includedAccountIds.has(snapshot.account_id));

  const accountBalanceMap: Record<string, { balance: number; date: string }> = {};
  filteredSnapshotsData.forEach((snapshot) => {
    const existing = accountBalanceMap[snapshot.account_id];
    if (!existing || snapshot.snapshot_date > existing.date) {
      accountBalanceMap[snapshot.account_id] = { balance: snapshot.amount, date: snapshot.snapshot_date };
    }
  });

  const accountsWithBalances: AccountWithLatestBalance[] = filteredAccountsData.map((account) => ({
    ...account,
    latestBalance: accountBalanceMap[account.id]?.balance || 0,
    latestDate: accountBalanceMap[account.id]?.date || '',
  }));

  const snapshotMonths = Array.from(new Set(filteredSnapshotsData.map((snapshot) => snapshot.snapshot_date.substring(0, 7))))
    .sort()
    .reverse();
  const latestMonth = snapshotMonths[0] ?? null;
  const previousMonth = snapshotMonths[1] ?? null;
  const accountTypeById: Record<string, string> = {};
  for (const account of filteredAccountsData) {
    accountTypeById[account.id] = account.type;
  }

  // One balance per (account, month) — see lib/portfolio/monthlySnapshots.ts. Adding
  // up every row double-counts any account that carries both a 1st-of-month and a
  // mid-month snapshot, inflating that month by the whole of its balance. An account
  // not yet recorded this month counts at its last balance, not as zero.
  const typeMonthTotals: Record<string, { current: number; prev: number }> = {};
  if (latestMonth) {
    for (const [accountId, series] of carriedPerAccountMonth(filteredSnapshotsData)) {
      const type = accountTypeById[accountId];
      if (!type) continue;
      typeMonthTotals[type] = typeMonthTotals[type] ?? { current: 0, prev: 0 };
      const current = series.get(latestMonth);
      if (current !== undefined) typeMonthTotals[type].current += current;
      const prev = previousMonth ? series.get(previousMonth) : undefined;
      if (prev !== undefined) typeMonthTotals[type].prev += prev;
    }
  }

  const typeMap: Record<string, AccountWithLatestBalance[]> = {};
  accountsWithBalances.forEach((account) => {
    if (!typeMap[account.type]) typeMap[account.type] = [];
    typeMap[account.type].push(account);
  });

  const typeSummaries: TypeSummary[] = Object.entries(typeMap).map(([type, accounts]) => ({
    type,
    total: accounts.reduce((sum, account) => sum + account.latestBalance, 0),
    diff: previousMonth ? (typeMonthTotals[type]?.current ?? 0) - (typeMonthTotals[type]?.prev ?? 0) : null,
    diffPercent:
      previousMonth && (typeMonthTotals[type]?.prev ?? 0) !== 0
        ? (((typeMonthTotals[type]?.current ?? 0) - (typeMonthTotals[type]?.prev ?? 0)) /
            Math.abs(typeMonthTotals[type]?.prev ?? 0)) *
          100
        : null,
    accounts,
  }));
  typeSummaries.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  const totalNetWorth = accountsWithBalances.reduce((sum, account) => sum + account.latestBalance, 0);

  const growthMetrics: GrowthMetrics = { mom: 0, ytd: 0, yoy: 0 };
  if (snapshotMonths.length >= 2) {
    const latestSnapshotMonth = snapshotMonths[0];
    const previousSnapshotMonth = snapshotMonths[1];
    // Deduped too: these feed the MoM / YTD / YoY headline percentages, so a
    // double-counted month would misstate growth in both directions around it. Carried
    // forward, so a month whose statements are still arriving is not read as a crash.
    const totalsByMonth = monthlyTotals(filteredSnapshotsData, undefined, { carryForward: true });
    const getSnapshotTotal = (month: string) => totalsByMonth.get(month) ?? 0;

    const currentTotal = getSnapshotTotal(latestSnapshotMonth);
    const previousTotal = getSnapshotTotal(previousSnapshotMonth);
    if (previousTotal !== 0 && Math.abs(currentTotal - previousTotal) > 0.01) {
      growthMetrics.mom = ((currentTotal - previousTotal) / Math.abs(previousTotal)) * 100;
    }

    const latestDate = new Date(`${latestSnapshotMonth}-01`);
    const currentYear = latestDate.getFullYear();
    const currentMonthNum = latestDate.getMonth() + 1;
    const fyStartYear = currentMonthNum >= 4 ? currentYear : currentYear - 1;
    const fyStartMonth = `${fyStartYear}-04`;
    const prevFyEndMonth = `${fyStartYear}-03`;
    let ytdBaseline = 0;
    if (currentMonthNum === 4) {
      if (snapshotMonths.includes(prevFyEndMonth)) ytdBaseline = getSnapshotTotal(prevFyEndMonth);
    } else if (snapshotMonths.includes(fyStartMonth)) {
      ytdBaseline = getSnapshotTotal(fyStartMonth);
    } else {
      const fyStartDate = new Date(`${fyStartMonth}-01`);
      const eligibleMonths = snapshotMonths.filter((month) => new Date(`${month}-01`) >= fyStartDate);
      if (eligibleMonths.length > 0) ytdBaseline = getSnapshotTotal(eligibleMonths[eligibleMonths.length - 1]);
    }

    if (ytdBaseline !== 0 && Math.abs(currentTotal - ytdBaseline) > 0.01) {
      growthMetrics.ytd = ((currentTotal - ytdBaseline) / Math.abs(ytdBaseline)) * 100;
    }

    const year12MonthsAgo = latestDate.getFullYear() - 1;
    const month12MonthsAgo = String(latestDate.getMonth() + 1).padStart(2, '0');
    const month12MAgo = `${year12MonthsAgo}-${month12MonthsAgo}`;
    let yoyBaseline = 0;
    if (snapshotMonths.includes(month12MAgo)) {
      yoyBaseline = getSnapshotTotal(month12MAgo);
    } else {
      const targetDate = new Date(`${month12MAgo}-01`);
      const eligibleMonths = snapshotMonths.filter((month) => new Date(`${month}-01`) <= targetDate);
      if (eligibleMonths.length > 0) yoyBaseline = getSnapshotTotal(eligibleMonths[0]);
    }
    if (yoyBaseline !== 0 && Math.abs(currentTotal - yoyBaseline) > 0.01) {
      growthMetrics.yoy = ((currentTotal - yoyBaseline) / Math.abs(yoyBaseline)) * 100;
    }
  }

  const portfolioTrend: TrendPoint[] = [];
  let medianNetWorth = 0;
  if (reportData?.months?.length && reportData.monthlyTotals && reportData.groupedData) {
    const months = reportData.months;
    const monthTotals: Record<string, number> = {};
    for (const month of months) monthTotals[month] = 0;

    if (scope === 'equity' && equityTypeSet.size > 0) {
      for (const [type, entries] of Object.entries(reportData.groupedData)) {
        if (!equityTypeSet.has(type)) continue;
        for (const entry of entries) {
          for (const month of months) {
            const value = entry.monthlyBalances?.[month];
            if (typeof value === 'number') monthTotals[month] += value;
          }
        }
      }
    } else {
      for (const month of months) monthTotals[month] = reportData.monthlyTotals[month] ?? 0;
    }

    months.forEach((month) => {
      portfolioTrend.push({
        month: formatMonth(`${month}-01`),
        value: monthTotals[month] ?? 0,
      });
    });

    const movingAvgPeriod = 6;
    portfolioTrend.forEach((point, index) => {
      if (index >= movingAvgPeriod - 1) {
        const sum = portfolioTrend
          .slice(index - movingAvgPeriod + 1, index + 1)
          .reduce((acc, trendPoint) => acc + (trendPoint.value || 0), 0);
        point.movingAvg = sum / movingAvgPeriod;
      }
    });

    const values = portfolioTrend
      .map((point) => point.value || 0)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    medianNetWorth =
      values.length > 0
        ? values.length % 2 === 0
          ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
          : values[Math.floor(values.length / 2)]
        : 0;
  }

  return {
    accounts: accountsWithBalances,
    snapshots: filteredSnapshotsData,
    typeSummaries,
    totalNetWorth,
    growthMetrics,
    portfolioTrend,
    medianNetWorth,
  };
};
