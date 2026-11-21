import type { SupabaseClient } from '@supabase/supabase-js';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { BaseService } from './BaseService';
import { PortfolioReportRepository, type PortfolioReportSnapshotRow } from '@/lib/repositories/PortfolioReportRepository';

export class PortfolioReportService extends BaseService {
  private repo: PortfolioReportRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new PortfolioReportRepository(supabase);
  }

  async getReport(params: { monthsBack: number; accountType: string | null }) {
    try {
      const monthsBack = Number(params.monthsBack || 12);
      const accountType = params.accountType ?? null;

      const endDate = new Date();
      const requestedStart = subMonths(endDate, monthsBack - 1);

      const { data: earliestRows, error: earliestError } = await this.repo.findEarliestSnapshotDate(accountType);
      if (earliestError) throw new Error(earliestError.message);

      const earliestSnapshotDate =
        (earliestRows as any)?.[0]?.snapshot_date != null ? new Date((earliestRows as any)[0].snapshot_date) : null;
      const earliestDataMonth = earliestSnapshotDate ? startOfMonth(earliestSnapshotDate) : requestedStart;
      let startDate =
        earliestSnapshotDate == null ? requestedStart : requestedStart > earliestDataMonth ? requestedStart : earliestDataMonth;

      const LAST_3Y_MONTHS = 36;
      const last3yStart = startOfMonth(subMonths(endDate, LAST_3Y_MONTHS - 1));
      if (startDate < last3yStart) startDate = last3yStart;

      const startStr = format(startOfMonth(startDate), 'yyyy-MM-dd');
      const endStr = format(endOfMonth(endDate), 'yyyy-MM-dd');
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 50;

      const snapshots: PortfolioReportSnapshotRow[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore && snapshots.length < PAGE_SIZE * MAX_PAGES) {
        const { data: page, error: pageError } = await this.repo.listSnapshotsPage({
          startStr,
          endStr,
          offset,
          pageSize: PAGE_SIZE,
          accountType,
        });
        if (pageError) throw new Error(pageError.message);
        const rows = (page ?? []) as unknown as PortfolioReportSnapshotRow[];
        if (!rows.length) break;
        snapshots.push(...rows);
        hasMore = rows.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }

      const { data: accounts, error: accountsError } = await this.repo.listActiveAccounts(accountType);
      if (accountsError) throw new Error(accountsError.message);

      const months: string[] = [];
      const startMonth = startOfMonth(startDate);
      const endMonth = endOfMonth(endDate);
      for (let d = new Date(startMonth); d <= endMonth; d.setMonth(d.getMonth() + 1)) {
        months.push(format(new Date(d), 'yyyy-MM'));
      }

      type PortfolioAccount = { id: string; name: string; type: string; sort_order: number; is_active: boolean };

      const accountMonthlyData: {
        [accountId: string]: {
          account: PortfolioAccount;
          monthlyBalances: { [month: string]: number | null };
          carriedMonths: string[];
          latestBalance: number | null;
          growth: number | null;
          growthPercent: number | null;
        };
      } = {};

      (accounts ?? []).forEach((account: any) => {
        accountMonthlyData[account.id] = {
          account,
          monthlyBalances: {},
          carriedMonths: [],
          latestBalance: null,
          growth: null,
          growthPercent: null,
        };
        months.forEach((month) => {
          accountMonthlyData[account.id].monthlyBalances[month] = null;
        });
      });

      // Latest snapshot_date within a month wins. This assigned rather than summed, so
      // it never double-counted, but which of two rows in a month survived depended on
      // the repository's ORDER BY — correct by accident. Made explicit.
      const chosenDate: Record<string, string> = {};
      snapshots.forEach((snapshot) => {
        const month = format(new Date(snapshot.snapshot_date), 'yyyy-MM');
        const account = Array.isArray(snapshot.portfolio_accounts) ? snapshot.portfolio_accounts[0] : snapshot.portfolio_accounts;
        const accountId = (account as any)?.id || snapshot.account_id;
        const amount = parseFloat((snapshot.amount as any).toString());
        if (!accountMonthlyData[accountId]) return;

        const tieKey = `${accountId}|${month}`;
        const incumbent = chosenDate[tieKey];
        const date = String(snapshot.snapshot_date);
        if (incumbent !== undefined && incumbent >= date) return;
        chosenDate[tieKey] = date;

        accountMonthlyData[accountId].monthlyBalances[month] = amount;
      });

      Object.values(accountMonthlyData).forEach((accData) => {
        let lastKnown: number | null = null;
        months.forEach((month) => {
          if (accData.monthlyBalances[month] !== null) {
            lastKnown = accData.monthlyBalances[month];
          } else if (lastKnown !== null) {
            accData.monthlyBalances[month] = lastKnown;
            accData.carriedMonths.push(month);
          }
        });
      });

      Object.values(accountMonthlyData).forEach((accData) => {
        const balances = months.map((m) => accData.monthlyBalances[m]).filter((b) => b !== null) as number[];
        if (balances.length > 0) {
          accData.latestBalance = balances[balances.length - 1];
          const firstBalance = balances[0];
          accData.growth = accData.latestBalance - firstBalance;
          accData.growthPercent = firstBalance !== 0 ? (accData.growth / Math.abs(firstBalance)) * 100 : 0;
        }
      });

      const monthlyTotals: { [month: string]: number } = {};
      months.forEach((month) => (monthlyTotals[month] = 0));
      Object.values(accountMonthlyData).forEach((accData) => {
        months.forEach((month) => {
          const balance = accData.monthlyBalances[month];
          if (balance !== null) monthlyTotals[month] += balance;
        });
      });

      const groupedData: Record<string, any[]> = {};
      Object.values(accountMonthlyData).forEach((accData) => {
        const typeName = accData.account.type;
        groupedData[typeName] = groupedData[typeName] ?? [];
        groupedData[typeName].push(accData);
      });

      const typeBalances: Record<string, { latestTotal: number; growth: number; growthPercent: number }> = {};
      Object.entries(groupedData).forEach(([typeName, accs]) => {
        let latestTotal = 0;
        let firstTotal = 0;
        let hasFirstBalance = false;
        accs.forEach((accData: any) => {
          if (accData.latestBalance !== null) latestTotal += accData.latestBalance;
          for (const month of months) {
            const balance = accData.monthlyBalances[month];
            if (balance !== null) {
              firstTotal += balance;
              hasFirstBalance = true;
              break;
            }
          }
        });
        const growth = latestTotal - firstTotal;
        const growthPercent = hasFirstBalance && firstTotal !== 0 ? (growth / Math.abs(firstTotal)) * 100 : 0;
        typeBalances[typeName] = { latestTotal, growth, growthPercent };
      });

      const grandTotal = Object.values(monthlyTotals).reduce((sum, val) => sum + val, 0);
      const firstMonthTotal = monthlyTotals[months[0]] || 0;
      const lastMonthTotal = monthlyTotals[months[months.length - 1]] || 0;
      const overallGrowth = lastMonthTotal - firstMonthTotal;
      const overallGrowthPercent = firstMonthTotal !== 0 ? (overallGrowth / Math.abs(firstMonthTotal)) * 100 : 0;

      return {
        months,
        groupedData,
        monthlyTotals,
        typeBalances,
        grandTotal,
        currentTotal: lastMonthTotal,
        overallGrowth,
        overallGrowthPercent,
      };
    } catch (e) {
      this.handleError(e, 'generate portfolio report');
    }
  }
}

