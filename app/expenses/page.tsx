'use client';

import { useMemo, useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from 'react';
import { ExpenseWithCategory } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { monthKeys } from '@/lib/utils/dateUtils';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { ExpenseCard } from '@/components/expenses/ExpenseCard';
import { DailyExpenseChart } from '@/components/expenses/DailyExpenseChart';
import { CumulativeExpenseChart } from '@/components/expenses/CumulativeExpenseChart';
import { MonthViewSkeleton } from '@/components/ExpenseSkeleton';
import Modal from '@/components/Modal';
import { SegmentedControl } from '@/components/SegmentedControl';
import { MonthNavigator } from '@/components/MonthNavigator';
import Link from 'next/link';
import { useExpenses } from '@/lib/hooks/useExpenses';
import { usePaymentSources } from '@/lib/hooks/usePaymentSources';
import { awaitsDecision } from '@/lib/expenses/autoTag';
import ExpenseDetailModal from '@/components/ExpenseDetailModal';

const DEFAULT_AVG_DAILY_BASELINE = 1500;
const DEFAULT_PREVENTABLE_THRESHOLD = 1000;
const UNPLANNED_TAG_NAME = 'unplanned';
const TOP_BREAKDOWN_LIMIT = 5;

type ActionableSummary = {
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
    unplanned: { target: string; actual: number; met: boolean };
    wants: { target: string; actual: number; met: boolean };
    miscellaneous: { target: string; actual: number; met: boolean };
  };
  topPreventableSpends: Array<{
    categoryId: string;
    categoryName: string;
    groupName: string;
    amount: number;
    count: number;
    shareOfTotal: number;
  }>;
};

type FilterModalState =
  | { type: 'category'; name: string }
  | { type: 'label'; name: string }
  | { type: 'target'; name: string; target: 'need' | 'want' | 'misc_unplanned' | 'one_time' }
  | { type: 'preventable'; name: string; categoryId: string };

const getAvgDailyTone = (avgDaily: number, baselineDaily: number) => {
  const safeBaseline = baselineDaily > 0 ? baselineDaily : DEFAULT_AVG_DAILY_BASELINE;
  const ratio = avgDaily / safeBaseline;
  if (ratio <= 0.6) {
    return {
      label: 'Greener',
      cardClass: 'from-emerald-50 to-emerald-100 border-emerald-200',
      labelClass: 'text-emerald-700',
      valueClass: 'text-emerald-900',
      tip: 'Excellent pace.',
    };
  }
  if (ratio <= 0.9) {
    return {
      label: 'Green',
      cardClass: 'from-green-50 to-green-100 border-green-200',
      labelClass: 'text-green-700',
      valueClass: 'text-green-900',
      tip: 'Healthy spending pace.',
    };
  }
  if (ratio <= 1.2) {
    return {
      label: 'Warm',
      cardClass: 'from-amber-50 to-amber-100 border-amber-200',
      labelClass: 'text-amber-700',
      valueClass: 'text-amber-900',
      tip: 'Watch pace closely.',
    };
  }
  if (ratio <= 1.5) {
    return {
      label: 'Warmer',
      cardClass: 'from-orange-50 to-orange-100 border-orange-200',
      labelClass: 'text-orange-700',
      valueClass: 'text-orange-900',
      tip: 'Consider slowing down.',
    };
  }
  if (ratio <= 2) {
    return {
      label: 'High',
      cardClass: 'from-red-50 to-red-100 border-red-200',
      labelClass: 'text-red-700',
      valueClass: 'text-red-900',
      tip: 'High burn rate. Slow down.',
    };
  }
  return {
    label: 'Critical',
    cardClass: 'from-rose-100 to-rose-200 border-rose-300',
    labelClass: 'text-rose-800',
    valueClass: 'text-rose-900',
    tip: 'Critical pace. Cut discretionary spend.',
  };
};

type BarRowProps = {
  label: ReactNode;
  rightValue: ReactNode;
  percent: number;
  subText: ReactNode;
  onClick: () => void;
  barClassName?: string;
  barStyle?: CSSProperties;
};

function BarRow({ label, rightValue, percent, subText, onClick, barClassName = 'bg-blue-600', barStyle }: BarRowProps) {
  const clampedPercent = Math.max(0, Math.min(percent, 100));
  return (
    <button
      type="button"
      className="w-full text-left group"
      onClick={onClick}
    >
      <div className="flex justify-between text-sm mb-1 gap-3">
        <span className="font-medium text-gray-700 group-hover:text-blue-600 transition-colors truncate">
          {label}
        </span>
        <span className="text-gray-900 font-semibold whitespace-nowrap">{rightValue}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all group-hover:opacity-90 ${barClassName}`} style={{ width: `${clampedPercent}%`, ...barStyle }} />
      </div>
      <p className="text-xs text-gray-500 mt-1">{subText}</p>
    </button>
  );
}

function getThresholdTone(
  percent: number,
  thresholds: { goodMax: number; warnMax: number },
): { barClassName: string; textClassName: string } {
  if (percent <= thresholds.goodMax) {
    return { barClassName: 'bg-emerald-600', textClassName: 'text-emerald-700' };
  }
  if (percent <= thresholds.warnMax) {
    return { barClassName: 'bg-amber-500', textClassName: 'text-amber-700' };
  }
  return { barClassName: 'bg-red-600', textClassName: 'text-red-700' };
}

export default function ExpensesDashboardPage() {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  // Initialise directly — no mounted anti-pattern needed for client components
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeys.current());
  const [selectedWeek, setSelectedWeek] = useState<Date>(() => new Date());
  const [editingExpense, setEditingExpense] = useState<ExpenseWithCategory | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<'categories' | 'labels'>('categories');
  const [topExpensesTab, setTopExpensesTab] = useState<'expenses' | 'preventable'>('expenses');
  const [filterModal, setFilterModal] = useState<FilterModalState | null>(null);
  const [breakdownListModal, setBreakdownListModal] = useState<'categories' | 'labels' | null>(null);
  const [autoSwitchedNotice, setAutoSwitchedNotice] = useState<string | null>(null);
  const [avgBaseline, setAvgBaseline] = useState<number>(DEFAULT_AVG_DAILY_BASELINE);
  const [avgBaselineMonthLabel, setAvgBaselineMonthLabel] = useState<string>('');
  const [actionableSummary, setActionableSummary] = useState<ActionableSummary | null>(null);
  // Bumped on every expense mutation to re-run the baseline/actionable summary fetch.
  // The headline total comes from actionableSummary, not from the expense list, so
  // refetching the list alone leaves the total stale until a full page reload.
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);
  const isInitialLoadRef = useRef(true);

  // Calculate date range based on view mode
  const dateRange = useMemo(() => {
    let startDate: Date;
    let endDate: Date;

    if (viewMode === 'week') {
      startDate = startOfWeek(selectedWeek, { weekStartsOn: 1 });
      endDate = endOfWeek(selectedWeek, { weekStartsOn: 1 });
    } else {
      const monthDate = parseISO(selectedMonth + '-01');
      startDate = startOfMonth(monthDate);
      endDate = endOfMonth(monthDate);
    }

    return {
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
    };
  }, [viewMode, selectedMonth, selectedWeek]);

  // Use the useExpenses hook with date range
  const { expenses: fetchedExpenses, loading, refetch } = useExpenses(dateRange.startDate, dateRange.endDate);
  // Names and colours the payment-source dot from Selvam's cards; empty until it loads.
  const { cards: paymentCards } = usePaymentSources();

  // Sort expenses by date
  const expenses = useMemo(() => {
    return Array.isArray(fetchedExpenses)
      ? [...fetchedExpenses].sort((a, b) => b.date.localeCompare(a.date))
      : [];
  }, [fetchedExpenses]);

  // Handle auto-switching to previous month if current month is empty (first load only)
  useEffect(() => {
    const currentMonth = monthKeys.current();
    if (
      isInitialLoadRef.current &&
      viewMode === 'month' &&
      selectedMonth === currentMonth &&
      !loading &&
      expenses.length === 0
    ) {
      isInitialLoadRef.current = false;
      const prev = monthKeys.shift(currentMonth, -1);
      setSelectedMonth(prev);
      setAutoSwitchedNotice(format(parseISO(prev + '-01'), 'MMMM yyyy'));
    } else if (expenses.length > 0) {
      isInitialLoadRef.current = false;
    }
  }, [expenses.length, loading, viewMode, selectedMonth]);

  // Refresh everything derived from expenses: the list *and* the server-side
  // summaries. Used by add (expenseAdded event) and by edit/delete (modal onSuccess).
  const refreshAfterMutation = useCallback(() => {
    refetch();
    setSummaryRefreshKey((key) => key + 1);
  }, [refetch]);

  // Listen for expense added events
  useEffect(() => {
    window.addEventListener('expenseAdded', refreshAfterMutation);
    return () => window.removeEventListener('expenseAdded', refreshAfterMutation);
  }, [refreshAfterMutation]);

  // Every expense counts, auto-added ones included (migration 036). Kept as its own name
  // because the chart and totals used to run on a filtered subset, and a reader needs to see
  // at a glance that they no longer do.
  const countedExpenses = expenses;

  const { periodLabel, dailyData, cumulativeData } = useMemo(() => {
    const today = new Date();
    let periodStart: Date;
    let periodEnd: Date;
    let periodLabel: string;

    if (viewMode === 'week' && selectedWeek) {
      periodStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
      const isCurrentWeek = today >= periodStart && today <= weekEnd;
      periodEnd = isCurrentWeek ? today : weekEnd;
      periodLabel = `${format(periodStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
    } else {
      const monthDate = parseISO(selectedMonth + '-01');
      const isCurrentMonth = monthKeys.current() === selectedMonth;
      periodStart = startOfMonth(monthDate);
      periodEnd = isCurrentMonth ? today : endOfMonth(monthDate);
      periodLabel = format(monthDate, 'MMMM yyyy');
    }

    const daysInPeriod = eachDayOfInterval({
      start: periodStart,
      end: periodEnd
    });

    // O(n) grouping: build date→amount map once, then iterate days
    const amountByDate = countedExpenses.reduce((map, e) => {
      map.set(e.date, (map.get(e.date) ?? 0) + parseFloat(e.amount.toString()));
      return map;
    }, new Map<string, number>());

    const dailyData = daysInPeriod.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      return {
        date: dayStr,
        day: viewMode === 'week' ? format(day, 'EEE') : format(day, 'd'),
        amount: amountByDate.get(dayStr) ?? 0,
      };
    });

    // O(n) running sum instead of O(n²) slice+reduce
    const cumulativeData = dailyData.reduce<(typeof dailyData[0] & { cumulative: number })[]>(
      (acc, day) => {
        const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
        acc.push({ ...day, cumulative: prev + day.amount });
        return acc;
      },
      []
    );

    return { periodLabel, dailyData, cumulativeData };
  }, [countedExpenses, viewMode, selectedMonth, selectedWeek]);

  const totalAmount = countedExpenses.reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0);
  const avgDaily = dailyData.length > 0 ? totalAmount / dailyData.length : 0;
  const avgDailyTone = getAvgDailyTone(avgDaily, avgBaseline);
  const topExpenses = [...countedExpenses]
    .sort((a, b) => parseFloat(b.amount.toString()) - parseFloat(a.amount.toString()))
    .slice(0, 5);

  // Group expenses by category (store id + icon alongside amount)
  const categoryTotals = expenses.reduce((acc, expense) => {
    const catName = expense.category?.name || 'Uncategorized';
    if (!acc[catName]) {
      acc[catName] = { amount: 0, id: expense.category?.id || '', icon: expense.category?.icon || '' };
    }
    acc[catName].amount += parseFloat(expense.amount.toString());
    return acc;
  }, {} as Record<string, { amount: number; id: string; icon: string }>);

  const allCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b.amount - a.amount);

  const topCategories = allCategories.slice(0, TOP_BREAKDOWN_LIMIT);

  // Group expenses by tag
  const tagTotals = expenses.reduce((acc, expense) => {
    (expense.tags || []).forEach((tag) => {
      if (!acc[tag.name]) {
        acc[tag.name] = { amount: 0, id: tag.id, color: tag.color };
      }
      acc[tag.name].amount += parseFloat(expense.amount.toString());
    });
    return acc;
  }, {} as Record<string, { amount: number; id: string; color: string }>);

  const allTags = Object.entries(tagTotals)
    .sort(([, a], [, b]) => b.amount - a.amount);

  const topTags = allTags.slice(0, TOP_BREAKDOWN_LIMIT);

  const normalizeValue = (value?: string | null) => String(value ?? '').trim().toLowerCase();
  const isExpenseMarkedUnplanned = useCallback((expense: ExpenseWithCategory) => {
    const hasUnplannedTag = (expense.tags ?? []).some(
      (tag) => normalizeValue(tag?.name) === UNPLANNED_TAG_NAME,
    );
    if (hasUnplannedTag) return true;
    const categoryName = normalizeValue(expense.category?.name);
    const groupName = normalizeValue(expense.category?.group_name);
    return groupName === 'unplanned' && categoryName !== 'miscellaneous' && categoryName !== 'other';
  }, []);
  const classifyTrackerBucket = useCallback((expense: ExpenseWithCategory): 'need' | 'want' | 'misc_unplanned' | 'one_time' => {
    const groupName = normalizeValue(expense.category?.group_name);
    const categoryName = normalizeValue(expense.category?.name);
    const isUnplanned = isExpenseMarkedUnplanned(expense);
    const isMiscCategory = categoryName === 'miscellaneous' || categoryName === 'other';

    // Precedence ensures a strict partition (no overlap).
    if (groupName === 'one-time') return 'one_time';
    if (isUnplanned || isMiscCategory || groupName === 'unplanned') return 'misc_unplanned';
    if (groupName === 'want') return 'want';
    if (groupName === 'need') return 'need';
    return 'misc_unplanned';
  }, [isExpenseMarkedUnplanned]);
  const topPreventableExpenses = useMemo(
    () =>
      [...expenses]
        .filter((expense) => {
          const amount = Number(expense.amount ?? 0);
          const isWant = normalizeValue(expense.category?.group_name) === 'want';
          return Number.isFinite(amount) && amount >= DEFAULT_PREVENTABLE_THRESHOLD && (isWant || isExpenseMarkedUnplanned(expense as ExpenseWithCategory));
        })
        .sort((a, b) => parseFloat(b.amount.toString()) - parseFloat(a.amount.toString()))
        .slice(0, 5),
    [expenses, isExpenseMarkedUnplanned],
  );

  // Auto-added rows automation could not place (see `awaitsDecision`); the rest need nothing.
  const reviewCount = useMemo(() => expenses.filter(awaitsDecision).length, [expenses]);
  const [reviewOnly, setReviewOnly] = useState(false);

  const filteredForModal = useMemo(() => {
    if (!filterModal) return [];
    if (filterModal.type === 'category') {
      return expenses.filter((e) => (e.category?.name ?? '') === filterModal.name);
    }
    if (filterModal.type === 'label') {
      return expenses.filter((e) => (e.tags ?? []).some((t) => t?.name === filterModal.name));
    }
    if (filterModal.type === 'target') {
      if (filterModal.target === 'need') {
        return expenses.filter((e) => classifyTrackerBucket(e as ExpenseWithCategory) === 'need');
      }
      if (filterModal.target === 'want') {
        return expenses.filter((e) => classifyTrackerBucket(e as ExpenseWithCategory) === 'want');
      }
      if (filterModal.target === 'one_time') {
        return expenses.filter((e) => classifyTrackerBucket(e as ExpenseWithCategory) === 'one_time');
      }
      return expenses.filter((e) => classifyTrackerBucket(e as ExpenseWithCategory) === 'misc_unplanned');
    }
    return expenses.filter((e) => {
      const categoryGroup = normalizeValue(e.category?.group_name);
      const amount = Number(e.amount ?? 0);
      return (
        e.category_id === filterModal.categoryId &&
        (categoryGroup === 'want' || isExpenseMarkedUnplanned(e as ExpenseWithCategory)) &&
        Number.isFinite(amount) &&
        amount >= DEFAULT_PREVENTABLE_THRESHOLD
      );
    });
  }, [expenses, filterModal, classifyTrackerBucket, isExpenseMarkedUnplanned]);

  const filteredTotal = useMemo(
    () => filteredForModal.reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0),
    [filteredForModal],
  );
  const totalBreakdown = useMemo(() => {
    const total = actionableSummary?.totals.totalSpend ?? totalAmount;
    const core = actionableSummary?.totals.coreBurn ?? 0;
    const want = actionableSummary?.totals.discretionaryBurn ?? 0;
    // Ensure this equation always reconciles with total:
    // core + want + unplanned = total
    const unplanned = Math.max(0, total - core - want);
    const pct = (value: number) => (total > 0 ? (value / total) * 100 : 0);
    return { total, core, want, unplanned, corePct: pct(core), wantPct: pct(want), unplannedPct: pct(unplanned) };
  }, [actionableSummary, totalAmount]);
  const trackerBreakdown = useMemo(() => {
    const totals = {
      need: 0,
      want: 0,
      miscUnplanned: 0,
      oneTime: 0,
      total: 0,
    };

    for (const expense of countedExpenses) {
      const amount = Number(expense.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      totals.total += amount;
      const bucket = classifyTrackerBucket(expense as ExpenseWithCategory);
      if (bucket === 'need') totals.need += amount;
      if (bucket === 'want') totals.want += amount;
      if (bucket === 'misc_unplanned') totals.miscUnplanned += amount;
      if (bucket === 'one_time') totals.oneTime += amount;
    }

    const ratio = (value: number) => (totals.total > 0 ? (value / totals.total) * 100 : 0);
    return {
      ...totals,
      needPct: ratio(totals.need),
      wantPct: ratio(totals.want),
      miscUnplannedPct: ratio(totals.miscUnplanned),
      oneTimePct: ratio(totals.oneTime),
    };
  }, [expenses, classifyTrackerBucket]);
  const wantTone = useMemo(
    () => getThresholdTone(trackerBreakdown.wantPct, { goodMax: 20, warnMax: 25 }),
    [trackerBreakdown.wantPct],
  );
  const miscUnplannedTone = useMemo(
    () => getThresholdTone(trackerBreakdown.miscUnplannedPct, { goodMax: 5, warnMax: 10 }),
    [trackerBreakdown.miscUnplannedPct],
  );
  const oneTimeTone = useMemo(
    () => getThresholdTone(trackerBreakdown.oneTimePct, { goodMax: 10, warnMax: 20 }),
    [trackerBreakdown.oneTimePct],
  );

  useEffect(() => {
    let cancelled = false;

    const loadBaselineFromSummary = async () => {
      try {
        const anchorDate = dateRange.startDate;
        const [baselineResponse, actionableResponse] = await Promise.all([
          fetch(`/api/expenses?summary=baseline&anchorDate=${anchorDate}`),
          fetch(
            `/api/expenses?summary=actionable&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&preventableThreshold=${DEFAULT_PREVENTABLE_THRESHOLD}`,
          ),
        ]);

        if (!baselineResponse.ok) {
          if (!cancelled) {
            setAvgBaseline(DEFAULT_AVG_DAILY_BASELINE);
            setAvgBaselineMonthLabel('');
          }
        } else {
          const payload = await baselineResponse.json();
          const summary = payload as { baselineDaily?: number; baselineMonth?: string | null };
          const averageDaily =
            typeof summary.baselineDaily === 'number' && Number.isFinite(summary.baselineDaily)
              ? summary.baselineDaily
              : DEFAULT_AVG_DAILY_BASELINE;
          const baselineMonthLabel =
            typeof summary.baselineMonth === 'string' && /^\d{4}-\d{2}$/.test(summary.baselineMonth)
              ? format(parseISO(`${summary.baselineMonth}-01`), 'MMM yyyy')
              : '';

          if (!cancelled) {
            setAvgBaseline(averageDaily > 0 ? averageDaily : DEFAULT_AVG_DAILY_BASELINE);
            setAvgBaselineMonthLabel(baselineMonthLabel);
          }
        }

        if (!actionableResponse.ok) {
          if (!cancelled) {
            setActionableSummary(null);
          }
        } else {
          const actionablePayload = (await actionableResponse.json()) as ActionableSummary;
          if (!cancelled) {
            setActionableSummary(actionablePayload);
          }
        }
      } catch {
        if (!cancelled) {
          setAvgBaseline(DEFAULT_AVG_DAILY_BASELINE);
          setAvgBaselineMonthLabel('');
          setActionableSummary(null);
        }
      }
    };

    void loadBaselineFromSummary();
    return () => {
      cancelled = true;
    };
  }, [dateRange.startDate, dateRange.endDate, summaryRefreshKey]);

  return (
    <PageContainer>
      <PageHeader
        title="Selavu"
        description={periodLabel}
      />

      {/* Auto-switched notice */}
      {autoSwitchedNotice && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 text-sm text-blue-700">
          <span>No expenses yet this month — showing <strong>{autoSwitchedNotice}</strong>.</span>
          <button
            onClick={() => {
              setAutoSwitchedNotice(null);
              setSelectedMonth(monthKeys.current());
            }}
            className="btn btn-link text-sm whitespace-nowrap"
          >
            Show {format(parseISO(monthKeys.current() + '-01'), 'MMMM')} →
          </button>
        </div>
      )}

      {/* View Mode Toggle + Browse */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3">
          {/* View Mode Toggle */}
          <SegmentedControl
            value={viewMode}
            onChange={setViewMode}
            ariaLabel="Expense view mode"
            options={[
              { value: 'month', label: 'M', title: 'Month View', ariaLabel: 'Switch to month view', className: 'min-w-[40px]' },
              { value: 'week', label: 'W', title: 'Week View', ariaLabel: 'Switch to week view', className: 'min-w-[40px]' },
            ]}
          />

        </div>
      </div>

      {/* Period Navigation */}
      <div className="mb-6">
        {viewMode === 'month' ? (
          <MonthNavigator
            value={selectedMonth}
            onChange={setSelectedMonth}
            ariaLabel="Expense month"
          />
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                selectedWeek && setSelectedWeek(subWeeks(selectedWeek, 1));
              }}
              className="btn btn-secondary w-12 min-w-[40px] min-h-[40px]"
            >
              ←
            </button>

            <div className="flex-1 text-center relative">
              <input
                type="week"
                value={selectedWeek ? format(selectedWeek, "yyyy-'W'II") : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    const [year, week] = e.target.value.split('-W');
                    const date = new Date(parseInt(year), 0, 1 + (parseInt(week) - 1) * 7);
                    const dayOfWeek = date.getDay();
                    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                    date.setDate(date.getDate() + diff);
                    setSelectedWeek(date);
                  }
                }}
                className="input text-center opacity-0 absolute inset-0 cursor-pointer"
              />
              <div className="input text-center pointer-events-none">
                {selectedWeek && `W${format(selectedWeek, 'II')} ${format(selectedWeek, 'yyyy')}`}
              </div>
            </div>

            <button
              onClick={() => {
                selectedWeek && setSelectedWeek(addWeeks(selectedWeek, 1));
              }}
              className="btn btn-secondary w-12 min-w-[40px] min-h-[40px]"
            >
              →
            </button>

            <button
              onClick={() => {
                setSelectedWeek(new Date());
              }}
              className="btn btn-primary w-12 min-w-[40px] min-h-[40px]"
            >
              •
            </button>
          </div>
        )}
      </div>

      {/* Spend Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="card p-4 border border-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Spent</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{formatCurrency(totalBreakdown.total)}</p>
        </div>

        <div className={`card p-4 border bg-gradient-to-br ${avgDailyTone.cardClass}`}>
          <div className="flex items-start justify-between gap-2">
            <p className={`text-xs uppercase tracking-wide ${avgDailyTone.labelClass}`}>Avg / Day</p>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/60 ${avgDailyTone.labelClass}`}>
              {avgDailyTone.label}
            </span>
          </div>
          <p className={`text-3xl font-bold mt-2 ${avgDailyTone.valueClass}`}>{formatCurrency(avgDaily)}</p>
          <p className={`text-xs mt-2 ${avgDailyTone.labelClass}`}>
            Baseline {formatCurrency(avgBaseline)}
            {avgBaselineMonthLabel ? ` (${avgBaselineMonthLabel})` : ''} · {avgDailyTone.tip}
          </p>
        </div>
      </div>

      {actionableSummary && (
        <div className="card p-4 border border-gray-200 mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Tracker</p>
          <div className="space-y-3 mt-3">
            <BarRow
              label="Need"
              rightValue={`${trackerBreakdown.needPct.toFixed(1)}%`}
              percent={trackerBreakdown.needPct}
              subText={formatCurrency(trackerBreakdown.need)}
              onClick={() => setFilterModal({ type: 'target', target: 'need', name: 'Need Expenses' })}
              barClassName="bg-blue-600"
            />
            <BarRow
              label="Want"
              rightValue={<span className={wantTone.textClassName}>{trackerBreakdown.wantPct.toFixed(1)}%</span>}
              percent={trackerBreakdown.wantPct}
              subText={formatCurrency(trackerBreakdown.want)}
              onClick={() => setFilterModal({ type: 'target', target: 'want', name: 'Want Expenses' })}
              barClassName={wantTone.barClassName}
            />
            <BarRow
              label="Misc / Unplanned"
              rightValue={<span className={miscUnplannedTone.textClassName}>{trackerBreakdown.miscUnplannedPct.toFixed(1)}%</span>}
              percent={trackerBreakdown.miscUnplannedPct}
              subText={formatCurrency(trackerBreakdown.miscUnplanned)}
              onClick={() => setFilterModal({ type: 'target', target: 'misc_unplanned', name: 'Misc / Unplanned Expenses' })}
              barClassName={miscUnplannedTone.barClassName}
            />
            <BarRow
              label="One-time"
              rightValue={<span className={oneTimeTone.textClassName}>{trackerBreakdown.oneTimePct.toFixed(1)}%</span>}
              percent={trackerBreakdown.oneTimePct}
              subText={formatCurrency(trackerBreakdown.oneTime)}
              onClick={() => setFilterModal({ type: 'target', target: 'one_time', name: 'One-time Expenses' })}
              barClassName={oneTimeTone.barClassName}
            />
          </div>
        </div>
      )}

      {/* Breakdown + Top Expenses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
        {/* Tabbed: Categories | Labels */}
        <div className="card p-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <SegmentedControl
              value={breakdownTab}
              onChange={setBreakdownTab}
              className="w-fit"
              ariaLabel="Breakdown type"
              options={[
                { value: 'categories', label: 'Categories' },
                {
                  value: 'labels',
                  label: <>Labels {allTags.length > 0 && <span className="ml-1 text-gray-400">({allTags.length})</span>}</>,
                },
              ]}
            />
            {(breakdownTab === 'categories' ? allCategories.length : allTags.length) > TOP_BREAKDOWN_LIMIT && (
              <button
                type="button"
                onClick={() => setBreakdownListModal(breakdownTab)}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap"
              >
                See all
              </button>
            )}
          </div>

          {breakdownTab === 'categories' ? (
            <div className="space-y-3">
              {topCategories.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No expenses in this period</p>
              ) : (
                topCategories.map(([category, { amount, icon }]) => {
                  const percentage = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
                  return (
                    <BarRow
                      key={category}
                      label={<span className="inline-flex items-center gap-1">{icon && <span>{icon}</span>}{category}</span>}
                      rightValue={formatCurrency(amount)}
                      percent={percentage}
                      subText={`${percentage.toFixed(1)}% of total`}
                      onClick={() => {
                        setFilterModal({ type: 'category', name: category });
                      }}
                    />
                  );
                })
              )}
            </div>
          ) : allTags.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No labels used this period</p>
          ) : (
            <div className="space-y-3">
              {topTags.map(([tagName, { amount, color }]) => {
                const percentage = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
                return (
                  <BarRow
                    key={tagName}
                    label={
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs"
                        style={{ backgroundColor: color + '20', color }}
                      >
                        {tagName}
                      </span>
                    }
                    rightValue={formatCurrency(amount)}
                    percent={percentage}
                    subText={`${percentage.toFixed(1)}% of total`}
                    onClick={() => {
                      setFilterModal({ type: 'label', name: tagName });
                    }}
                    barStyle={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-4">
          <SegmentedControl
            value={topExpensesTab}
            onChange={setTopExpensesTab}
            className="mb-4 w-fit"
            ariaLabel="Top expenses mode"
            options={[
              { value: 'expenses', label: 'Top 5 Expenses' },
              { value: 'preventable', label: `Preventable ${topPreventableExpenses.length ? `(${topPreventableExpenses.length})` : ''}` },
            ]}
          />

          {(() => {
            const list = topExpensesTab === 'expenses' ? topExpenses : topPreventableExpenses;
            if (list.length === 0) {
              if (topExpensesTab === 'preventable') {
                return (
                  <p className="text-sm text-gray-400 text-center py-6">
                    No preventable spends above ₹{DEFAULT_PREVENTABLE_THRESHOLD} in this period
                  </p>
                );
              }
              return <p className="text-sm text-gray-400 text-center py-6">No expenses in this period</p>;
            }
            return (
              <div className="space-y-2">
                {list.map((expense) => (
                  <ExpenseCard
                    key={expense.id}
                    cards={paymentCards}
                    expense={expense as ExpenseWithCategory}
                    onClick={() => setEditingExpense(expense as ExpenseWithCategory)}
                  />
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
        <div className="card p-4">
          <h3 className="text-base font-semibold text-gray-900 mb-3">
            {viewMode === 'week' ? 'Daily Spending (Week)' : 'Daily Spending'}
          </h3>
          <DailyExpenseChart data={dailyData} />
        </div>
        <div className="card p-4">
          <h3 className="text-base font-semibold text-gray-900 mb-3">
            {viewMode === 'week' ? 'Cumulative (Week)' : 'Cumulative Total'}
          </h3>
          <CumulativeExpenseChart data={cumulativeData} />
        </div>
      </div>

      {/* Full Ledger */}
      <div className="card p-4 mt-4">
        <div className="flex justify-between items-center gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">
              Full Ledger {!loading && `(${expenses.length})`}
            </h3>
            {reviewCount > 0 && (
              <button
                type="button"
                onClick={() => setReviewOnly((value) => !value)}
                className={`btn btn-sm ${reviewOnly ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={reviewOnly}
              >
                To review ({reviewCount})
              </button>
            )}
          </div>
          <Link
            href="/expenses/browse"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium px-2 py-2 rounded-md"
          >
            Advanced Filters →
          </Link>
        </div>
        {loading ? (
          <MonthViewSkeleton count={3} />
        ) : expenses.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-4xl mb-2">📭</p>
            <p>No expenses for this month</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(
              (reviewOnly && reviewCount > 0 ? expenses.filter(awaitsDecision) : expenses).reduce((acc, expense) => {
                const date = expense.date;
                if (!acc[date]) {
                  acc[date] = [];
                }
                acc[date].push(expense as ExpenseWithCategory);
                return acc;
              }, {} as Record<string, ExpenseWithCategory[]>)
            )
              .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
              .map(([date, dayExpenses]) => {
                const dayTotal = dayExpenses.reduce(
                  (sum, e) => sum + parseFloat(e.amount.toString()),
                  0
                );
                return (
                  <div key={date} suppressHydrationWarning>
                    <div className="flex items-center mb-2 pb-2 border-b-2 border-gray-300" suppressHydrationWarning>
                      <div className="flex-1 min-w-0 pl-1 pr-2">
                        <p className="font-semibold text-gray-900" suppressHydrationWarning>
                          {format(parseISO(date), 'EEE, MMM d')}
                        </p>
                        <p className="text-xs text-gray-500">
                          {dayExpenses.length} transaction{dayExpenses.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="text-right w-32 flex-shrink-0 pr-1">
                        <p className="text-base font-bold text-blue-900" suppressHydrationWarning>
                          {formatCurrency(dayTotal)}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2 mb-4">
                      {dayExpenses.map((expense) => (
                        <ExpenseCard
                          key={expense.id}
                          cards={paymentCards}
                          expense={expense}
                          onClick={() => setEditingExpense(expense as ExpenseWithCategory)}
                          onCategoryClick={(categoryName) => setFilterModal({ type: 'category', name: categoryName })}
                          onTagClick={(tagName) => setFilterModal({ type: 'label', name: tagName })}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {editingExpense && (
        <ExpenseDetailModal
          expense={editingExpense}
          cards={paymentCards}
          isOpen={!!editingExpense}
          onClose={() => setEditingExpense(null)}
          onSuccess={() => {
            setEditingExpense(null);
            refreshAfterMutation();
          }}
          onCategoryFilterClick={(categoryName) => setFilterModal({ type: 'category', name: categoryName })}
          onLabelFilterClick={(labelName) => setFilterModal({ type: 'label', name: labelName })}
        />
      )}

      {/* All Categories / Labels Modal */}
      <Modal
        isOpen={breakdownListModal !== null}
        onClose={() => setBreakdownListModal(null)}
        maxWidth="lg"
        title={
          breakdownListModal === 'categories'
            ? `All Categories (${allCategories.length})`
            : `All Labels (${allTags.length})`
        }
      >
        {breakdownListModal === 'categories' ? (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {allCategories.map(([category, { amount, icon }]) => {
              const percentage = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
              return (
                <BarRow
                  key={category}
                  label={<span className="inline-flex items-center gap-1">{icon && <span>{icon}</span>}{category}</span>}
                  rightValue={formatCurrency(amount)}
                  percent={percentage}
                  subText={`${percentage.toFixed(1)}% of total`}
                  onClick={() => {
                    setBreakdownListModal(null);
                    setFilterModal({ type: 'category', name: category });
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {allTags.map(([tagName, { amount, color }]) => {
              const percentage = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
              return (
                <BarRow
                  key={tagName}
                  label={
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs"
                      style={{ backgroundColor: color + '20', color }}
                    >
                      {tagName}
                    </span>
                  }
                  rightValue={formatCurrency(amount)}
                  percent={percentage}
                  subText={`${percentage.toFixed(1)}% of total`}
                  onClick={() => {
                    setBreakdownListModal(null);
                    setFilterModal({ type: 'label', name: tagName });
                  }}
                  barStyle={{ backgroundColor: color }}
                />
              );
            })}
          </div>
        )}
      </Modal>

      {/* Filtered Expenses Modal */}
      <Modal
        isOpen={!!filterModal}
        onClose={() => setFilterModal(null)}
        maxWidth="lg"
        title={
          <div className="min-w-0">
            <div className="text-lg font-bold text-gray-900 truncate">
              {filterModal?.name}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {filterModal?.type === 'category'
                ? 'Category'
                : filterModal?.type === 'label'
                ? 'Label'
                : filterModal?.type === 'preventable'
                ? 'Preventable'
                : 'Target'}{' '}
              · {filteredForModal.length} expense{filteredForModal.length !== 1 ? 's' : ''} · {formatCurrency(filteredTotal)}
            </div>
          </div>
        }
      >
        {filteredForModal.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">No matching expenses in this period.</div>
        ) : (
          <div className="space-y-2">
            {filteredForModal.map((expense) => (
              <ExpenseCard
                key={expense.id}
                cards={paymentCards}
                expense={expense as ExpenseWithCategory}
                onClick={() => {
                  setFilterModal(null);
                  setEditingExpense(expense as ExpenseWithCategory);
                }}
                onCategoryClick={(categoryName) => setFilterModal({ type: 'category', name: categoryName })}
                onTagClick={(tagName) => setFilterModal({ type: 'label', name: tagName })}
                subtitle={formatDate(expense.date)}
              />
            ))}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
