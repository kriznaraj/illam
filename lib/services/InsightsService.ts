import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from '@/lib/services/BaseService';
import { InsightsRepository } from '@/lib/repositories/InsightsRepository';
import { generateLLMInsights } from '@/lib/llm-insights';
import { isAIEnabled } from '@/lib/ai';
import { getTodayAppDate } from '@/lib/utils/dateUtils';
import {
  buildExpenseInsights,
  prepareExpenseData,
  type ExpenseRow,
} from '@/lib/insights/expenseRules';
import type { Insight, InsightEngine } from '@/types';
import { endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';

/**
 * How many months of history to fetch behind the analysis month.
 *
 * This was 11, which meant the same calendar month one year earlier was always
 * exactly one month outside the window — so the year-over-year rule could never
 * fire, despite existing. 12 makes it reachable.
 */
const HISTORY_MONTHS = 12;

const SEVERITY_ORDER: Record<Insight['severity'], number> = { danger: 0, warning: 1, info: 2, success: 3 };

export class InsightsService extends BaseService {
  private repo: InsightsRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new InsightsRepository(supabase);
  }

  /**
   * @param params.persist  Write the result back to `insights_cache`. Defaults to true.
   *   The backfill script sets it false so its dry run genuinely does not write.
   */
  async getInsights(params: { monthParam?: string | null; forceRegenerate: boolean; persist?: boolean }) {
    try {
      const monthParam = params.monthParam ?? null;
      const forceRegenerate = params.forceRegenerate;
      const persist = params.persist ?? true;

      // Default to last closed month (previous month)
      const lastClosedMonth = subMonths(startOfMonth(new Date()), 1);
      const targetMonth = monthParam ? parseISO(monthParam + '-01') : lastClosedMonth;
      const analysisMonthKey = format(targetMonth, 'yyyy-MM');

      // Check cache first (only for closed months, unless force regenerate)
      const isClosedMonth = targetMonth < startOfMonth(new Date());
      if (isClosedMonth && !forceRegenerate) {
        const { data: cachedData } = await this.repo.getCachedInsights(analysisMonthKey);
        if (cachedData) {
          return {
            status: 200 as const,
            body: {
              insights: (cachedData as any).insights,
              summary: (cachedData as any).summary,
              analysisMonth: analysisMonthKey,
              cached: true,
              // Rows cached before the engine was recorded report as unknown rather than
              // claiming to be AI-generated.
              generatedBy: ((cachedData as any).summary?.generatedBy ?? 'unknown') as InsightEngine,
            },
          };
        }
      }

      const analysisMonthStart = startOfMonth(targetMonth);
      const analysisMonthEnd = endOfMonth(targetMonth);

      const dataStartDate = subMonths(analysisMonthStart, HISTORY_MONTHS);
      const startDate = format(dataStartDate, 'yyyy-MM-dd');
      const endDate = format(analysisMonthEnd, 'yyyy-MM-dd');

      const { data: expenses, error } = await this.repo.listExpensesWithCategory(startDate, endDate);
      if (error) {
        return { status: 500 as const, body: { error: 'Failed to fetch expenses' } };
      }

      if (!expenses || (expenses as any[]).length === 0) {
        return {
          status: 200 as const,
          body: { insights: [], summary: null, analysisMonth: analysisMonthKey },
        };
      }

      const rows: ExpenseRow[] = (expenses as any[]).map((e) => ({
        id: e.id,
        date: e.date,
        amount: parseFloat(e.amount?.toString() ?? '0'),
        categoryId: e.category_id,
        categoryName: e.category?.name || 'Unknown',
        // `group_name` is the planning dimension (Need/Want/One-time/Unplanned).
        // Anything ungrouped is treated as a running cost rather than silently
        // dropping out of the baseline.
        groupName: e.category?.group_name || 'Unknown',
        budget: e.category?.budget != null ? parseFloat(e.category.budget.toString()) : null,
        description: e.description || '',
      }));

      const prepared = prepareExpenseData({
        rows,
        analysisMonthKey,
        // Never `new Date()` — the open-month run rate divides by elapsed days.
        todayAppDate: getTodayAppDate(),
      });

      if (prepared.month.count === 0) {
        return {
          status: 200 as const,
          body: {
            insights: [],
            summary: null,
            analysisMonth: analysisMonthKey,
            message: 'No expenses found for this month',
          },
        };
      }

      const { month } = prepared;
      const topCategory = Object.values(month.byCategory).sort((a, b) => b.total - a.total)[0];

      const summary = {
        totalSpent: month.total,
        transactionCount: month.count,
        avgTransaction: month.count > 0 ? month.total / month.count : 0,
        topCategory: topCategory?.name ?? 'None',
        topCategoryAmount: topCategory?.total ?? 0,
        // New: the recurring/one-time split every rule now reasons about, exposed so
        // the UI and the annual review can show the same numbers the rules used.
        recurringSpent: month.recurring,
        oneTimeSpent: month.oneTime,
        byGroup: month.byGroup,
        baselineMonths: prepared.cleanHistory.length,
        excludedMonths: prepared.excludedMonths.map((m) => m.key),
        insightCount: 0,
      } as {
        totalSpent: number;
        transactionCount: number;
        avgTransaction: number;
        topCategory: string;
        topCategoryAmount: number;
        recurringSpent: number;
        oneTimeSpent: number;
        byGroup: Record<string, number>;
        baselineMonths: number;
        excludedMonths: string[];
        insightCount: number;
        generatedBy?: InsightEngine;
      };

      let insights: Insight[] = [];
      // Which engine actually produced the insights. Previously invisible: the rule-based
      // output was cached and rendered as "AI-powered" with no way to tell the difference.
      let generatedBy: InsightEngine = 'rules';

      if (isAIEnabled()) {
        try {
          const analysisRows = rows.filter((r) => r.date.slice(0, 7) === analysisMonthKey);
          const historyRows = rows.filter((r) => r.date.slice(0, 7) < analysisMonthKey);
          const llmInsights = await generateLLMInsights({
            analysisMonth: format(targetMonth, 'MMMM yyyy'),
            expenses: analysisRows.map((r) => ({
              date: r.date,
              amount: r.amount,
              category: r.categoryName,
              description: r.description,
            })),
            historicalExpenses: historyRows.map((r) => ({
              date: r.date,
              amount: r.amount,
              category: r.categoryName,
              description: r.description,
            })),
            summary,
          });

          if (llmInsights && Array.isArray(llmInsights) && llmInsights.length > 0) {
            insights = (llmInsights as any[])
              .map((insight, idx) => ({ id: `llm-${idx}`, ...insight }) as Insight)
              .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
            generatedBy = 'ai';
          }
        } catch (e) {
          // Any failure falls through to the rule-based engine below. Log it rather than
          // swallowing silently, so a persistently broken key is diagnosable.
          this.warn('getInsights', `AI insights failed, using rule-based engine: ${String(e)}`);
        }
      }

      if (insights.length === 0) {
        // Ranked inside the rule engine: severity first, then rupee weight, so the
        // largest thing that happened cannot be pushed below the smallest.
        insights = buildExpenseInsights(prepared);
      }

      summary.insightCount = insights.length;

      // Engine goes in the summary JSONB — see the note on upsertCachedInsights for why
      // it must not go in the generated_by column.
      summary.generatedBy = generatedBy;

      // Cache the results (only for closed months, and only when persisting)
      if (isClosedMonth && persist) {
        const { error: cacheError } = await this.repo.upsertCachedInsights({
          analysisMonth: analysisMonthKey,
          insights,
          summary,
          generatedAt: new Date().toISOString(),
        });
        if (cacheError) {
          // non-fatal
          console.error('Failed to cache insights:', cacheError);
        }
      }

      return {
        status: 200 as const,
        body: {
          insights,
          summary,
          analysisMonth: analysisMonthKey,
          generatedBy,
        },
      };
    } catch (error) {
      this.handleError(error, 'generate insights');
    }
  }

  async clearCache(month?: string) {
    try {
      const { error } = await this.repo.clearCache(month);
      if (error) {
        return { status: 500 as const, body: { error: 'Failed to clear cache' } };
      }
      return {
        status: 200 as const,
        body: { success: true, message: month ? `Cleared cache for ${month}` : 'Cleared all cache' },
      };
    } catch (error) {
      this.handleError(error, 'clear insights cache');
    }
  }
}
