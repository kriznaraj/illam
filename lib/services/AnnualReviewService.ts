import type { SupabaseClient } from '@supabase/supabase-js';
import { endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { BaseService } from './BaseService';
import { InsightsRepository } from '@/lib/repositories/InsightsRepository';
import { PortfolioInsightsRepository } from '@/lib/repositories/PortfolioInsightsRepository';
import {
  baselineRecurring,
  buildExpenseInsights,
  prepareExpenseData,
  ONE_TIME_GROUP,
  type ExpenseRow,
} from '@/lib/insights/expenseRules';
import {
  buildPortfolioInsights,
  decomposeGrowth,
  preparePortfolioData,
  recentMonthlySavings,
  LIABILITY_TYPES,
  type InvestmentRow,
  type PortfolioAccountRow,
  type SnapshotRow,
} from '@/lib/insights/portfolioRules';
import { isCashAccount } from '@/lib/portfolio/cashAccounts';
import { medianAbsoluteDeviation, projectLinear } from '@/lib/insights/stats';
import { getTodayAppDate } from '@/lib/utils/dateUtils';
import type { Insight } from '@/types';

/** A year plus the current month, so twelve complete comparisons are available. */
const REVIEW_MONTHS = 12;

/**
 * The twelve-month review that both insights pages link to.
 *
 * Composes the two rule engines rather than recomputing anything: whatever the review
 * says about a month is what the insights page says about that month. Read-only.
 */
export class AnnualReviewService extends BaseService {
  private expenses: InsightsRepository;
  private portfolio: PortfolioInsightsRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.expenses = new InsightsRepository(supabase);
    this.portfolio = new PortfolioInsightsRepository(supabase);
  }

  async getReview() {
    try {
      const today = parseISO(getTodayAppDate());
      const endMonth = startOfMonth(today);
      const startMonth = subMonths(endMonth, REVIEW_MONTHS);
      const analysisMonthKey = format(endMonth, 'yyyy-MM');
      const startMonthKey = format(startMonth, 'yyyy-MM');

      const [expenseResult, accountsResult, snapshotsResult, investmentsResult] = await Promise.all([
        this.expenses.listExpensesWithCategory(
          format(startMonth, 'yyyy-MM-dd'),
          format(endOfMonth(endMonth), 'yyyy-MM-dd')
        ),
        this.portfolio.listAccounts(),
        this.portfolio.listSnapshotsInRange(
          format(startMonth, 'yyyy-MM-dd'),
          format(endOfMonth(endMonth), 'yyyy-MM-dd')
        ),
        // A month earlier: a contribution lands in the snapshot after the month it is dated in.
        this.portfolio.listInvestmentsInRange(
          format(subMonths(startMonth, 1), 'yyyy-MM-dd'),
          format(endOfMonth(endMonth), 'yyyy-MM-dd')
        ),
      ]);

      if (expenseResult.error) throw new Error(expenseResult.error.message);
      if (accountsResult.error) throw new Error(accountsResult.error.message);
      if (snapshotsResult.error) throw new Error(snapshotsResult.error.message);
      if (investmentsResult.error) throw new Error(investmentsResult.error.message);

      const selavu = this.buildSelavu((expenseResult.data ?? []) as any[], analysisMonthKey);
      const selvam = this.buildSelvam({
        accounts: (accountsResult.data ?? []) as any[],
        snapshots: (snapshotsResult.data ?? []) as any[],
        investments: (investmentsResult.data ?? []) as any[],
        startMonthKey,
        analysisMonthKey,
      });

      // Every data-integrity finding from both engines, in one list. These are the
      // items that make every other number on the page provisional.
      const dataHealth: Insight[] = [...selavu.insights, ...selvam.insights].filter(
        (i) => i.type === 'data_quality'
      );

      return {
        status: 200 as const,
        body: {
          window: {
            startMonth: startMonthKey,
            endMonth: analysisMonthKey,
            months: selavu.monthly.map((m) => m.month),
          },
          selavu: {
            monthly: selavu.monthly,
            categories: selavu.categories,
            baseline: selavu.baseline,
            forecast: selavu.forecast,
            totals: selavu.totals,
            insights: selavu.insights,
          },
          selvam: {
            monthly: selvam.monthly,
            typeTotals: selvam.typeTotals,
            decomposition: selvam.decomposition,
            projection: selvam.projection,
            insights: selvam.insights,
          },
          dataHealth,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      this.handleError(e, 'build annual review');
    }
  }

  private buildSelavu(raw: any[], analysisMonthKey: string) {
    const rows: ExpenseRow[] = raw.map((e) => ({
      id: e.id,
      date: e.date,
      amount: parseFloat(e.amount?.toString() ?? '0'),
      categoryId: e.category_id,
      categoryName: e.category?.name || 'Unknown',
      groupName: e.category?.group_name || 'Unknown',
      budget: e.category?.budget != null ? parseFloat(e.category.budget.toString()) : null,
      description: e.description || '',
    }));

    const prepared = prepareExpenseData({ rows, analysisMonthKey, todayAppDate: getTodayAppDate() });
    const allMonths = [...prepared.history, prepared.month];

    const monthly = allMonths.map((m) => ({
      month: m.key,
      label: m.label,
      total: m.total,
      recurring: m.recurring,
      oneTime: m.oneTime,
      count: m.count,
      byGroup: m.byGroup,
      // Flagged rather than hidden: a month with almost nothing logged still appears
      // on the chart, but nothing is computed from it.
      lowConfidence: m.lowConfidence,
    }));

    // Category run-rates across the window: total, and the average of the months the
    // category actually appeared in — the figure that answers "what does this cost me".
    const catTotals = new Map<
      string,
      { name: string; groupName: string; total: number; count: number; months: Set<string> }
    >();
    for (const m of allMonths) {
      for (const cat of Object.values(m.byCategory)) {
        const entry = catTotals.get(cat.categoryId) ?? {
          name: cat.name,
          groupName: cat.groupName,
          total: 0,
          count: 0,
          months: new Set<string>(),
        };
        entry.total += cat.total;
        entry.count += cat.count;
        entry.months.add(m.key);
        catTotals.set(cat.categoryId, entry);
      }
    }

    const categories = Array.from(catTotals.entries())
      .map(([categoryId, c]) => ({
        categoryId,
        name: c.name,
        groupName: c.groupName,
        total: c.total,
        count: c.count,
        activeMonths: c.months.size,
        perActiveMonth: c.total / c.months.size,
      }))
      .sort((a, b) => b.total - a.total);

    const baseline = baselineRecurring(prepared.cleanHistory);
    const recentRecurring = prepared.cleanHistory.slice(-6).map((m) => m.recurring);
    const spread = medianAbsoluteDeviation(recentRecurring);

    const year = Number(analysisMonthKey.slice(0, 4));
    const monthNo = Number(analysisMonthKey.slice(5, 7));
    const fyStartYear = monthNo >= 4 ? year : year - 1;
    const fyMonths = allMonths.filter((m) => m.key >= `${fyStartYear}-04`);
    const fyRecurring = fyMonths.reduce((s, m) => s + m.recurring, 0);
    const fyOneTime = fyMonths.reduce((s, m) => s + m.oneTime, 0);
    // Project the rest of the financial year on the financial year's own run rate, not
    // on the rolling baseline — otherwise a FY that has run at, say, ₹50k/month can get
    // projected forward at a much higher rolling rate and the total comes out far too high.
    const fyClean = fyMonths.filter((m) => !m.lowConfidence);
    const fyPerMonth =
      fyClean.length >= 3 ? baselineRecurring(fyClean) : baseline > 0 ? baseline : fyRecurring / Math.max(1, fyMonths.length);

    return {
      monthly,
      categories,
      baseline,
      forecast: {
        nextMonthLow: Math.max(0, baseline - spread),
        nextMonthMid: baseline,
        nextMonthHigh: baseline + spread,
        fyStartYear,
        fyMonthsElapsed: fyMonths.length,
        fyRecurring,
        fyOneTime,
        fyPerMonth,
        fyProjectedRecurring: fyRecurring + fyPerMonth * Math.max(0, 12 - fyMonths.length),
      },
      totals: {
        total: allMonths.reduce((s, m) => s + m.total, 0),
        recurring: allMonths.reduce((s, m) => s + m.recurring, 0),
        oneTime: allMonths.reduce((s, m) => s + m.oneTime, 0),
        count: allMonths.reduce((s, m) => s + m.count, 0),
        oneTimeShare:
          allMonths.reduce((s, m) => s + m.total, 0) > 0
            ? allMonths.reduce((s, m) => s + m.oneTime, 0) / allMonths.reduce((s, m) => s + m.total, 0)
            : 0,
      },
      insights: buildExpenseInsights(prepared),
    };
  }

  private buildSelvam(params: {
    accounts: any[];
    snapshots: any[];
    investments: any[];
    startMonthKey: string;
    analysisMonthKey: string;
  }) {
    const accounts: PortfolioAccountRow[] = params.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      isActive: a.is_active !== false,
      details: a.details ?? null,
      isCash: isCashAccount(a),
    }));
    const snapshots: SnapshotRow[] = params.snapshots.map((s) => ({
      accountId: s.account_id,
      month: String(s.snapshot_date).slice(0, 7),
      amount: Number(s.amount ?? 0),
      date: String(s.snapshot_date),
    }));
    const investments: InvestmentRow[] = params.investments.map((i) => ({
      accountId: i.account_id,
      month: String(i.investment_date).slice(0, 7),
      amount: Number(i.amount ?? 0),
      kind: i.kind,
      note: i.note ?? null,
    }));

    const prepared = preparePortfolioData({
      accounts,
      snapshots,
      investments,
      startMonthKey: params.startMonthKey,
      analysisMonthKey: params.analysisMonthKey,
      analysisLabel: format(parseISO(`${params.analysisMonthKey}-01`), 'MMMM yyyy'),
    });

    // Per-month totals by account type, for the stacked view.
    const monthly = prepared.months.map((month, index) => {
      const byType: Record<string, number> = {};
      for (const s of prepared.accounts) {
        const known = prepared.months.filter((m) => m <= month && s.byMonth.has(m));
        if (known.length === 0) continue;
        const value = s.byMonth.get(known[known.length - 1])!;
        byType[s.account.type] = (byType[s.account.type] ?? 0) + value;
      }
      return {
        month,
        netWorth: prepared.netWorthByMonth[index],
        contributed:
          (prepared.contributionsByMonth.get(month) ?? 0) + (prepared.sipByMonth.get(month) ?? 0),
        byType,
      };
    });

    // The same decomposition the insights page shows, so the two can never disagree.
    const growth = decomposeGrowth(prepared, 0, prepared.months.length - 1);

    const trailing = prepared.netWorthByMonth.slice(-12);
    const monthlySaved = recentMonthlySavings(prepared);
    const fitted = projectLinear(trailing, 12);
    const floor = growth.end + monthlySaved * 12;

    return {
      monthly,
      typeTotals: prepared.typeTotals,
      decomposition: {
        start: growth.start,
        end: growth.end,
        change: growth.change,
        contributed: growth.contributed,
        catchUp: growth.catchUp,
        saved: growth.saved,
        debtRepaid: growth.debtRepaid,
        signArtefact: growth.signArtefact,
        valuation: growth.marketGain,
        months: prepared.months.length - 1,
        liabilities: prepared.accounts
          .filter((s) => LIABILITY_TYPES.includes(s.account.type))
          .reduce((sum, s) => sum + Math.abs(s.byMonth.get(params.analysisMonthKey) ?? 0), 0),
      },
      projection: {
        low: Math.min(floor, fitted),
        high: Math.max(floor, fitted),
        monthlySaved,
      },
      insights: buildPortfolioInsights(prepared),
    };
  }
}

/** Re-exported so the page can label planning groups without importing the rule module. */
export { ONE_TIME_GROUP };
