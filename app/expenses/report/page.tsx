'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatCurrency, formatMonth } from '@/lib/utils';
import { getCategoryIcon } from '@/lib/categoryUtils';
import {
  ComposedChart,
  Bar,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PageContainer } from '@/components/PageContainer';
import Modal from '@/components/Modal';
import { ExpandableChart } from '@/components/charts/ExpandableChart';
import { ReportViews } from '@/components/ReportViews';

interface CategoryData {
  category: {
    id: string;
    name: string;
    group_name: string;
    color: string;
    icon?: string;
    emoji?: string;
  };
  monthlyTotals: { [month: string]: number };
  total: number;
}

interface ReportData {
  months: string[];
  groupedData: { [groupName: string]: CategoryData[] };
  monthlyTotals: { [month: string]: number };
  grandTotal: number;
}

const PERIOD_OPTIONS = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
  { value: 24, label: '24 months' },
  { value: 36, label: '36 months' },
];

const MAX_STACKED_CATS = 7;

function fmtShort(value: number) {
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(0)}k`;
  return `₹${value.toFixed(2)}`;
}

export default function ExpenseReportPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthsBack, setMonthsBack] = useState(12);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [modalView, setModalView] = useState<'group' | 'category' | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryData | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/category-monthly?months=${monthsBack}`);
      const result: ReportData = await res.json();
      setData(result);

      // Default-select top 5 groups by total
      const top5Groups = Object.entries(result.groupedData)
        .map(([group, cats]) => ({ group, total: cats.reduce((s, c) => s + c.total, 0) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map((g) => g.group);
      setSelectedGroups(new Set(top5Groups));
    } catch (err) {
      console.error('Failed to fetch report:', err);
    } finally {
      setLoading(false);
    }
  }, [monthsBack]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <LoadingSpinner message="Loading report..." />;
  if (!data) return null;

  const allCategories = Object.values(data.groupedData)
    .flat()
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // ── Stacked-bar chart data ──────────────────────────────────────────────────
  // Top MAX_STACKED_CATS categories + "Other"
  const topCats = allCategories.slice(0, MAX_STACKED_CATS);
  const otherCatIds = new Set(allCategories.slice(MAX_STACKED_CATS).map((c) => c.category.id));

  const stackedChartData = data.months.map((month) => {
    const row: Record<string, string | number> = { month: formatMonth(month + '-01') };
    topCats.forEach((c) => {
      row[c.category.name] = c.monthlyTotals[month] ?? 0;
    });
    if (otherCatIds.size > 0) {
      row['Other'] = allCategories
        .filter((c) => otherCatIds.has(c.category.id))
        .reduce((s, c) => s + (c.monthlyTotals[month] ?? 0), 0);
    }
    row['total'] = data.monthlyTotals[month] ?? 0;
    return row;
  });

  // ── Group-level trend data ───────────────────────────────────────────────────
  const allGroups = Object.entries(data.groupedData)
    .map(([group, cats]) => {
      const activeCats = cats.filter((c) => c.total > 0);
      const total = activeCats.reduce((s, c) => s + c.total, 0);
      // pick the color of the highest-spend category in the group
      const topCat = [...activeCats].sort((a, b) => b.total - a.total)[0];
      return { group, total, color: topCat?.category.color ?? '#6b7280', cats: activeCats };
    })
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);

  const selectedGroupsList = allGroups.filter((g) => selectedGroups.has(g.group));

  const trendChartData = data.months.map((month) => {
    const row: Record<string, string | number> = { month: formatMonth(month + '-01') };
    selectedGroupsList.forEach((g) => {
      row[g.group] = g.cats.reduce((s, c) => s + (c.monthlyTotals[month] ?? 0), 0);
    });
    return row;
  });

  // ── Summary stats ────────────────────────────────────────────────────────────
  const totals = data.months.map((m) => data.monthlyTotals[m] ?? 0);
  const avgMonthly = data.grandTotal / data.months.length;
  const maxMonth = Math.max(...totals);
  const minMonth = Math.min(...totals.filter((v) => v > 0));
  const currentMonthTotal = totals[totals.length - 1] ?? 0;
  const prevMonthTotal = totals[totals.length - 2] ?? 0;
  const momChange = prevMonthTotal > 0 ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal) * 100 : 0;

  const toggleGroup = (group: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const openGroup = (group: string) => {
    setSelectedGroup(group);
    setModalView('group');
  };

  const openCategory = (cat: CategoryData) => {
    setSelectedCategory(cat);
    setModalView('category');
  };

  const backToGroup = () => setModalView('group');

  const closeModal = () => {
    setModalView(null);
    setSelectedGroup(null);
    setSelectedCategory(null);
  };

  return (
    <PageContainer maxWidth="full">
      <PageHeader title="Spending report" description="Monthly spending trends and category breakdown" />
      <ReportViews section="expenses" current="trends" />

      {/* Category Report lived only behind an orphaned /expenses/reports hub that
          nothing linked to, so the whole page was unreachable. Linked from here now. */}
      <Link href="/expenses/reports/category-monthly" className="block mb-4 sm:mb-6">
        <div className="card card-hover flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Category Report</h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              Month-by-month breakdown and trendline for a single category
            </p>
          </div>
          <span aria-hidden className="text-gray-400 text-xl shrink-0">›</span>
        </div>
      </Link>

      {/* Period selector */}
      <div className="card mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="sm:w-48">
            <label className="label">Period</label>
            <select
              value={monthsBack}
              onChange={(e) => setMonthsBack(parseInt(e.target.value))}
              className="select"
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="card p-3 sm:p-4">
          <p className="text-xs text-gray-500">This Month</p>
          <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-0.5">{formatCurrency(currentMonthTotal)}</p>
          <p className={`text-xs mt-1 font-medium ${momChange >= 0 ? 'text-red-500' : 'text-green-600'}`}>
            {momChange >= 0 ? '▲' : '▼'} {Math.abs(momChange).toFixed(1)}% vs last month
          </p>
        </div>
        <div className="card p-3 sm:p-4">
          <p className="text-xs text-gray-500">Monthly Average</p>
          <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-0.5">{formatCurrency(avgMonthly)}</p>
          <p className="text-xs text-gray-400 mt-1">over {monthsBack} months</p>
        </div>
        <div className="card p-3 sm:p-4">
          <p className="text-xs text-gray-500">Peak Month</p>
          <p className="text-lg sm:text-2xl font-bold text-red-600 mt-0.5">{formatCurrency(maxMonth)}</p>
          <p className="text-xs text-gray-400 mt-1">
            {data.months[totals.indexOf(maxMonth)]
              ? formatMonth(data.months[totals.indexOf(maxMonth)] + '-01')
              : '—'}
          </p>
        </div>
        <div className="card p-3 sm:p-4">
          <p className="text-xs text-gray-500">Total Period</p>
          <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-0.5">{formatCurrency(data.grandTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{allCategories.length} categories</p>
        </div>
      </div>

      {/* ── Stacked bar + total line ──────────────────────────────────────────── */}
      <div className="card mb-4 sm:mb-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
          Monthly Spending — Top Categories
        </h2>
        <ExpandableChart title="Monthly Spending — Top Categories" height={300} expandedHeight={560} overlayButton>
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={stackedChartData} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  height={70}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10 }}
                  tickFormatter={fmtShort}
                  width={52}
                />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === 'total' ? [formatCurrency(value), 'Total'] : [formatCurrency(value), name]
                  }
                  contentStyle={{ fontSize: '12px' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                  formatter={(value) => (value === 'total' ? 'Total' : value)}
                />
                {topCats.map((c) => (
                  <Bar
                    key={c.category.id}
                    yAxisId="left"
                    dataKey={c.category.name}
                    stackId="a"
                    fill={c.category.color}
                    maxBarSize={40}
                  />
                ))}
                {otherCatIds.size > 0 && (
                  <Bar yAxisId="left" dataKey="Other" stackId="a" fill="rgb(var(--gray-300))" maxBarSize={40} />
                )}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="total"
                  stroke="rgb(var(--primary-600))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ExpandableChart>
      </div>

      {/* ── Group trend (multi-line) ──────────────────────────────────────────── */}
      <div className="card mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6">
          {/* Group selector */}
          <div className="sm:w-48 flex-shrink-0">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Compare Groups</h3>
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {allGroups.map((g) => {
                const active = selectedGroups.has(g.group);
                return (
                  <button
                    key={g.group}
                    onClick={() => toggleGroup(g.group)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                      active ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="flex-1 truncate font-medium">{g.group}</span>
                    <span className="text-[10px] opacity-60 whitespace-nowrap">{fmtShort(g.total)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Line chart */}
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
              Group Trends
              {selectedGroups.size === 0 && (
                <span className="text-sm font-normal text-gray-400 ml-2">— select groups</span>
              )}
            </h2>
            {selectedGroups.size > 0 ? (
              <ExpandableChart title="Group Trends" height={280} expandedHeight={560} overlayButton>
                {() => (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartData} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={70} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtShort} width={52} />
                      <Tooltip
                        formatter={(value: number, name: string) => [formatCurrency(value), name]}
                        contentStyle={{ fontSize: '12px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                      {selectedGroupsList.map((g) => (
                        <Line
                          key={g.group}
                          type="monotone"
                          dataKey={g.group}
                          stroke={g.color}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ExpandableChart>
            ) : (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                Select one or more groups from the list
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Category summary grouped ──────────────────────────────────────────── */}
      {(() => {
        const groupRows = Object.entries(data.groupedData)
          .map(([group, cats]) => {
            const activeCats = cats.filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
            const groupTotal = activeCats.reduce((s, c) => s + c.total, 0);
            return { group, activeCats, groupTotal };
          })
          .filter((g) => g.activeCats.length > 0)
          .sort((a, b) => b.groupTotal - a.groupTotal);

        return (
          <div className="card p-0 overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">Category Summary</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {groupRows.map(({ group, activeCats, groupTotal }) => {
                const groupPct = data.grandTotal > 0 ? (groupTotal / data.grandTotal) * 100 : 0;
                const groupAvg = groupTotal / data.months.length;
                return (
                  <button
                    key={group}
                    onClick={() => openGroup(group)}
                    className="w-full flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-900">{group}</span>
                        <span className="text-xs text-gray-400">{activeCats.length} categories</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${groupPct}%`, backgroundColor: activeCats[0].category.color }} />
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <p className="text-sm font-semibold text-gray-900">{formatCurrency(groupTotal)}</p>
                      <p className="text-xs text-gray-400">{groupPct.toFixed(1)}% · {fmtShort(groupAvg)}/mo</p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                );
              })}
            </div>
            <div className="px-4 sm:px-6 py-3 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Total</span>
              <span className="text-sm font-bold text-gray-900">{formatCurrency(data.grandTotal)}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Unified modal (group → category) ─────────────────────────────────── */}
      <Modal
        isOpen={!!modalView}
        onClose={closeModal}
        maxWidth="md"
        title={
          <div className="flex items-center gap-3">
            {modalView === 'category' && (
              <button
                onClick={backToGroup}
                className="w-7 h-7 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-base"
              >
                ←
              </button>
            )}
            {modalView === 'group' && selectedGroup && (
              <span className="text-lg font-bold text-gray-900">{selectedGroup}</span>
            )}
            {modalView === 'category' && selectedCategory && (
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selectedCategory.category.color }} />
                <span className="text-lg font-bold text-gray-900">{selectedCategory.category.name}</span>
              </div>
            )}
          </div>
        }
      >
        {/* ── Group view ── */}
        {modalView === 'group' && selectedGroup && (() => {
          const groupCats = (data.groupedData[selectedGroup] ?? [])
            .filter((c) => c.total > 0)
            .sort((a, b) => b.total - a.total);
          const groupTotal = groupCats.reduce((s, c) => s + c.total, 0);
          const groupChartData = data.months.map((m) => ({
            month: formatMonth(m + '-01'),
            amount: groupCats.reduce((s, c) => s + (c.monthlyTotals[m] ?? 0), 0),
          }));
          const groupAvg = groupTotal / data.months.length;

          return (
            <>
              <div className="mb-5">
                <p className="text-sm text-gray-500 mb-1">Total spend</p>
                <p className="text-3xl font-bold text-gray-900">{formatCurrency(groupTotal)}</p>
                <p className="text-xs text-gray-400 mt-1">avg {formatCurrency(groupAvg)}/mo · {((groupTotal / data.grandTotal) * 100).toFixed(1)}% of all expenses</p>
              </div>

              <div className="mb-5">
                <h4 className="text-sm font-bold text-gray-900 mb-3">Spending Trend</h4>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={groupChartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtShort} width={44} />
                      <Tooltip formatter={(v: number) => [formatCurrency(v), selectedGroup]} contentStyle={{ fontSize: '11px' }} />
                      <ReferenceLine y={groupAvg} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.7} />
                      <Line type="monotone" dataKey="amount" stroke="rgb(var(--primary-600))" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <h4 className="text-sm font-bold text-gray-900 mb-2">Categories ({groupCats.length})</h4>
              <div className="space-y-1">
                {groupCats.map((c) => {
                  const pct = groupTotal > 0 ? (c.total / groupTotal) * 100 : 0;
                  return (
                    <div
                      key={c.category.id}
                      onClick={() => openCategory(c)}
                      className="flex items-center justify-between py-2.5 px-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.category.color }} />
                        <span className="text-sm font-medium text-gray-900 truncate">{c.category.name}</span>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(c.total)}</p>
                        <p className="text-xs text-gray-400">{pct.toFixed(1)}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}

        {/* ── Category view ── */}
        {modalView === 'category' && selectedCategory && (() => {
          const c = selectedCategory;
          const months = data.months;
          const values = months.map((m) => c.monthlyTotals[m] ?? 0);
          const activeValues = values.filter((v) => v > 0);
          const catAvg = activeValues.length > 0 ? activeValues.reduce((a, b) => a + b, 0) / activeValues.length : 0;
          const catMax = Math.max(...values);
          const catMin = activeValues.length > 0 ? Math.min(...activeValues) : 0;
          const chartData = months.map((m, i) => ({ month: formatMonth(m + '-01'), amount: values[i] }));

          return (
            <>
              <div className="mb-5">
                <p className="text-sm text-gray-500 mb-1">Total spend</p>
                <p className="text-3xl font-bold text-gray-900">{formatCurrency(c.total)}</p>
                <p className="text-xs text-gray-400 mt-1">avg {fmtShort(catAvg)}/mo · peak {fmtShort(catMax)}</p>
              </div>

              <div className="mb-5">
                <h4 className="text-sm font-bold text-gray-900 mb-3">Spending Trend</h4>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtShort} width={44} />
                      <Tooltip formatter={(v: number) => [formatCurrency(v), c.category.name]} contentStyle={{ fontSize: '11px' }} />
                      <ReferenceLine y={catAvg} stroke={c.category.color} strokeDasharray="4 3" strokeOpacity={0.6} />
                      <Line type="monotone" dataKey="amount" stroke={c.category.color} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <h4 className="text-sm font-bold text-gray-900 mb-2">Monthly breakdown</h4>
              <div className="max-h-52 overflow-y-auto space-y-0.5">
                {[...months].reverse().map((m) => {
                  const val = c.monthlyTotals[m] ?? 0;
                  const barPct = catMax > 0 ? (val / catMax) * 100 : 0;
                  const isPeak = val === catMax && val > 0;
                  const isLowest = val === catMin && val > 0 && catMin !== catMax;
                  return (
                    <div key={m} className={`flex items-center gap-3 px-2 py-1.5 rounded-lg ${isPeak ? 'bg-red-50' : isLowest ? 'bg-green-50' : ''}`}>
                      <span className="text-xs text-gray-500 w-14 flex-shrink-0">{formatMonth(m + '-01')}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: c.category.color, opacity: val === 0 ? 0 : 1 }} />
                      </div>
                      <span className={`text-xs font-semibold w-14 text-right flex-shrink-0 ${val === 0 ? 'text-gray-300' : isPeak ? 'text-red-600' : isLowest ? 'text-green-600' : 'text-gray-800'}`}>
                        {val === 0 ? '—' : fmtShort(val)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </Modal>
    </PageContainer>
  );
}
