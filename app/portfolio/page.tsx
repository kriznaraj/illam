'use client';

import { useMemo, useState, useEffect } from 'react';
import { formatCurrency, formatCompactCurrency, formatMonth } from '@/lib/utils';
import Link from 'next/link';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';
import { useAccountTypes } from '@/lib/useAccountTypes';
import { ExpandableChart } from '@/components/charts/ExpandableChart';
import { usePortfolioDashboardData } from '@/lib/hooks/usePortfolioDashboardData';
import { computeScopedPortfolioData } from '@/lib/portfolio/dashboardCalculations';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Briefcase, TriangleAlert } from 'lucide-react';


export default function PortfolioDashboard() {
  const { types, typeColors, typeIds } = useAccountTypes();
  const { loading, error, errorKind, rawAccounts, rawSnapshots, rawReport, refetch } = usePortfolioDashboardData();
  const [scope, setScope] = useState<'all' | 'equity'>(() => {
    if (typeof window === 'undefined') return 'all';
    const v = window.localStorage.getItem('portfolio_scope');
    return v === 'equity' ? 'equity' : 'all';
  });
  const [isMobile, setIsMobile] = useState(false);
  const [showAmounts, setShowAmounts] = useState(false);
  const equityTypeSet = useMemo(() => new Set(types.filter((type) => type.is_equity).map((type) => type.name)), [types]);

  useEffect(() => {
    try {
      window.localStorage.setItem('portfolio_scope', scope);
    } catch {}
  }, [scope]);
  const {
    accounts,
    typeSummaries,
    totalNetWorth,
    growthMetrics,
    portfolioTrend,
    medianNetWorth,
  } = useMemo(() => {
    if (!rawAccounts || !rawSnapshots) {
      return {
        accounts: [],
        snapshots: [],
        typeSummaries: [],
        totalNetWorth: 0,
        growthMetrics: { mom: 0, ytd: 0, yoy: 0 },
        portfolioTrend: [],
        medianNetWorth: 0,
      };
    }

    return computeScopedPortfolioData({
      accountsData: rawAccounts,
      snapshotsData: rawSnapshots,
      reportData: rawReport,
      scope,
      equityTypeSet,
    });
  }, [equityTypeSet, rawAccounts, rawReport, rawSnapshots, scope]);

  // Shares below are of gross assets, so the denominator must exclude what is owed.
  // typeSummaries totals are signed: liabilities are negative (migration 028).
  const grossAssets = typeSummaries.reduce((sum, t) => sum + Math.max(t.total, 0), 0);
  const grossDebt = typeSummaries.reduce((sum, t) => sum + Math.max(-t.total, 0), 0);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);


  if (loading) {
    return <LoadingSpinner message="Loading portfolio..." />;
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="card border-red-200 bg-red-50">
          <h2 className="flex items-center gap-2 text-xl font-bold text-red-900 mb-4">
            <TriangleAlert size={20} className="flex-shrink-0" aria-hidden />
            {errorKind === 'setup' ? 'Portfolio Setup Required' : 'Portfolio Load Failed'}
          </h2>
          <p className="text-red-800 mb-4">{error}</p>
          {errorKind === 'setup' ? (
            <div className="bg-white p-4 rounded border border-red-200">
              <p className="text-sm font-medium text-gray-900 mb-2">To set up the portfolio tracker:</p>
              <ol className="list-decimal list-inside text-sm text-gray-700 space-y-2">
                <li>Open your Supabase Dashboard</li>
                <li>Go to SQL Editor</li>
                <li>Run the migration file: <code className="bg-gray-100 px-2 py-1 rounded">supabase/migrations/005_create_portfolio_tables.sql</code></li>
                <li>Refresh this page</li>
              </ol>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void refetch()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition"
              >
                Retry
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 transition"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Empty state
  if (!loading && accounts.length === 0) {
    return (
      <PageContainer maxWidth="7xl">
        <EmptyState
          icon={Briefcase}
          title="No accounts yet"
          description="Start tracking your investments, savings, and assets by adding your first account."
          action={{
            label: "Add Your First Account",
            onClick: () => window.location.href = "/portfolio/settings",
            variant: "success"
          }}
        />
      </PageContainer>
    );
  }

  const displayAmount = (val: number) =>
    showAmounts ? formatCurrency(val) : '₹ ••••••';

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Net worth"
        action={
          <SegmentedControl
            value={scope}
            onChange={setScope}
            ariaLabel="Portfolio scope"
            options={[
              { value: 'all', label: 'All', title: 'Show all account types' },
              { value: 'equity', label: 'Equity', title: 'Show only equity types' },
            ]}
          />
        }
      />

      {/* Net Worth Summary */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm text-gray-500">
            {scope === 'equity' ? 'Total equity' : 'Total net worth'}
          </div>
          <button
            onClick={() => setShowAmounts(v => !v)}
            className="icon-button-sm -mr-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            aria-label={showAmounts ? 'Hide amounts' : 'Show amounts'}
          >
            {showAmounts ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            )}
          </button>
        </div>
        <div className="text-3xl font-semibold tabular-nums mb-4">{displayAmount(totalNetWorth)}</div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-500">Month</div>
            <div className="font-semibold tabular-nums">
              {growthMetrics.mom >= 0 ? '↑' : '↓'} {Math.abs(growthMetrics.mom).toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">YTD</div>
            <div className="font-semibold tabular-nums">
              {growthMetrics.ytd >= 0 ? '↑' : '↓'} {Math.abs(growthMetrics.ytd).toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">YOY</div>
            <div className="font-semibold tabular-nums">
              {growthMetrics.yoy >= 0 ? '↑' : '↓'} {Math.abs(growthMetrics.yoy).toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      {/* Portfolio Growth Chart */}
      {portfolioTrend.length > 0 && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">Net worth over time</h2>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 bg-green-600"></div>
                <span className="text-gray-600">Actual</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 bg-primary-500"></div>
                <span className="text-gray-600">6M Avg</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 bg-gray-400"></div>
                <span className="text-gray-600">Median</span>
              </div>
            </div>
          </div>
          <ExpandableChart title="Net worth over time" height={220} expandedHeight={560} overlayButton>
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={portfolioTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                    interval={isMobile ? Math.floor(portfolioTrend.length / 4) : 'preserveStartEnd'}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value) => showAmounts ? `${(value / 100000).toFixed(0)}L` : '••••'}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'value') return [showAmounts ? formatCurrency(value) : '₹ ••••••', 'Net Worth'];
                      if (name === 'movingAvg') return [showAmounts ? formatCurrency(value) : '₹ ••••••', '6M Avg'];
                      return [showAmounts ? formatCurrency(value) : '₹ ••••••', name];
                    }}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#10b981' }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="movingAvg"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                  {medianNetWorth > 0 && (
                    <ReferenceLine
                      y={medianNetWorth}
                      stroke="#9ca3af"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      label={showAmounts ? {
                        value: `Median: ${formatCurrency(medianNetWorth)}`,
                        position: 'insideTopRight',
                        fill: '#6b7280',
                        fontSize: 10,
                        fontWeight: 500,
                      } : undefined}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </ExpandableChart>
        </div>
      )}


      {/* Summary by Type */}
      <div className="card mb-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-base font-bold text-gray-900">Summary by Type</h2>
          {/* Names the denominator the shares below are computed against. */}
          <p className="text-xs text-gray-500">
            {showAmounts ? formatCompactCurrency(grossAssets) : '₹ ••••••'} of assets
            {grossDebt > 0 && (
              <span className="text-red-600">
                {' · '}
                {showAmounts ? formatCompactCurrency(grossDebt) : '₹ ••••••'} owed
              </span>
            )}
          </p>
        </div>
        <div className="space-y-2">
          {typeSummaries.map((summary) => (
            <Link
              key={summary.type}
              href={typeIds[summary.type] ? `/portfolio/types/${typeIds[summary.type]}` : `/portfolio/types/${encodeURIComponent(summary.type)}`}
              className="flex items-center justify-between py-3 px-3 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-2 flex-1">
                <div
                  className="w-4 h-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: typeColors[summary.type] || '#6b7280' }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{summary.type}</p>
                  <p className="text-xs text-gray-500">{summary.accounts.length} accounts</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <p className={`text-sm font-bold ${summary.total < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {showAmounts ? formatCompactCurrency(summary.total) : '₹ ••••••'}
                </p>
                {summary.diff != null && Math.abs(summary.diff) > 0.01 && (
                  <p className={`text-xs font-semibold ${summary.diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {summary.diff > 0 ? '▲' : '▼'}{' '}
                    {showAmounts ? formatCompactCurrency(Math.abs(summary.diff)) : '••••'}
                  </p>
                )}
                {/*
                  Share of GROSS ASSETS, not of net worth. Dividing |type total| by net
                  worth counted a debt as a positive holding — the Loan showed as "19.6%",
                  ranked between Long Term and Mutual Funds — and mixed a gross numerator
                  with a net denominator, so the column summed to about 140%. Asset shares
                  now sum to 100% and a liability carries a minus, matching the gross-asset
                  basis /portfolio/insights already reports.
                */}
                {grossAssets > 0 && (
                  <p className={`text-xs ${summary.total < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                    {summary.total < 0 ? '−' : ''}
                    {((Math.abs(summary.total) / grossAssets) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
