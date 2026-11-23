/**
 * Spending-insight generation, through the provider port in `lib/ai`, which enforces
 * the schema at the API and returns a typed result or a typed error.
 *
 *  - Returns null on any failure, so `InsightsService` falls back to its rule-based engine.
 *  - The prompt sends precomputed aggregates plus a bounded sample of descriptions, so
 *    token cost scales with the month rather than with transaction count.
 *  - No `temperature`: the current models reject non-default sampling values.
 */
import { getProvider } from '@/lib/ai';
import { InsightsSchema } from '@/lib/ai/schemas';
import type { InsightsExtraction } from '@/lib/ai/schemas';

interface ExpenseData {
  date: string;
  amount: number;
  category: string;
  description: string;
  tags?: string[];
}

interface InsightGenerationParams {
  analysisMonth: string;
  expenses: ExpenseData[];
  historicalExpenses: ExpenseData[];
  summary: {
    totalSpent: number;
    transactionCount: number;
    avgTransaction: number;
    topCategory: string;
    topCategoryAmount: number;
  };
}

export type GeneratedInsight = InsightsExtraction['insights'][number];

/** How many individual transactions to include as evidence. */
const SAMPLE_SIZE = 40;

export async function generateLLMInsights(
  params: InsightGenerationParams,
): Promise<GeneratedInsight[] | null> {
  const { analysisMonth, expenses, historicalExpenses, summary } = params;

  const provider = getProvider();
  if (!provider.isConfigured()) return null;

  // ---- aggregates (same computations as the previous implementation) ----
  const categoryTotals: Record<string, number> = {};
  for (const e of expenses) {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  }
  const topCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([cat, amt]) => `${cat}: ₹${amt.toFixed(0)}`);

  const historicalMonths = new Set(historicalExpenses.map((e) => e.date.slice(0, 7)));
  const historicalTotal = historicalExpenses.reduce((s, e) => s + e.amount, 0);
  const historicalMonthlyAvg =
    historicalMonths.size > 0 ? historicalTotal / historicalMonths.size : 0;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayTotals = [0, 0, 0, 0, 0, 0, 0];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const e of expenses) {
    const d = new Date(e.date);
    // Skip a malformed date rather than take the whole generation down.
    if (Number.isNaN(d.getTime())) continue;
    dayTotals[d.getDay()] += e.amount;
    dayCounts[d.getDay()] += 1;
  }
  const dayAverages = dayNames
    .map((day, i) => ({
      day,
      avg: dayCounts[i] ? dayTotals[i] / dayCounts[i] : 0,
      count: dayCounts[i],
    }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.avg - a.avg);

  const largest = [...expenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, SAMPLE_SIZE)
    .map((e) => `${e.date}: ₹${e.amount.toFixed(0)} — ${e.category} — ${e.description}`);

  const changeVsHistory =
    historicalMonthlyAvg > 0
      ? (((summary.totalSpent - historicalMonthlyAvg) / historicalMonthlyAvg) * 100).toFixed(1) + '%'
      : 'N/A';

  const result = await provider.complete({
    task: 'insights',
    schema: InsightsSchema,
    schemaName: 'spending_insights',
    system:
      'You are a financial analyst for an Indian household. You produce specific, actionable ' +
      'insights from spending data. Always cite the actual numbers you were given, and never ' +
      'invent figures that are not in the data. Amounts are in rupees.',
    prompt: `Generate 6-10 insights for ${analysisMonth}, ordered by how much they matter.

SUMMARY
- Total spent: ₹${summary.totalSpent.toFixed(0)}
- Transactions: ${summary.transactionCount}
- Average per transaction: ₹${summary.avgTransaction.toFixed(0)}
- Historical monthly average (prior months): ₹${historicalMonthlyAvg.toFixed(0)}
- Change vs that average: ${changeVsHistory}
- Top category: ${summary.topCategory} (₹${summary.topCategoryAmount.toFixed(0)})

TOP CATEGORIES
${topCategories.join('\n') || '(none)'}

SPEND BY DAY OF WEEK
${dayAverages.map((d) => `${d.day}: ₹${d.avg.toFixed(0)} avg over ${d.count} transactions`).join('\n') || '(none)'}

LARGEST TRANSACTIONS (top ${SAMPLE_SIZE})
${largest.join('\n') || '(none)'}

Cover a mix of: patterns (weekday vs weekend, recurring spend), anomalies (unusual spikes),
trends (vs the historical average), achievements (where spending was controlled), and
predictions (what next month looks like if this continues).

Be concrete: prefer "Dining Out rose 42% to ₹8,400" over "dining spend increased". Where you
suggest an action, make it something that can actually be done, and quantify the saving when
the data supports it. Use severity 'danger' only for genuinely concerning findings.`,
  });

  if (!result.ok) {
    console.warn(
      `[insights] AI generation unavailable (${result.error.kind}): ${result.error.message}`,
    );
    return null;
  }

  return result.data.insights.length > 0 ? result.data.insights : null;
}
