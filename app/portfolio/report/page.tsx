'use client';

import { useState, useEffect, Fragment, useCallback } from 'react';
import { formatCurrency, formatMonth } from '@/lib/utils';
import {
  LineChart, Line, ComposedChart, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, LabelList, Legend,
} from 'recharts';
import { PortfolioReportData } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PageContainer } from '@/components/PageContainer';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, MetricGrid } from '@/components/MetricCard';
import Modal from '@/components/Modal';
import { useAccountTypes } from '@/lib/useAccountTypes';
import { ExpandableChart } from '@/components/charts/ExpandableChart';

const PERIOD_OPTIONS = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
  { value: 24, label: '24 months' },
  { value: 36, label: '36 months' },
];

const ACCOUNT_COLORS = [
  '#3b82f6', '#ef4444', '#f97316', '#84cc16', '#06b6d4',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#6366f1',
  '#10b981', '#a855f7', '#e11d48', '#0891b2', '#65a30d',
];


function linReg(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values.map(() => 0);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  const num = values.reduce((s, v, i) => s + (i - xMean) * (v - yMean), 0);
  const den = values.reduce((s, _, i) => s + Math.pow(i - xMean, 2), 0);
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  return values.map((_, i) => parseFloat((intercept + slope * i).toFixed(4)));
}

function fmtShort(value: number) {
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(0)}k`;
  return `₹${value.toFixed(0)}`;
}

export default function PortfolioMonthlyReport() {
  const { typeColors, growthTypes, equityTypes } = useAccountTypes();
  const [data, setData] = useState<PortfolioReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [monthsBack, setMonthsBack] = useState(12);
  const [filterType, setFilterType] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [expandedChart, setExpandedChart] = useState<null | 'growthRate' | 'growthAmount'>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ months: monthsBack.toString() });
      if (filterType) params.append('type', filterType);

      const response = await fetch(`/api/portfolio/report?${params.toString()}`);
      const result: PortfolioReportData = await response.json();
      setData(result);

      // Default-select top 6 accounts by latest balance (selector will then filter to growth types)
      const allAccounts = Object.values(result.groupedData).flat();
      const top6 = [...allAccounts]
        .filter((a) => (a.latestBalance ?? 0) > 0)
        .sort((a, b) => (b.latestBalance ?? 0) - (a.latestBalance ?? 0))
        .slice(0, 6)
        .map((a) => a.account.id);
      setSelectedAccountIds(new Set(top6));
    } catch (err) {
      console.error('Failed to fetch report:', err);
    } finally {
      setLoading(false);
    }
  }, [monthsBack, filterType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <LoadingSpinner message="Loading report..." />;
  if (!data) return (
    <PageContainer maxWidth="full">
      <EmptyState
        icon="⚠️"
        title="Failed to load report"
        description="Try refreshing this page."
      />
    </PageContainer>
  );

  const TOTAL_TREND_ID = '__total__';
  const allAccounts = Object.values(data.groupedData).flat();
  const uniqueTypes = Object.keys(data.groupedData);

  // Assign a stable color to each account by index
  const accountColorMap: Record<string, string> = {};
  allAccounts.forEach((a, idx) => {
    accountColorMap[a.account.id] = ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length];
  });

  // ── Single-account trend (clicked from table) ──────────────────────────────
  const getAccountTrendData = (accountId: string) => {
    if (accountId === TOTAL_TREND_ID) {
      return data.months.map((month) => ({
        month: formatMonth(month + '-01'),
        balance: data.monthlyTotals[month] ?? 0,
      }));
    }
    const accountData = allAccounts.find((a) => a.account.id === accountId);
    if (!accountData) return [];
    return data.months
      .map((month) => ({ month: formatMonth(month + '-01'), balance: accountData.monthlyBalances[month] }))
      .filter((d) => d.balance !== null);
  };

  const isTotalTrend = selectedAccount === TOTAL_TREND_ID;
  const selectedAccountData = selectedAccount && !isTotalTrend
    ? allAccounts.find((a) => a.account.id === selectedAccount)
    : null;

  // ── Multi-line trend (account selector) ────────────────────────────────────
  const selectedAccounts = allAccounts.filter(
    (a) => selectedAccountIds.has(a.account.id) && growthTypes.includes(a.account.type)
  );

  const multiLineTrendData = data.months.map((month) => {
    const row: Record<string, string | number> = { month: formatMonth(month + '-01') };
    selectedAccounts.forEach((a) => {
      row[a.account.id] = a.monthlyBalances[month] ?? 0;
    });
    return row;
  });

  const multiLineMax = Math.max(
    0,
    ...selectedAccounts.flatMap((a) =>
      Object.values(a.monthlyBalances).filter((v) => v !== null) as number[]
    )
  );
  // Round up to the nearest lakh for a clean ceiling
  const multiLineYMax = Math.ceil(multiLineMax / 100000) * 100000 || 100000;

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Account trend selector: only accounts whose type is marked show_in_growth
  const sortedAccounts = [...allAccounts]
    .filter((a) => (a.latestBalance ?? 0) !== 0 && growthTypes.includes(a.account.type))
    .sort((a, b) => (b.latestBalance ?? 0) - (a.latestBalance ?? 0));

  // ── Growth % chart data ────────────────────────────────────────────────────
  const growthAccounts = allAccounts.filter((a) => growthTypes.includes(a.account.type));
  const equityAccounts = allAccounts.filter((a) => equityTypes.includes(a.account.type));

  const growthMonthlyTotals: Record<string, number> = {};
  const equityMonthlyTotals: Record<string, number> = {};
  data.months.forEach((month) => {
    growthMonthlyTotals[month] = growthAccounts.reduce((sum, a) => sum + (a.monthlyBalances[month] ?? 0), 0);
    equityMonthlyTotals[month] = equityAccounts.reduce((sum, a) => sum + (a.monthlyBalances[month] ?? 0), 0);
  });

  const growthMonths = data.months.slice(1);
  const allGrowthPcts: number[] = [];
  const growthGrowthPcts: number[] = [];
  const equityGrowthPcts: number[] = [];

  growthMonths.forEach((month, idx) => {
    const prevMonth = data.months[idx];
    const curr = data.monthlyTotals[month] ?? 0;
    const prev = data.monthlyTotals[prevMonth] ?? 0;
    allGrowthPcts.push(prev > 0 ? parseFloat((((curr - prev) / prev) * 100).toFixed(2)) : 0);

    const gCurr = growthMonthlyTotals[month] ?? 0;
    const gPrev = growthMonthlyTotals[prevMonth] ?? 0;
    growthGrowthPcts.push(gPrev > 0 ? parseFloat((((gCurr - gPrev) / gPrev) * 100).toFixed(2)) : 0);

    const eCurr = equityMonthlyTotals[month] ?? 0;
    const ePrev = equityMonthlyTotals[prevMonth] ?? 0;
    equityGrowthPcts.push(ePrev > 0 ? parseFloat((((eCurr - ePrev) / ePrev) * 100).toFixed(2)) : 0);
  });

  const allTrendline = linReg(allGrowthPcts);
  const growthTrendline = linReg(growthGrowthPcts);
  const equityTrendline = linReg(equityGrowthPcts);
  const showGrowthLabels = growthMonths.length <= 18;

  const growthChartData = growthMonths.map((month, idx) => ({
    month: formatMonth(month + '-01'),
    all: allGrowthPcts[idx],
    growth: growthGrowthPcts[idx],
    equity: equityGrowthPcts[idx],
    allTrend: allTrendline[idx],
    growthTrend: growthTrendline[idx],
    equityTrend: equityTrendline[idx],
  }));

  // ── Growth Amount (absolute ₹ MoM change) ──────────────────────────────────
  const allGrowthAmounts: number[] = [];
  const growthGrowthAmounts: number[] = [];
  const equityGrowthAmounts: number[] = [];
  growthMonths.forEach((month, idx) => {
    const prevMonth = data.months[idx];
    allGrowthAmounts.push((data.monthlyTotals[month] ?? 0) - (data.monthlyTotals[prevMonth] ?? 0));
    growthGrowthAmounts.push((growthMonthlyTotals[month] ?? 0) - (growthMonthlyTotals[prevMonth] ?? 0));
    equityGrowthAmounts.push((equityMonthlyTotals[month] ?? 0) - (equityMonthlyTotals[prevMonth] ?? 0));
  });
  const allAmtTrendline = linReg(allGrowthAmounts);
  const growthAmtTrendline = linReg(growthGrowthAmounts);
  const equityAmtTrendline = linReg(equityGrowthAmounts);
  const growthAmountChartData = growthMonths.map((month, idx) => ({
    month: formatMonth(month + '-01'),
    all: allGrowthAmounts[idx],
    growth: growthGrowthAmounts[idx],
    equity: equityGrowthAmounts[idx],
    allTrend: allAmtTrendline[idx],
    growthTrend: growthAmtTrendline[idx],
    equityTrend: equityAmtTrendline[idx],
  }));

  // ── Type-level monthly totals ───────────────────────────────────────────────
  const fromMonth = data.months[0];
  const endMonth = data.months[data.months.length - 1];

  const typeMonthlyTotals: Record<string, Record<string, number>> = {};
  Object.entries(data.groupedData).forEach(([typeName, accounts]) => {
    typeMonthlyTotals[typeName] = {};
    data.months.forEach((month) => {
      typeMonthlyTotals[typeName][month] = accounts.reduce(
        (sum, a) => sum + (a.monthlyBalances[month] ?? 0), 0
      );
    });
  });

  // ── Portfolio comparison bar (from vs end, growth-tracked types only) ───────
  const barChartData = Object.entries(typeMonthlyTotals)
    .filter(([type]) => growthTypes.includes(type))
    .map(([type, months]) => ({
      type,
      from: months[fromMonth] ?? 0,
      end: months[endMonth] ?? 0,
    }))
    .filter((d) => Math.abs(d.from) + Math.abs(d.end) > 0)
    .sort((a, b) => Math.abs(b.end) - Math.abs(a.end));

  // ── Debt ratio ────────────────────────────────────────────────────────────
  // Debt types = any type whose end-month total is negative
  const debtTypes = Object.entries(typeMonthlyTotals)
    .filter(([, months]) => (months[endMonth] ?? 0) < 0)
    .map(([type]) => type);

  const debtChartData = data.months.map((month) => {
    const totalDebt = debtTypes.reduce(
      (sum, type) => sum + Math.abs(typeMonthlyTotals[type][month] ?? 0), 0
    );
    const totalAssets = Object.entries(typeMonthlyTotals).reduce(
      (sum, [, months]) => sum + Math.max(0, months[month] ?? 0), 0
    );
    const ratio = totalAssets > 0 ? parseFloat(((totalDebt / totalAssets) * 100).toFixed(2)) : 0;
    return { month: formatMonth(month + '-01'), debt: totalDebt, ratio };
  });
  const hasDebt = debtTypes.length > 0 && debtChartData.some((d) => d.debt > 0);

  // ── Portfolio allocation pie (then + now) ─────────────────────────────────
  // Build a stable color map across all types so both pies use identical colors
  const allPieTypes = Object.keys(typeMonthlyTotals).sort();
  const stableTypeColors: Record<string, string> = {};
  allPieTypes.forEach((type, idx) => {
    stableTypeColors[type] = typeColors[type] ?? ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length];
  });

  const makePie = (month: string) =>
    Object.entries(typeMonthlyTotals)
      .map(([type, months]) => ({
        name: type,
        value: months[month] ?? 0,
        color: stableTypeColors[type],
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);

  const pieDataThen = makePie(fromMonth);
  const pieDataNow  = makePie(endMonth);
  const pieTotalThen = pieDataThen.reduce((s, d) => s + d.value, 0);
  const pieTotalNow  = pieDataNow.reduce((s, d) => s + d.value, 0);

  const balanceLabel = filterType ? `${filterType} Balance` : 'Current Net Worth';

  return (
    <PageContainer maxWidth="full">
      <PageHeader title="Selvam Report" />

      {/* Filters — always on top */}
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
          <div className="sm:w-48">
            <label className="label">Filter by Type</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="select"
            >
              <option value="">All Types</option>
              {uniqueTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <MetricGrid className="md:grid-cols-3 mb-4">
        <MetricCard
          tone="green"
          label={balanceLabel}
          value={formatCurrency(data.currentTotal)}
          subtext={filterType ? `${filterType} only` : undefined}
        />
        <MetricCard
          tone="blue"
          label={`Growth (${monthsBack}m)`}
          value={`${data.overallGrowth >= 0 ? '↑' : '↓'} ${formatCurrency(Math.abs(data.overallGrowth))}`}
          subtext={`${data.overallGrowthPercent >= 0 ? '+' : ''}${data.overallGrowthPercent.toFixed(2)}%`}
        />
        <MetricCard tone="purple" label="Account Types" value={uniqueTypes.length} />
      </MetricGrid>

      {/* ── Multi-line Account Trend ──────────────────────────────────────────── */}
      <div className="card mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
          {/* Account selector */}
          <div className="sm:w-56 flex-shrink-0">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Compare Accounts</h3>
            <p className="text-xs text-gray-400 mb-2">Growth-tracked types only</p>
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {sortedAccounts.map((a) => {
                const active = selectedAccountIds.has(a.account.id);
                const color = accountColorMap[a.account.id];
                return (
                  <button
                    key={a.account.id}
                    onClick={() => toggleAccount(a.account.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                      active ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{a.account.name}</p>
                      <p className={`text-[10px] ${active ? 'opacity-60' : 'text-gray-400'}`}>{a.account.type}</p>
                    </div>
                    <span className={`text-[10px] whitespace-nowrap ${active ? 'opacity-60' : 'text-gray-400'}`}>
                      {fmtShort(a.latestBalance ?? 0)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chart */}
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
              Account Trends
              {selectedAccountIds.size === 0 && (
                <span className="text-sm font-normal text-gray-400 ml-2">— select accounts</span>
              )}
            </h2>
            {selectedAccountIds.size > 0 ? (
              <ExpandableChart title="Account Trends" height={300} expandedHeight={560} overlayButton>
                {() => (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={multiLineTrendData} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        height={70}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={fmtShort}
                        width={56}
                        domain={[0, multiLineYMax]}
                      />
                      <Tooltip
                        formatter={(value: number, id: string) => {
                          const acc = allAccounts.find((a) => a.account.id === id);
                          return [formatCurrency(value), acc?.account.name ?? id];
                        }}
                        contentStyle={{
                          fontSize: '12px',
                          backgroundColor: 'rgba(255,255,255,0.97)',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                        }}
                      />
                      {selectedAccounts.map((a) => (
                        <Line
                          key={a.account.id}
                          type="monotone"
                          dataKey={a.account.id}
                          stroke={accountColorMap[a.account.id]}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ExpandableChart>
            ) : (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                Select one or more accounts from the list
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Monthly Growth Rate ───────────────────────────────────────────────── */}
      {growthChartData.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Monthly Growth Rate</h2>
              <p className="text-xs text-gray-400 mb-4">
                Month-over-month % change · 3 series: All / Growth / Equity
              </p>
            </div>
            <button
              onClick={() => setExpandedChart('growthRate')}
              className="btn btn-secondary btn-sm whitespace-nowrap"
            >
              Expand
            </button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={growthChartData} margin={{ top: 16, right: 8, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                height={70}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
                width={48}
              />
              <ReferenceLine y={0} stroke="#374151" strokeWidth={1.5} />
              <Tooltip
                formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                contentStyle={{
                  fontSize: '12px',
                  backgroundColor: 'rgba(255,255,255,0.97)',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />

              {/* All % line */}
              <Line
                type="monotone"
                dataKey="all"
                name="All"
                stroke="#3b82f6"
                strokeWidth={1.5}
                dot={{ r: 3, fill: '#3b82f6' }}
                activeDot={{ r: 5 }}
              >
                {showGrowthLabels && (
                  <LabelList
                    dataKey="all"
                    position="top"
                    formatter={(v: number) => `${v.toFixed(2)}%`}
                    style={{ fontSize: 8, fill: '#3b82f6' }}
                  />
                )}
              </Line>

              {/* All trendline */}
              <Line
                type="monotone"
                dataKey="allTrend"
                stroke="#3b82f6"
                strokeWidth={2.2}
                dot={false}
                strokeDasharray="6 3"
                strokeOpacity={0.55}
                legendType="none"
              />

              {/* Growth % line */}
              {growthAccounts.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="growth"
                  name="Growth"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  dot={{ r: 3, fill: '#10b981' }}
                  activeDot={{ r: 5 }}
                />
              )}

              {/* Growth trendline */}
              {growthAccounts.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="growthTrend"
                  stroke="#10b981"
                  strokeWidth={2.2}
                  dot={false}
                  strokeDasharray="6 3"
                  strokeOpacity={0.55}
                  legendType="none"
                />
              )}

              {/* Equity % line */}
              {equityAccounts.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="equity"
                  name="Equity"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  dot={{ r: 3, fill: '#8b5cf6' }}
                  activeDot={{ r: 5 }}
                />
              )}

              {/* Equity trendline */}
              {equityAccounts.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="equityTrend"
                  stroke="#8b5cf6"
                  strokeWidth={2.2}
                  dot={false}
                  strokeDasharray="6 3"
                  strokeOpacity={0.55}
                  legendType="none"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          {!showGrowthLabels && (
            <p className="text-xs text-gray-400 text-center mt-2">Hover over points to see values · switch to ≤18 months to show labels</p>
          )}
        </div>
      )}

      {/* ── Growth Amount ─────────────────────────────────────────────────────── */}
      {growthAmountChartData.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Monthly Growth Amount</h2>
              <p className="text-xs text-gray-400 mb-4">
                Month-over-month absolute change (₹) · 3 series: All / Growth / Equity
              </p>
            </div>
            <button
              onClick={() => setExpandedChart('growthAmount')}
              className="btn btn-secondary btn-sm whitespace-nowrap"
            >
              Expand
            </button>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={growthAmountChartData} margin={{ top: 8, right: 8, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtShort} width={56} />
              <ReferenceLine y={0} stroke="#374151" strokeWidth={1.5} />
              <Tooltip
                formatter={(v: number, name: string) => [formatCurrency(v), name]}
                contentStyle={{ fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '8px' }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              <Line type="monotone" dataKey="all" name="All" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="allTrend" stroke="#3b82f6" strokeWidth={2.2} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />

              {growthAccounts.length > 0 && (
                <Line type="monotone" dataKey="growth" name="Growth" stroke="#10b981" strokeWidth={1.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              )}
              {growthAccounts.length > 0 && (
                <Line type="monotone" dataKey="growthTrend" stroke="#10b981" strokeWidth={2.2} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />
              )}

              {equityAccounts.length > 0 && (
                <Line type="monotone" dataKey="equity" name="Equity" stroke="#8b5cf6" strokeWidth={1.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              )}
              {equityAccounts.length > 0 && (
                <Line type="monotone" dataKey="equityTrend" stroke="#8b5cf6" strokeWidth={2.2} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Portfolio by Type ─────────────────────────────────────────────────── */}
      <div className="card mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Portfolio by Type</h2>
        <p className="text-xs text-gray-400 mb-4">
          Growth-tracked types ·{' '}
          <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 mr-1" />
          Then ({formatMonth(fromMonth + '-01')})
          <span className="mx-2">→</span>
          <span className="inline-block w-2 h-2 rounded-sm bg-red-400 mr-1" />
          Now ({formatMonth(endMonth + '-01')})
        </p>
        <ExpandableChart title="Portfolio by Type" height={300} expandedHeight={560} overlayButton>
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData} margin={{ top: 4, right: 8, left: 0, bottom: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="type" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={90} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtShort} width={56} />
                <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatCurrency(v), name === 'from' ? `Then (${formatMonth(fromMonth + '-01')})` : `Now (${formatMonth(endMonth + '-01')})`]}
                  contentStyle={{ fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px' }}
                  formatter={(val) => val === 'from' ? `Then (${formatMonth(fromMonth + '-01')})` : `Now (${formatMonth(endMonth + '-01')})`}
                />
                <Bar dataKey="from" name="from" fill="#3b82f6" maxBarSize={32} />
                <Bar dataKey="end" name="end" fill="#f87171" maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ExpandableChart>
      </div>

      {/* ── Allocation: Then vs Now ────────────────────────────────────────────── */}
      <div className="card mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Allocation</h2>
        <p className="text-xs text-gray-400 mb-4">Portfolio split by type · then vs now</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {[
            { label: `Then · ${formatMonth(fromMonth + '-01')}`, pieData: pieDataThen, pieTotal: pieTotalThen },
            { label: `Now · ${formatMonth(endMonth + '-01')}`,   pieData: pieDataNow,  pieTotal: pieTotalNow  },
          ].map(({ label, pieData, pieTotal }) => (
            <div key={label}>
              <p className="text-xs font-semibold text-gray-500 text-center mb-2">{label}</p>
              <ExpandableChart title={`Allocation — ${label}`} height={200} expandedHeight={560} overlayButton>
                {({ isExpanded }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={isExpanded ? 140 : 80}
                        dataKey="value"
                        labelLine={false}
                        label={false}
                      >
                        {pieData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number, name: string) => [
                          `${formatCurrency(v)} (${pieTotal > 0 ? ((v / pieTotal) * 100).toFixed(1) : 0}%)`,
                          name,
                        ]}
                        contentStyle={{ fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ExpandableChart>
              <div className="mt-2 space-y-1">
                {pieData.map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="text-gray-700">{entry.name}</span>
                    </div>
                    <span className="text-gray-500">
                      {pieTotal > 0 ? ((entry.value / pieTotal) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Debt Ratio ──────────────────────────────────────────────────────── */}
      {hasDebt && (
        <div className="card mb-4">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Debt Ratio</h2>
          <p className="text-xs text-gray-400 mb-4">
            Debt types: {debtTypes.join(', ')} · ratio = |debt| ÷ total assets
          </p>
          <ExpandableChart title="Debt Ratio" height={300} expandedHeight={560} overlayButton>
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={debtChartData} margin={{ top: 8, right: 8, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={70} />
                  <YAxis
                    yAxisId="amount"
                    tick={{ fontSize: 10 }}
                    tickFormatter={fmtShort}
                    width={56}
                  />
                  <YAxis
                    yAxisId="ratio"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => `${v.toFixed(1)}%`}
                    width={44}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === 'Debt Ratio %'
                        ? [`${value.toFixed(2)}%`, name]
                        : [formatCurrency(value), name]
                    }
                    contentStyle={{ fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar
                    yAxisId="amount"
                    dataKey="debt"
                    name="Debt Amount"
                    fill="#f87171"
                    maxBarSize={32}
                    opacity={0.8}
                  />
                  <Line
                    yAxisId="ratio"
                    type="monotone"
                    dataKey="ratio"
                    name="Debt Ratio %"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ExpandableChart>
        </div>
      )}

      {/* Account trend modal */}
      <Modal
        isOpen={!!selectedAccount && (!!selectedAccountData || isTotalTrend)}
        onClose={() => setSelectedAccount(null)}
        maxWidth="md"
        title={
          isTotalTrend
            ? filterType ? `Total — ${filterType}` : 'Total Portfolio'
            : selectedAccountData?.account.name ?? ''
        }
      >
        {selectedAccount && (selectedAccountData || isTotalTrend) && (() => {
          const trendData = getAccountTrendData(selectedAccount);
          const label = isTotalTrend ? 'Net Worth' : 'Balance';
          const balance = isTotalTrend ? data.currentTotal : selectedAccountData!.latestBalance;
          const growth = isTotalTrend ? data.overallGrowth : selectedAccountData!.growth;
          const growthPct = isTotalTrend ? data.overallGrowthPercent : selectedAccountData!.growthPercent;
          const color = isTotalTrend ? '#10b981' : (selectedAccountData ? accountColorMap[selectedAccountData.account.id] : '#10b981');

          return (
            <div>
              {/* Balance header */}
              <div className="mb-6">
                {!isTotalTrend && selectedAccountData && (
                  <p className="text-sm text-gray-500 mb-1">{selectedAccountData.account.type}</p>
                )}
                <div className={`text-3xl font-bold ${(balance ?? 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(balance ?? 0)}
                </div>
                {growth !== null && growthPct !== null && (
                  <p className={`text-sm mt-1 ${growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {growth >= 0 ? '↑' : '↓'} {formatCurrency(Math.abs(growth))}
                    <span className="text-gray-400 ml-1">({growthPct >= 0 ? '+' : ''}{growthPct.toFixed(2)}%)</span>
                  </p>
                )}
              </div>

              {/* Trend chart */}
              {trendData.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-gray-900 mb-3">Balance Trend</h4>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 9 }}
                          angle={-45}
                          textAnchor="end"
                          height={55}
                        />
                        <YAxis
                          tick={{ fontSize: 9 }}
                          tickFormatter={fmtShort}
                          width={44}
                        />
                        <Tooltip
                          formatter={(value: number) => [formatCurrency(value), label]}
                          contentStyle={{
                            backgroundColor: 'rgba(255,255,255,0.97)',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                            fontSize: '11px',
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="balance"
                          stroke={color}
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: color }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Expanded chart modal */}
      <Modal
        isOpen={expandedChart !== null}
        onClose={() => setExpandedChart(null)}
        maxWidth="lg"
        title={expandedChart === 'growthAmount' ? 'Monthly Growth Amount' : 'Monthly Growth Rate'}
      >
        {expandedChart === 'growthRate' && (
          <div className="h-[420px] sm:h-[560px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={growthChartData} margin={{ top: 16, right: 12, left: 0, bottom: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={75} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(1)}%`} width={50} />
                <ReferenceLine y={0} stroke="#374151" strokeWidth={1.5} />
                <Tooltip
                  formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                  contentStyle={{
                    fontSize: '12px',
                    backgroundColor: 'rgba(255,255,255,0.97)',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />

                <Line type="monotone" dataKey="all" name="All" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="allTrend" stroke="#3b82f6" strokeWidth={2.6} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />

                {growthAccounts.length > 0 && (
                  <Line type="monotone" dataKey="growth" name="Growth" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                )}
                {growthAccounts.length > 0 && (
                  <Line type="monotone" dataKey="growthTrend" stroke="#10b981" strokeWidth={2.6} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />
                )}

                {equityAccounts.length > 0 && (
                  <Line type="monotone" dataKey="equity" name="Equity" stroke="#8b5cf6" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                )}
                {equityAccounts.length > 0 && (
                  <Line type="monotone" dataKey="equityTrend" stroke="#8b5cf6" strokeWidth={2.6} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {expandedChart === 'growthAmount' && (
          <div className="h-[420px] sm:h-[560px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={growthAmountChartData} margin={{ top: 16, right: 12, left: 0, bottom: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={75} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtShort} width={56} />
                <ReferenceLine y={0} stroke="#374151" strokeWidth={1.5} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatCurrency(v), name]}
                  contentStyle={{ fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />

                <Line type="monotone" dataKey="all" name="All" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="allTrend" stroke="#3b82f6" strokeWidth={2.6} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />

                {growthAccounts.length > 0 && (
                  <Line type="monotone" dataKey="growth" name="Growth" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                )}
                {growthAccounts.length > 0 && (
                  <Line type="monotone" dataKey="growthTrend" stroke="#10b981" strokeWidth={2.6} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />
                )}

                {equityAccounts.length > 0 && (
                  <Line type="monotone" dataKey="equity" name="Equity" stroke="#8b5cf6" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                )}
                {equityAccounts.length > 0 && (
                  <Line type="monotone" dataKey="equityTrend" stroke="#8b5cf6" strokeWidth={2.6} dot={false} strokeDasharray="6 3" strokeOpacity={0.55} legendType="none" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Modal>

      {/* Monthly Breakdown Table */}
      {(() => {
        const fromMonth = data.months[0];
        const endMonth = data.months[data.months.length - 1];
        const fromLabel = formatMonth(fromMonth + '-01');
        const endLabel = formatMonth(endMonth + '-01');

        return (
          <div className="card p-0 overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900">Monthly Breakdown</h2>
              <p className="text-xs text-gray-400">Tap any row to view trend</p>
            </div>

            <table className="w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase border-r border-gray-200">
                    Account
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-700 uppercase whitespace-nowrap">
                    {fromLabel}
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-700 uppercase whitespace-nowrap">
                    {endLabel}
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-200">
                    Growth
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Object.entries(data.groupedData).map(([typeName, accounts]) => (
                  <Fragment key={typeName}>
                    <tr className="bg-gray-100">
                      <td colSpan={4} className="px-3 py-2 text-xs font-bold text-gray-900">
                        {typeName}
                        {data.typeBalances[typeName] && (
                          <span className="ml-2 text-gray-500 font-normal">
                            {fmtShort(data.typeBalances[typeName].latestTotal)}
                          </span>
                        )}
                      </td>
                    </tr>
                    {accounts.map((accData) => {
                      const fromVal = accData.monthlyBalances[fromMonth];
                      const endVal = accData.monthlyBalances[endMonth];
                      const isSelected = selectedAccount === accData.account.id;
                      const fromCarried = accData.carriedMonths?.includes(fromMonth);
                      const endCarried = accData.carriedMonths?.includes(endMonth);
                      return (
                        <tr
                          key={accData.account.id}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-green-50' : 'hover:bg-gray-50'
                          }`}
                          onClick={() => setSelectedAccount(isSelected ? null : accData.account.id)}
                        >
                          <td className={`px-3 py-2.5 text-sm text-gray-900 border-r border-gray-200 ${isSelected ? 'font-medium' : ''}`}>
                            {accData.account.name}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-right text-gray-500 whitespace-nowrap">
                            {fromVal !== null ? (
                              <span className="inline-flex items-center gap-1 justify-end">
                                {fmtShort(fromVal)}
                                {fromCarried && (
                                  <span title="Carried from previous snapshot" className="text-[9px] text-amber-400 font-bold leading-none">↩</span>
                                )}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-right text-gray-900 whitespace-nowrap font-medium">
                            {endVal !== null ? (
                              <span className={`inline-flex items-center gap-1 justify-end ${endVal < 0 ? 'text-red-600' : ''}`}>
                                {fmtShort(endVal)}
                                {endCarried && (
                                  <span title="Carried from previous snapshot" className="text-[9px] text-amber-400 font-bold leading-none">↩</span>
                                )}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right border-l border-gray-200 whitespace-nowrap">
                            {accData.growth !== null && accData.growthPercent !== null ? (
                              <div>
                                <p className={`text-sm font-medium ${accData.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {accData.growth >= 0 ? '+' : ''}{fmtShort(accData.growth)}
                                </p>
                                <p className="text-xs text-gray-400">
                                  {accData.growthPercent >= 0 ? '+' : ''}{accData.growthPercent.toFixed(1)}%
                                </p>
                              </div>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {/* Total row */}
                <tr
                  className={`font-bold cursor-pointer transition-colors ${
                    selectedAccount === TOTAL_TREND_ID ? 'bg-green-100' : 'bg-blue-50 hover:bg-blue-100'
                  }`}
                  onClick={() => setSelectedAccount(selectedAccount === TOTAL_TREND_ID ? null : TOTAL_TREND_ID)}
                >
                  <td className="px-3 py-2.5 text-sm text-gray-900 border-r border-gray-200">
                    TOTAL{filterType && <span className="ml-1 text-xs font-normal text-gray-400">({filterType})</span>}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-right text-gray-500 whitespace-nowrap">
                    {fmtShort(data.monthlyTotals[fromMonth] ?? 0)}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-right text-gray-900 whitespace-nowrap">
                    {fmtShort(data.monthlyTotals[endMonth] ?? 0)}
                  </td>
                  <td className="px-3 py-2.5 text-right border-l border-gray-200 whitespace-nowrap">
                    <p className={`text-sm font-medium ${data.overallGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {data.overallGrowth >= 0 ? '+' : ''}{fmtShort(data.overallGrowth)}
                    </p>
                    <p className="text-xs text-gray-400">
                      {data.overallGrowthPercent >= 0 ? '+' : ''}{data.overallGrowthPercent.toFixed(1)}%
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}
    </PageContainer>
  );
}
