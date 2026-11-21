'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { InsightCard } from '@/components/InsightCard';
import { MonthNavigator } from '@/components/MonthNavigator';
import { monthKeys } from '@/lib/utils/dateUtils';
import { SegmentedControl } from '@/components/SegmentedControl';
import { MetricCard, MetricGrid } from '@/components/MetricCard';
import { formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { ExpandableChart } from '@/components/charts/ExpandableChart';
import type { Insight, InsightType } from '@/types';

interface Summary {
  totalNetWorth: number;
  monthGrowth: number;
  monthChange: number;
  windowMonths: number;
  windowStart: number;
  windowChange: number;
  /** Money that crossed into investment accounts over the window, including virtual SIPs. */
  contributed: number;
  /** What markets did to the investment accounts over the window, net of contributions and catch-ups. */
  marketGain: number;
  liabilities: number;
  typeTotals: Record<string, number>;
  insightCount: number;
}

/** Label and icon per insight type, used to build the filter tabs from what is present. */
const TYPE_LABELS: Partial<Record<InsightType, string>> = {
  trend: '📈 Trends',
  projection: '🔭 Projections',
  prediction: '🔮 Predictions',
  performance: '⚖️ Performance',
  diversification: '🌈 Allocation',
  data_quality: '🩺 Data health',
  achievement: '🌟 Achievements',
  pattern: '📊 Patterns',
  anomaly: '⚠️ Anomalies',
};

interface ProjectionData {
  month: string;
  actual?: number;
  projected?: number;
  target?: number;
}

export default function PortfolioInsightsPage() {
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'all' | InsightType>('all');
  // Nothing on this page has ever called lib/ai; the header used to say "AI-powered".
  const [generatedBy, setGeneratedBy] = useState<string>('rules');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [analysisMonth, setAnalysisMonth] = useState<string>('');
  const [projectionData, setProjectionData] = useState<ProjectionData[]>([]);
  const [medianValue, setMedianValue] = useState<number>(0);

  // A rolling year ending at the current month; `MonthNavigator` derives
  // prev/next/jump from these bounds.
  const latestMonth = monthKeys.current();
  const earliestMonth = monthKeys.shift(latestMonth, -11);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMonth) {
        params.append('month', selectedMonth);
      }

      const response = await fetch(`/api/portfolio/insights?${params.toString()}`);
      const data = await response.json();

      console.log('Portfolio insights response:', data);

      if (response.ok) {
        setInsights(data.insights || []);
        setSummary(data.summary);
        setAnalysisMonth(data.analysisMonth || '');
        setGeneratedBy(data.generatedBy || 'rules');
        
        // Fetch report data for projection chart
        const reportResponse = await fetch('/api/portfolio/report?months=12');
        if (reportResponse.ok) {
          const reportData = await reportResponse.json();
          generateProjectionData(reportData, data.summary?.totalNetWorth || 0);
        }
      }
    } catch (err) {
      console.error('Failed to fetch portfolio insights:', err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  const generateProjectionData = (reportData: any, currentNetWorth: number) => {
    if (!reportData?.months?.length || !reportData?.monthlyTotals) {
      return;
    }

    const months = reportData.months;
    const monthlyTotals = reportData.monthlyTotals;

    // Use last 12 months or all available data
    const dataPoints = months.slice(-12);
    const values = dataPoints.map((m: string) => monthlyTotals[m] || 0);

    // Calculate linear regression (y = mx + b)
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((sum: number, v: number) => sum + v, 0);
    const sumXY = values.reduce((sum: number, v: number, i: number) => sum + (i * v), 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Determine next milestone
    let targetAmount: number;
    if (currentNetWorth < 50000000) {
      targetAmount = 50000000; // 5 Crore
    } else if (currentNetWorth < 100000000) {
      targetAmount = 100000000; // 10 Crore
    } else if (currentNetWorth < 500000000) {
      targetAmount = 500000000; // 50 Crore
    } else if (currentNetWorth < 1000000000) {
      targetAmount = 1000000000; // 100 Crore
    } else {
      targetAmount = 5000000000; // 500 Crore
    }

    // Build chart data with historical + projection
    const chartData: ProjectionData[] = [];

    // Add historical data (last 12 months)
    dataPoints.forEach((month: string, i: number) => {
      chartData.push({
        month: format(new Date(month + '-01'), 'MMM yy'),
        actual: monthlyTotals[month] || 0
      });
    });

    // Calculate median of actual values for reference line
    const actualValues = values.filter((v: number) => v > 0).sort((a: number, b: number) => a - b);
    const median = actualValues.length > 0
      ? actualValues.length % 2 === 0
        ? (actualValues[actualValues.length / 2 - 1] + actualValues[actualValues.length / 2]) / 2
        : actualValues[Math.floor(actualValues.length / 2)]
      : 0;

    // Add projection if slope is positive and haven't reached target
    if (slope > 0 && currentNetWorth < targetAmount) {
      const monthsToTarget = Math.ceil((targetAmount - currentNetWorth) / slope);

      // Project until we reach or exceed the target
      for (let i = 1; i <= monthsToTarget + 1; i++) {
        const projectedValue = intercept + slope * (n - 1 + i);
        const projDate = new Date();
        projDate.setMonth(projDate.getMonth() + i);

        // Stop if we've exceeded the target
        if (projectedValue > targetAmount * 1.05) break;

        const isTargetPoint = projectedValue >= targetAmount && !chartData.some(p => p.target);

        chartData.push({
          month: format(projDate, 'MMM yy'),
          projected: isTargetPoint ? targetAmount : projectedValue,
          target: isTargetPoint ? targetAmount : undefined
        });

        // Stop after reaching target
        if (isTargetPoint) break;
      }
    }

    setProjectionData(chartData);
    setMedianValue(median);
  };

  useEffect(() => {
    if (!selectedMonth) {
      setSelectedMonth(latestMonth);
    }
  }, [latestMonth, selectedMonth]);

  useEffect(() => {
    if (selectedMonth) {
      fetchInsights();
    }
  }, [fetchInsights, selectedMonth]);

  const monthNavigation = (
    <MonthNavigator
      value={selectedMonth}
      onChange={setSelectedMonth}
      min={earliestMonth}
      max={latestMonth}
      ariaLabel="Insights month"
    />
  );

  // Say which engine produced this. These insights are entirely rule-based; the page
  // previously advertised "AI-powered analysis", which was never true here.
  const insightsSourceLabel =
    generatedBy === 'ai'
      ? 'AI analysis of portfolio performance and projections'
      : 'Rule-based analysis of balances, contributions and data health';

  if (loading) {
    return <LoadingSpinner message="Analyzing your portfolio..." />;
  }

  if (!summary || insights.length === 0) {
    return (
      <PageContainer maxWidth="7xl">
        <PageHeader
          title="Selvam Insights"
          description={insightsSourceLabel}
        />
        <div className="mb-6">{monthNavigation}</div>
        <EmptyState
          icon="📊"
          title="No Data for This Month"
          description="There are no portfolio snapshots recorded for the selected month. Try selecting a different month or add snapshots to generate insights."
        />
      </PageContainer>
    );
  }

  const filteredInsights = filter === 'all'
    ? insights
    : insights.filter(i => i.type === filter);

  // Built from what the engine actually emitted. The hardcoded list used to offer a
  // "Targets" tab nothing ever produced, while hiding the types that were produced.
  const typeCounts = insights.reduce((acc, i) => {
    acc[i.type] = (acc[i.type] ?? 0) + 1;
    return acc;
  }, {} as Partial<Record<InsightType, number>>);

  const filterOptions = [
    { value: 'all' as const, label: `All (${insights.length})` },
    ...(Object.keys(TYPE_LABELS) as InsightType[])
      .filter((t) => (typeCounts[t] ?? 0) > 0)
      .map((t) => ({ value: t, label: `${TYPE_LABELS[t]} (${typeCounts[t]})` })),
  ];

  const analysisMonthLabel = analysisMonth ? format(new Date(analysisMonth + '-01'), 'MMM yyyy') : '';

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Selvam Insights 💡"
        description={insightsSourceLabel}
      />

      <div className="mb-6">{monthNavigation}</div>

      {/* Summary Cards */}
      <MetricGrid className="md:grid-cols-3 mb-4">
        <MetricCard
          tone="green"
          label={`${analysisMonthLabel || 'Selected Month'} Net Worth`}
          value={formatCurrency(summary.totalNetWorth)}
          subtext="Total portfolio value"
        />
        <MetricCard
          tone="blue"
          label="Month Growth"
          value={`${summary.monthGrowth >= 0 ? '↑' : '↓'} ${Math.abs(summary.monthGrowth).toFixed(2)}%`}
          subtext={`${summary.monthChange >= 0 ? '+' : ''}${formatCurrency(summary.monthChange)} vs previous month`}
        />
        <MetricCard
          tone="purple"
          label={`Market Gain (${summary.windowMonths - 1}mo)`}
          value={formatCurrency(summary.marketGain)}
          // Money added is not performance: gain is what the investment accounts did beyond
          // the contributions and SIPs that went into them.
          subtext={`after ${formatCurrency(summary.contributed)} put into investments`}
        />
      </MetricGrid>

      {/* Projection Chart */}
      {projectionData.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">Growth Projection</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 bg-green-600"></div>
                <span className="text-gray-600">Actual</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 bg-green-600 border-t-2 border-dashed"></div>
                <span className="text-gray-600">Projected</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-amber-500 border-2 border-white"></div>
                <span className="text-gray-600">Target</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 bg-gray-400"></div>
                <span className="text-gray-600">Median</span>
              </div>
            </div>
          </div>
          <ExpandableChart title="Growth Projection" height={280} expandedHeight={560} overlayButton>
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={projectionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value) => `${(value / 100000).toFixed(0)}L`}
                    width={50}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'actual') return [formatCurrency(value), 'Actual'];
                      if (name === 'projected') return [formatCurrency(value), 'Projected'];
                      if (name === 'target') return [formatCurrency(value), 'Target'];
                      return [formatCurrency(value), name];
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
                    dataKey="actual"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#10b981' }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="projected"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 2, fill: '#10b981', strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="target"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={{ r: 5, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6 }}
                  />
                  {medianValue > 0 && (
                    <ReferenceLine
                      y={medianValue}
                      stroke="#9ca3af"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      label={{
                        value: `Median: ${formatCurrency(medianValue)}`,
                        position: 'insideTopRight',
                        fill: '#6b7280',
                        fontSize: 10,
                        fontWeight: 500,
                      }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </ExpandableChart>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="card mb-4 bg-gradient-to-r from-gray-50 to-gray-100">
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          className="flex-wrap"
          ariaLabel="Portfolio insights type filter"
          options={filterOptions}
        />
      </div>

      {/* Insights Grid */}
      {filteredInsights.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="No insights in this category"
          description="Try another insight type filter."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredInsights.map((insight, index) => (
            <InsightCard
              key={`${insight.id}-${index}`}
              icon={insight.icon}
              title={insight.title}
              description={insight.description}
              severity={insight.severity}
              value={insight.value}
              change={insight.change}
              action={insight.action}
            />
          ))}
        </div>
      )}

      {/* Info Footer */}
      <div className="card bg-blue-50 border border-blue-200 mt-4">
        <p className="text-sm text-blue-800">
          💡 Growth is split into money you added, debt repaid and valuation change — only the last is
          performance. Projections state their assumptions; they are not forecasts of markets.
        </p>
        <Link href="/annual-review" className="btn btn-link btn-sm mt-2 px-0">
          Open the twelve-month review →
        </Link>
      </div>
    </PageContainer>
  );
}
