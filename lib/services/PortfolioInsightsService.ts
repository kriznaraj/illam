import type { SupabaseClient } from '@supabase/supabase-js';
import { endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { BaseService } from './BaseService';
import { PortfolioInsightsRepository } from '@/lib/repositories/PortfolioInsightsRepository';
import {
  buildPortfolioInsights,
  portfolioSummary,
  preparePortfolioData,
  type InvestmentRow,
  type PortfolioAccountRow,
  type SnapshotRow,
} from '@/lib/insights/portfolioRules';
import { isCashAccount } from '@/lib/portfolio/cashAccounts';

/**
 * Months of history behind the analysis month.
 *
 * The previous implementation read exactly three snapshot dates (this month, last
 * month, Jan 1) and so could not see staleness, drawdown, or the difference between
 * money added and money earned.
 */
const WINDOW_MONTHS = 12;

export class PortfolioInsightsService extends BaseService {
  private repo: PortfolioInsightsRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new PortfolioInsightsRepository(supabase);
  }

  async getInsights(month: string) {
    try {
      if (!month) {
        return { status: 400 as const, body: { error: 'Month parameter required (yyyy-MM)' } };
      }
      const monthDate = parseISO(`${month}-01`);
      const analysisMonthKey = format(monthDate, 'yyyy-MM');
      const startDate = format(startOfMonth(subMonths(monthDate, WINDOW_MONTHS)), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
      // A contribution lands in the snapshot after the month it is dated in, so the
      // window's first move is made of flows from the month before the window.
      const flowsStartDate = format(startOfMonth(subMonths(monthDate, WINDOW_MONTHS + 1)), 'yyyy-MM-dd');

      const [accountsResult, snapshotsResult, investmentsResult] = await Promise.all([
        this.repo.listAccounts(),
        this.repo.listSnapshotsInRange(startDate, endDate),
        this.repo.listInvestmentsInRange(flowsStartDate, endDate),
      ]);

      if (accountsResult.error) throw new Error(accountsResult.error.message);
      if (snapshotsResult.error) throw new Error(snapshotsResult.error.message);
      if (investmentsResult.error) throw new Error(investmentsResult.error.message);

      const accounts: PortfolioAccountRow[] = ((accountsResult.data ?? []) as any[]).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        isActive: a.is_active !== false,
        details: a.details ?? null,
        isCash: isCashAccount(a),
      }));

      const snapshots: SnapshotRow[] = ((snapshotsResult.data ?? []) as any[]).map((s) => ({
        accountId: s.account_id,
        month: String(s.snapshot_date).slice(0, 7),
        amount: Number(s.amount ?? 0),
        date: String(s.snapshot_date),
      }));

      const investments: InvestmentRow[] = ((investmentsResult.data ?? []) as any[]).map((i) => ({
        accountId: i.account_id,
        month: String(i.investment_date).slice(0, 7),
        amount: Number(i.amount ?? 0),
        kind: i.kind,
        note: i.note ?? null,
      }));

      const hasData = snapshots.some((s) => s.month === analysisMonthKey);

      const prepared = preparePortfolioData({
        accounts,
        snapshots,
        investments,
        startMonthKey: format(startOfMonth(subMonths(monthDate, WINDOW_MONTHS)), 'yyyy-MM'),
        analysisMonthKey,
        analysisLabel: format(monthDate, 'MMMM yyyy'),
      });

      const insights = hasData ? buildPortfolioInsights(prepared) : [];
      const base = portfolioSummary(prepared);

      return {
        status: 200 as const,
        body: {
          summary: {
            ...base,
            insightCount: insights.length,
          },
          insights,
          analysisMonth: analysisMonthKey,
          // Rule-based only; lib/ai is not used for portfolio insights.
          generatedBy: 'rules' as const,
          hasData,
        },
      };
    } catch (e) {
      this.handleError(e, 'generate portfolio insights');
    }
  }
}
