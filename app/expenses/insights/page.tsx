'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
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
import type { Insight, InsightType } from '@/types';

interface Summary {
  totalSpent: number;
  transactionCount: number;
  avgTransaction: number;
  topCategory: string;
  topCategoryAmount: number;
  /** Need + Want + Unplanned. The figure every rule reasons about. */
  recurringSpent?: number;
  /** One-time projects, reported separately so they cannot pose as overspending. */
  oneTimeSpent?: number;
  baselineMonths?: number;
  excludedMonths?: string[];
  insightCount: number;
}

/** Filter tabs are built from the types actually present, not a hardcoded list. */
const TYPE_LABELS: Partial<Record<InsightType, string>> = {
  data_quality: '🩺 Data health',
  anomaly: '⚠️ Anomalies',
  trend: '📈 Trends',
  prediction: '🔮 Predictions',
  pattern: '📊 Patterns',
  achievement: '🌟 Verdict',
};

export default function InsightsPage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'all' | InsightType>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>(''); // Format: YYYY-MM
  const [analysisMonth, setAnalysisMonth] = useState<string>(''); // The month being analyzed
  const [isCached, setIsCached] = useState(false);
  // 'ai' | 'rules' | 'unknown' — the page used to claim "AI-powered" even when the
  // rule-based engine produced the output.
  const [generatedBy, setGeneratedBy] = useState<string>('unknown');
  const [regenerating, setRegenerating] = useState(false);

  // Say which engine actually produced these. When no AI key is configured the app falls
  // back to a rule-based engine, and previously that was presented as "AI-powered analysis".
  const insightsSourceLabel =
    generatedBy === 'ai'
      ? "AI analysis of closed months' spending patterns"
      : generatedBy === 'rules'
        ? "Rule-based analysis of closed months' spending patterns"
        : "Analysis of closed months' spending patterns";

  // Insights only cover closed months, so the range ends at last month and
  // reaches back a year. `MonthNavigator` derives prev/next/jump from these.
  const latestClosedMonth = monthKeys.shift(monthKeys.current(), -1);
  const earliestMonth = monthKeys.shift(latestClosedMonth, -11);

  const fetchInsights = useCallback(async (force = false) => {
    setLoading(true);
    if (force) setRegenerating(true);
    try {
      const params = new URLSearchParams();
      if (currentUser?.id) {
        params.append('userId', currentUser.id);
      }
      if (selectedMonth) {
        params.append('month', selectedMonth);
      }
      if (force) {
        params.append('force', 'true');
      }

      const response = await fetch(`/api/insights?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setInsights(data.insights || []);
        setSummary(data.summary);
        setAnalysisMonth(data.analysisMonth || '');
        setIsCached(data.cached || false);
        setGeneratedBy(data.generatedBy ?? 'unknown');
      }
    } catch (err) {
      console.error('Failed to fetch insights:', err);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, [currentUser?.id, selectedMonth]);

  const handleRegenerate = async () => {
    // Clear cache first, then regenerate
    try {
      await fetch('/api/insights/clear-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth })
      });
    } catch (err) {
      console.error('Failed to clear cache:', err);
    }
    
    fetchInsights(true);
  };

  useEffect(() => {
    // Default to last closed month (previous month)
    if (!selectedMonth) {
      setSelectedMonth(latestClosedMonth);
    }
  }, [latestClosedMonth, selectedMonth]);

  useEffect(() => {
    if (selectedMonth && currentUser) {
      fetchInsights();
    }
  }, [currentUser, selectedMonth, fetchInsights]);


  const monthNavigation = (
    <MonthNavigator
      value={selectedMonth}
      onChange={setSelectedMonth}
      min={earliestMonth}
      max={latestClosedMonth}
      ariaLabel="Insights month"
    />
  );

  if (loading) {
    return <LoadingSpinner message="Analyzing your spending patterns..." />;
  }

  if (!summary || insights.length === 0) {
    return (
      <PageContainer maxWidth="7xl">
        <PageHeader
          title="Smart Insights"
          description={insightsSourceLabel}
          action={
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="btn btn-ghost text-sm"
              title="Regenerate insights"
            >
              {regenerating ? '⏳' : '🔄'}
            </button>
          }
        />
        <div className="mb-6">{monthNavigation}</div>
        <EmptyState
          icon="🔍"
          title="No Data for This Month"
          description="There are no expenses recorded for the selected month. Try selecting a different month or add expenses to generate insights."
        />
      </PageContainer>
    );
  }

  const filteredInsights = filter === 'all'
    ? insights
    : insights.filter(i => i.type === filter);

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
        title="Smart Insights 💡"
        description={insightsSourceLabel}
        action={
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="btn btn-ghost text-sm"
            title="Regenerate insights"
          >
            {regenerating ? '⏳' : '🔄'}
          </button>
        }
      />

      <div className="mb-6">{monthNavigation}</div>

      {/* Summary Cards */}
      <MetricGrid className="md:grid-cols-3 mb-4">
        <MetricCard
          tone="blue"
          label={analysisMonthLabel || 'Selected Month'}
          value={formatCurrency(summary.totalSpent)}
          subtext={`${summary.transactionCount} transactions`}
        />
        <MetricCard
          tone="purple"
          label="Running Costs"
          value={formatCurrency(summary.recurringSpent ?? summary.totalSpent)}
          // The split every rule is built on: one-time projects are judged separately,
          // so a renovation month cannot read as overspending.
          subtext={
            summary.oneTimeSpent
              ? `+ ${formatCurrency(summary.oneTimeSpent)} one-time`
              : 'Need + Want + Unplanned'
          }
        />
        <MetricCard
          tone="green"
          label="Top Category"
          value={<span className="block truncate">{summary.topCategory}</span>}
          subtext={formatCurrency(summary.topCategoryAmount)}
        />
      </MetricGrid>

      {/* Filter Tabs */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 bg-gradient-to-r from-gray-50 to-gray-100">
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          className="flex-wrap"
          ariaLabel="Insights type filter"
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
          {filteredInsights.map((insight) => (
            <InsightCard
              key={insight.id}
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
      <div className="bg-white rounded-xl shadow-sm p-4 bg-blue-50 border border-blue-200 mt-4">
        <p className="text-sm text-blue-800">
          💡 Running costs (Need, Want, Unplanned) are judged against a trimmed baseline of recent
          complete months; one-time projects are reported separately so a renovation cannot read as
          overspending. Small-rupee moves are suppressed however large the percentage.
        </p>
        <Link href="/annual-review" className="btn btn-link btn-sm mt-2 px-0">
          Open the twelve-month review →
        </Link>
      </div>
    </PageContainer>
  );
}
