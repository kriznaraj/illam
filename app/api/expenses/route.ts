import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { cachedJson } from '@/lib/utils';
import { invalidateInsightsCache } from '@/lib/cache-invalidation';
import { ExpenseService } from '@/lib/services/ExpenseService';
import { toExpenseWithFlattenedTags, toExpensesWithFlattenedTags } from '@/lib/expenses/transformers';
import { endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import type { Expense } from '@/types';
import { getTodayAppDate, parseAppDate } from '@/lib/utils/dateUtils';

export const dynamic = 'force-dynamic';

const MIN_BASELINE_DAILY_AVG = 1200;
const DEFAULT_AVG_DAILY_BASELINE = 1500;
const DEFAULT_PREVENTABLE_THRESHOLD = 1000;
const CORE_RECURRING_NEED_CATEGORIES = new Set([
  'groceries & staples',
  'mobile & broadband',
  'electricity',
  'cooking gas',
  'home maintenance',
  'fuel',
  'education',
  'healthcare',
]);
const UNPLANNED_TAG_NAME = 'unplanned';

type ActionableSummary = {
  range: { startDate: string | null; endDate: string | null };
  totals: {
    totalSpend: number;
    coreBurn: number;
    discretionaryBurn: number;
    unplannedSpend: number;
    oneTimeSpend: number;
    miscSpend: number;
  };
  ratios: {
    surpriseRatio: number;
    oneTimeLoad: number;
    miscBucketRatio: number;
    discretionaryRatio: number;
  };
  targets: {
    unplanned: { target: '<10%'; actual: number; met: boolean };
    wants: { target: '<=25%'; actual: number; met: boolean };
    miscellaneous: { target: '<5%'; actual: number; met: boolean };
  };
  topPreventableSpends: Array<{
    categoryId: string;
    categoryName: string;
    groupName: string;
    amount: number;
    count: number;
    shareOfTotal: number;
  }>;
  monthly: Array<{
    month: string;
    totalSpend: number;
    coreBurn: number;
    discretionaryBurn: number;
    surpriseRatio: number;
    oneTimeLoad: number;
    miscBucketRatio: number;
  }>;
};

function toRatio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function toRoundedAmount(value: number) {
  return Number(value.toFixed(2));
}

function buildActionableSummary(
  expenses: Expense[],
  startDate?: string | null,
  endDate?: string | null,
  preventableThreshold: number = DEFAULT_PREVENTABLE_THRESHOLD,
): ActionableSummary {
  let totalSpend = 0;
  let coreBurn = 0;
  let discretionaryBurn = 0;
  let unplannedSpend = 0;
  let oneTimeSpend = 0;
  let miscSpend = 0;
  const monthly = new Map<string, { total: number; core: number; discretionary: number; unplanned: number; oneTime: number; misc: number }>();
  const preventable = new Map<string, { categoryId: string; categoryName: string; groupName: string; amount: number; count: number }>();

  for (const expense of expenses) {
    const amount = Number(expense.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const categoryName = expense.category?.name ?? 'Uncategorized';
    const normalizedCategoryName = categoryName.trim().toLowerCase();
    const groupName = (expense.category?.group_name ?? '').trim();
    const normalizedGroup = groupName.toLowerCase();
    const isMiscCategory = normalizedCategoryName === 'miscellaneous' || normalizedCategoryName === 'other';
    const hasUnplannedTag = (expense.tags ?? []).some(
      (tag) => String(tag?.name ?? '').trim().toLowerCase() === UNPLANNED_TAG_NAME,
    );
    const isLegacyUnplanned = normalizedGroup === 'unplanned' && !isMiscCategory;
    const isUnplanned = hasUnplannedTag || isLegacyUnplanned;
    const month = String(expense.date ?? '').slice(0, 7);

    totalSpend += amount;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      if (!monthly.has(month)) {
        monthly.set(month, { total: 0, core: 0, discretionary: 0, unplanned: 0, oneTime: 0, misc: 0 });
      }
      monthly.get(month)!.total += amount;
    }

    if (normalizedGroup === 'need' && CORE_RECURRING_NEED_CATEGORIES.has(normalizedCategoryName)) {
      coreBurn += amount;
      if (month && monthly.has(month)) monthly.get(month)!.core += amount;
    }

    if (normalizedGroup === 'want') {
      discretionaryBurn += amount;
      if (month && monthly.has(month)) monthly.get(month)!.discretionary += amount;
    }

    if (isUnplanned) {
      unplannedSpend += amount;
      if (month && monthly.has(month)) monthly.get(month)!.unplanned += amount;
    }

    if (normalizedGroup === 'one-time') {
      oneTimeSpend += amount;
      if (month && monthly.has(month)) monthly.get(month)!.oneTime += amount;
    }

    if (isMiscCategory) {
      miscSpend += amount;
      if (month && monthly.has(month)) monthly.get(month)!.misc += amount;
    }

    if ((normalizedGroup === 'want' || isUnplanned) && amount >= preventableThreshold) {
      const key = `${expense.category_id}::${categoryName}`;
      if (!preventable.has(key)) {
        preventable.set(key, {
          categoryId: expense.category_id,
          categoryName,
          groupName: groupName || 'Unplanned',
          amount: 0,
          count: 0,
        });
      }
      const row = preventable.get(key)!;
      row.amount += amount;
      row.count += 1;
    }
  }

  const surpriseRatio = toRatio(unplannedSpend, totalSpend);
  const oneTimeLoad = toRatio(oneTimeSpend, totalSpend);
  const miscBucketRatio = toRatio(miscSpend, totalSpend);
  const discretionaryRatio = toRatio(discretionaryBurn, totalSpend);

  return {
    range: { startDate: startDate ?? null, endDate: endDate ?? null },
    totals: {
      totalSpend: toRoundedAmount(totalSpend),
      coreBurn: toRoundedAmount(coreBurn),
      discretionaryBurn: toRoundedAmount(discretionaryBurn),
      unplannedSpend: toRoundedAmount(unplannedSpend),
      oneTimeSpend: toRoundedAmount(oneTimeSpend),
      miscSpend: toRoundedAmount(miscSpend),
    },
    ratios: {
      surpriseRatio: Number(surpriseRatio.toFixed(4)),
      oneTimeLoad: Number(oneTimeLoad.toFixed(4)),
      miscBucketRatio: Number(miscBucketRatio.toFixed(4)),
      discretionaryRatio: Number(discretionaryRatio.toFixed(4)),
    },
    targets: {
      unplanned: { target: '<10%', actual: Number(surpriseRatio.toFixed(4)), met: surpriseRatio < 0.1 },
      wants: { target: '<=25%', actual: Number(discretionaryRatio.toFixed(4)), met: discretionaryRatio <= 0.25 },
      miscellaneous: { target: '<5%', actual: Number(miscBucketRatio.toFixed(4)), met: miscBucketRatio < 0.05 },
    },
    topPreventableSpends: Array.from(preventable.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((item) => ({
        ...item,
        amount: toRoundedAmount(item.amount),
        shareOfTotal: Number(toRatio(item.amount, totalSpend).toFixed(4)),
      })),
    monthly: Array.from(monthly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => ({
        month,
        totalSpend: toRoundedAmount(values.total),
        coreBurn: toRoundedAmount(values.core),
        discretionaryBurn: toRoundedAmount(values.discretionary),
        surpriseRatio: Number(toRatio(values.unplanned, values.total).toFixed(4)),
        oneTimeLoad: Number(toRatio(values.oneTime, values.total).toFixed(4)),
        miscBucketRatio: Number(toRatio(values.misc, values.total).toFixed(4)),
      })),
  };
}

function computeBaselineCandidate(monthlyTotals: Array<{ month: string; total: number }>) {
  const monthCandidates = monthlyTotals
    .map(({ month, total }) => {
      const monthDate = parseISO(`${month}-01`);
      const daysInMonth = endOfMonth(monthDate).getDate();
      const avg = daysInMonth > 0 ? total / daysInMonth : 0;
      return { month, total, avg };
    })
    .filter((entry) => entry.total > 0);

  const eligibleCandidates = monthCandidates.filter((entry) => entry.avg >= MIN_BASELINE_DAILY_AVG);
  return (eligibleCandidates.length > 0 ? eligibleCandidates : monthCandidates)
    .sort((a, b) => a.total - b.total)[0];
}

/**
 * GET /api/expenses
 * Fetch expenses with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const expenseService = new ExpenseService(supabase);

    const searchParams = request.nextUrl.searchParams;
    const summary = searchParams.get('summary');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const categoryId = searchParams.get('categoryId');
    const enteredBy = searchParams.get('enteredBy');
    const eventId = searchParams.get('eventId');
    const limit = searchParams.get('limit');
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;

    if (limit && (!Number.isFinite(parsedLimit ?? Number.NaN) || Number.isNaN(parsedLimit ?? Number.NaN) || (parsedLimit ?? 0) <= 0)) {
      return NextResponse.json(
        { error: 'Invalid limit. Provide a positive integer.' },
        { status: 400 }
      );
    }

    if (summary === 'baseline') {
      const anchorDateInput = searchParams.get('anchorDate');
      // Anchored to the APP_TIMEZONE day: the server is UTC, so a raw `new Date()`
      // rolls the baseline window a month early between 00:00 and 05:30 IST on the 1st.
      const anchorDate =
        anchorDateInput && /^\d{4}-\d{2}-\d{2}$/.test(anchorDateInput)
          ? parseISO(anchorDateInput)
          : parseAppDate(getTodayAppDate());

      const previousMonthDate = subMonths(startOfMonth(anchorDate), 1);
      const baselineStartDate = startOfMonth(subMonths(previousMonthDate, 11));
      const baselineStart = format(baselineStartDate, 'yyyy-MM-dd');
      const baselineEnd = format(previousMonthDate, 'yyyy-MM-dd');

      const months = Array.from({ length: 12 }, (_, idx) => {
        const monthDate = startOfMonth(subMonths(previousMonthDate, 11 - idx));
        return format(monthDate, 'yyyy-MM');
      });
      const totalsByMonth = new Map(months.map((month) => [month, 0]));

      const monthlyTotalsResult = await supabase
        .from('expense_monthly_totals')
        .select('month, total_amount')
        .gte('month', baselineStart)
        .lte('month', baselineEnd);

      if (monthlyTotalsResult.error) {
        throw new Error(`Failed to compute baseline summary: ${monthlyTotalsResult.error.message}`);
      }

      for (const row of monthlyTotalsResult.data ?? []) {
        const month = String(row.month).slice(0, 7);
        if (!totalsByMonth.has(month)) continue;
        const total = Number(row.total_amount ?? 0);
        totalsByMonth.set(month, Number.isFinite(total) ? total : 0);
      }

      const baselineCandidate = computeBaselineCandidate(
        Array.from(totalsByMonth.entries()).map(([month, total]) => ({ month, total })),
      );

      const baselineDaily = baselineCandidate?.avg ?? DEFAULT_AVG_DAILY_BASELINE;

      return cachedJson(
        {
          baselineDaily,
          baselineMonth: baselineCandidate?.month ?? null,
          source: 'expense_monthly_totals',
        },
        'expenses',
      );
    }

    if (summary === 'actionable') {
      const thresholdParam = searchParams.get('preventableThreshold');
      const parsedThreshold = thresholdParam ? Number.parseFloat(thresholdParam) : DEFAULT_PREVENTABLE_THRESHOLD;
      const preventableThreshold =
        Number.isFinite(parsedThreshold) && parsedThreshold >= 0 ? parsedThreshold : DEFAULT_PREVENTABLE_THRESHOLD;

      const expenses = await expenseService.getExpensesWithFilters({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        categoryId: categoryId || undefined,
        userId: enteredBy || undefined,
        eventId: eventId || undefined,
      });

      // Auto-added expenses are in: the money is gone whether or not anyone has looked (036).
      const actionableSummary = buildActionableSummary(expenses, startDate, endDate, preventableThreshold);
      return cachedJson(actionableSummary, 'expenses');
    }

    // Use service layer for fetching expenses
    const expenses = await expenseService.getExpensesWithFilters({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      categoryId: categoryId || undefined,
      userId: enteredBy || undefined,
      eventId: eventId || undefined,
      limit: parsedLimit,
    });

    // Flatten tags for easier consumption
    const expensesWithTags = toExpensesWithFlattenedTags(expenses);

    return cachedJson(expensesWithTags, 'expenses');
  } catch (error) {
    console.error('Error in GET /api/expenses:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch expenses';
    const status = error instanceof Error && /required|valid|must be/i.test(error.message) ? 400 : 500;
    return NextResponse.json({ error: errorMessage }, { status });
  }
}

/**
 * POST /api/expenses
 * Create a new expense
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const expenseService = new ExpenseService(supabase);

    const body = await request.json();
    const { date, amount, category_id, description, user_id, event_id, receipt_url, tag_ids } = body;

    // Create expense using service (includes validation and tag handling)
    const expense = await expenseService.createExpense({
      date,
      amount,
      category_id,
      description: description || '',
      user_id,
      event_id: event_id || null,
      receipt_url,
      tag_ids: tag_ids || [],
    });

    // Flatten tags
    const expenseWithTags = toExpenseWithFlattenedTags(expense);

    // Invalidate insights cache
    if (date) {
      await invalidateInsightsCache(supabase, date);
    }

    return NextResponse.json(expenseWithTags, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/expenses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create expense' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/expenses
 * Update an existing expense
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const expenseService = new ExpenseService(supabase);

    const body = await request.json();
    const { id, date, amount, category_id, description, user_id, event_id, receipt_url, tag_ids } = body;

    if (!id) {
      return NextResponse.json({ error: 'Expense ID is required' }, { status: 400 });
    }

    // Update expense using service (includes validation and tag handling)
    type ExpenseUpdateData = {
      date?: string;
      amount?: number;
      category_id?: string;
      description?: string;
      receipt_url?: string | null;
      event_id?: string | null;
      user_id?: string;
      tag_ids?: string[];
      needs_review: false;
    };

    const updateData: ExpenseUpdateData = {
      date,
      amount,
      category_id,
      description,
      receipt_url,
      event_id: event_id || null,
      // Every PUT is a person editing the row, and that is the confirmation: once someone
      // updates an expense it is considered confirmed.
      // There is no separate confirm step for an auto-added expense any more, and nothing
      // re-flags one for review.
      needs_review: false,
    };

    if (user_id) {
      updateData.user_id = user_id;
    }

    // Include tag_ids if provided
    if (tag_ids !== undefined) {
      updateData.tag_ids = tag_ids;
    }

    const updatedExpense = await expenseService.updateExpense(id, updateData);

    // Flatten tags
    const expenseWithTags = toExpenseWithFlattenedTags(updatedExpense);

    // Invalidate insights cache
    if (date) {
      await invalidateInsightsCache(supabase, date);
    }

    return NextResponse.json(expenseWithTags);
  } catch (error) {
    console.error('Error in PUT /api/expenses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update expense' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/expenses
 * Delete an expense
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const expenseService = new ExpenseService(supabase);

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Expense ID is required' }, { status: 400 });
    }

    // Fetch expense before deleting for cache invalidation
    const expense = await expenseService.getExpenseById(id);

    // Delete using service
    await expenseService.deleteExpense(id);

    // Invalidate insights cache
    if (expense?.date) {
      await invalidateInsightsCache(supabase, expense.date);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/expenses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete expense' },
      { status: 500 }
    );
  }
}
