'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { InsightCard } from '@/components/InsightCard';
import { MetricCard, MetricGrid } from '@/components/MetricCard';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ExpandableChart } from '@/components/charts/ExpandableChart';
import { formatCurrency } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Insight } from '@/types';
import { TrendingDown } from 'lucide-react';

interface MonthlyExpense {
  month: string;
  label: string;
  total: number;
  recurring: number;
  oneTime: number;
  count: number;
  byGroup: Record<string, number>;
  lowConfidence: boolean;
}

interface CategoryRow {
  categoryId: string;
  name: string;
  groupName: string;
  total: number;
  count: number;
  activeMonths: number;
  perActiveMonth: number;
}

interface Review {
  window: { startMonth: string; endMonth: string; months: string[] };
  selavu: {
    monthly: MonthlyExpense[];
    categories: CategoryRow[];
    baseline: number;
    forecast: {
      nextMonthLow: number;
      nextMonthMid: number;
      nextMonthHigh: number;
      fyStartYear: number;
      fyMonthsElapsed: number;
      fyRecurring: number;
      fyOneTime: number;
      fyPerMonth: number;
      fyProjectedRecurring: number;
    };
    totals: { total: number; recurring: number; oneTime: number; count: number; oneTimeShare: number };
    insights: Insight[];
  };
  selvam: {
    monthly: Array<{ month: string; netWorth: number; contributed: number; byType: Record<string, number> }>;
    typeTotals: Record<string, number>;
    decomposition: {
      start: number;
      end: number;
      change: number;
      /** Money that crossed into investment accounts. Part of `saved`, not on top of it. */
      contributed: number;
      catchUp: number;
      /** change = valuation + catchUp + saved + signArtefact */
      saved: number;
      debtRepaid: number;
      signArtefact: number;
      /** Market gain on the investment accounts. */
      valuation: number;
      months: number;
      liabilities: number;
    };
    projection: { low: number; high: number; monthlySaved: number };
    insights: Insight[];
  };
  dataHealth: Insight[];
  generatedAt: string;
}

/** Planning groups in the order they should read: essentials first, discretion last. */
const GROUP_ORDER = ['Need', 'Want', 'Unplanned', 'One-time', 'Unknown'];
const GROUP_COLORS: Record<string, string> = {
  Need: '#2563eb',
  Want: '#f59e0b',
  Unplanned: '#dc2626',
  'One-time': '#7c3aed',
  Unknown: '#9ca3af',
};

const shortMonth = (key: string) => format(parseISO(`${key}-01`), 'MMM yy');

/** ₹2,36,14,700 → "₹2.36Cr". Axis and card labels only. */
function short(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}₹${Math.round(abs / 1_000)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

export default function AnnualReviewPage() {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [module, setModule] = useState<'selavu' | 'selvam'>('selavu');

  // Loads once on mount; `loading` starts true, so there is nothing to reset first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/annual-review');
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? 'Failed to load review');
        if (cancelled) return;
        setReview(data);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load review');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const expenseChartData = useMemo(
    () =>
      (review?.selavu.monthly ?? []).map((m) => ({
        month: shortMonth(m.month),
        ...GROUP_ORDER.reduce((acc, g) => ({ ...acc, [g]: m.byGroup[g] ?? 0 }), {}),
        lowConfidence: m.lowConfidence,
      })),
    [review]
  );

  const netWorthChartData = useMemo(
    () =>
      (review?.selvam.monthly ?? []).map((m) => ({
        month: shortMonth(m.month),
        netWorth: Math.round(m.netWorth),
        contributed: Math.round(m.contributed),
      })),
    [review]
  );

  if (loading) return <LoadingSpinner message="Reading the last twelve months..." />;

  if (error || !review) {
    return (
      <PageContainer maxWidth="7xl">
        <PageHeader title="Annual review" />
        <EmptyState icon={TrendingDown} title="Could not build the review" description={error ?? 'No data available.'} />
      </PageContainer>
    );
  }

  const { selavu, selvam, dataHealth, window: win } = review;
  const d = selvam.decomposition;

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Annual review"
        description={`${shortMonth(win.startMonth)} – ${shortMonth(win.endMonth)} · every figure computed from the live database, rule-based, no AI`}
      />

      {/* Data health first: everything below is computed on these numbers. */}
      {dataHealth.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Read this first</h2>
          <p className="text-sm text-gray-600 mb-3">
            Problems in the underlying records. Every number on this page is computed on top of them.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {dataHealth.map((insight) => (
              <InsightCard
                key={insight.id}
                icon={insight.icon}
                type={insight.type}
                title={insight.title}
                description={insight.description}
                severity={insight.severity}
                value={insight.value}
                change={insight.change}
                action={insight.action}
              />
            ))}
          </div>
        </section>
      )}

      <div className="card mb-6 bg-gray-50">
        <SegmentedControl
          value={module}
          onChange={setModule}
          ariaLabel="Module"
          options={[
            { value: 'selavu', label: 'Spending' },
            { value: 'selvam', label: 'Net worth' },
          ]}
        />
      </div>

      {module === 'selavu' ? (
        <>
          <MetricGrid className="md:grid-cols-4 mb-4">
            <MetricCard
              tone="primary"
              label="Running costs (12mo)"
              value={short(selavu.totals.recurring)}
              subtext={`${formatCurrency(selavu.baseline)} a month, typical`}
            />
            <MetricCard
              tone="purple"
              label="One-time projects"
              value={short(selavu.totals.oneTime)}
              subtext={`${(selavu.totals.oneTimeShare * 100).toFixed(0)}% of everything spent`}
            />
            <MetricCard
              tone="green"
              label="Next month, expected"
              value={short(selavu.forecast.nextMonthMid)}
              subtext={`${short(selavu.forecast.nextMonthLow)} – ${short(selavu.forecast.nextMonthHigh)}`}
            />
            <MetricCard
              tone="orange"
              label={`FY${String(selavu.forecast.fyStartYear + 1).slice(2)} projected`}
              value={short(selavu.forecast.fyProjectedRecurring)}
              subtext={`${short(selavu.forecast.fyRecurring)} in ${selavu.forecast.fyMonthsElapsed} months so far`}
            />
          </MetricGrid>

          <div className="card mb-4">
            <ExpandableChart title="Spending by planning group" height={320} overlayButton={false}>
              {() => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={expenseChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={short} tick={{ fontSize: 11 }} width={56} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend />
                    {GROUP_ORDER.map((group) => (
                      <Bar key={group} dataKey={group} stackId="spend" fill={GROUP_COLORS[group]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ExpandableChart>
          </div>

          <div className="card mb-4 overflow-x-auto">
            <h3 className="font-bold text-gray-900 mb-3">Month by month</h3>
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Month</th>
                  <th className="py-2 px-3 font-medium text-right">Running</th>
                  <th className="py-2 px-3 font-medium text-right">One-time</th>
                  <th className="py-2 px-3 font-medium text-right">Total</th>
                  <th className="py-2 px-3 font-medium text-right">Entries</th>
                  <th className="py-2 pl-3 font-medium">vs baseline</th>
                </tr>
              </thead>
              <tbody>
                {selavu.monthly.map((m) => {
                  const delta = selavu.baseline > 0 ? m.recurring - selavu.baseline : 0;
                  return (
                    <tr key={m.month} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {shortMonth(m.month)}
                        {m.lowConfidence && (
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                            under-logged
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(m.recurring)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-purple-700">
                        {m.oneTime > 0 ? formatCurrency(m.oneTime) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium">{formatCurrency(m.total)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-500">{m.count}</td>
                      <td className="py-2 pl-3 whitespace-nowrap">
                        {/* Blank for months whose record is too thin to compare. */}
                        {m.lowConfidence || selavu.baseline <= 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className={delta > 0 ? 'text-red-600' : 'text-green-600'}>
                            {delta > 0 ? '+' : ''}
                            {short(delta)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card mb-4 overflow-x-auto">
            <h3 className="font-bold text-gray-900 mb-1">What the money went on</h3>
            <p className="text-sm text-gray-600 mb-3">
              Cost per month a category was actually active — the figure to budget against.
            </p>
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 px-3 font-medium">Group</th>
                  <th className="py-2 px-3 font-medium text-right">12-month total</th>
                  <th className="py-2 px-3 font-medium text-right">Active</th>
                  <th className="py-2 pl-3 font-medium text-right">Per active month</th>
                </tr>
              </thead>
              <tbody>
                {selavu.categories.slice(0, 15).map((c) => (
                  <tr key={c.categoryId} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3">{c.name}</td>
                    <td className="py-2 px-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: GROUP_COLORS[c.groupName] ?? GROUP_COLORS.Unknown }}
                      >
                        {c.groupName}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(c.total)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-500">{c.activeMonths} mo</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-medium">
                      {formatCurrency(c.perActiveMonth)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="font-bold text-gray-900 mb-3">This month&apos;s findings</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {selavu.insights.map((insight) => (
              <InsightCard
                key={insight.id}
                icon={insight.icon}
                type={insight.type}
                title={insight.title}
                description={insight.description}
                severity={insight.severity}
                value={insight.value}
                change={insight.change}
                action={insight.action}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <MetricGrid className="md:grid-cols-4 mb-4">
            <MetricCard tone="green" label="Net worth" value={short(d.end)} subtext={`from ${short(d.start)} a year ago`} />
            <MetricCard
              tone="primary"
              label="Put into investments"
              value={short(d.contributed)}
              subtext="contributions and SIPs"
            />
            <MetricCard
              tone="purple"
              label="Valuation change"
              value={short(d.valuation)}
              subtext="what markets did to the investments"
            />
            <MetricCard tone="orange" label="Owed" value={short(d.liabilities)} subtext={`${short(d.debtRepaid)} repaid this year`} />
          </MetricGrid>

          {/*
            The decomposition is the point of this page: a rise in net worth is not a
            return. The rows add up to the change. Saving already contains the money put
            into investments — a transfer from a bank account is a contribution and an
            equal fall in cash, so it is counted once, and never as performance.
          */}
          <div className="card mb-4">
            <h3 className="font-bold text-gray-900 mb-1">Where the {short(d.change)} came from</h3>
            <p className="text-sm text-gray-600 mb-4">
              Over {d.months} months. Only valuation change is performance.
            </p>
            <div className="space-y-2">
              {[
                {
                  label: 'Saving',
                  value: d.saved,
                  tone: 'bg-primary-500',
                  note: `${short(d.contributed)} into investments · ${short(d.debtRepaid)} loan repaid · cash the rest`,
                },
                ...(d.catchUp !== 0
                  ? [{ label: 'Catch-up', value: d.catchUp, tone: 'bg-amber-500', note: 'frozen balances finally updated' }]
                  : []),
                ...(d.signArtefact > 0
                  ? [
                      {
                        label: 'Credit-card sign error',
                        value: d.signArtefact,
                        tone: 'bg-red-500',
                        note: 'not real money — see Read this first',
                      },
                    ]
                  : []),
                { label: 'Valuation change', value: d.valuation, tone: 'bg-purple-500', note: 'markets' },
              ].map((part) => (
                <div key={part.label} className="flex items-center gap-3">
                  <div className="w-40 sm:w-56 text-sm text-gray-700 flex-shrink-0">
                    {part.label}
                    <span className="block text-xs text-gray-400">{part.note}</span>
                  </div>
                  <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full ${part.tone}`}
                      style={{
                        width: `${Math.min(100, Math.abs(d.change) > 0 ? (Math.abs(part.value) / Math.abs(d.change)) * 100 : 0)}%`,
                      }}
                    />
                  </div>
                  <div className="w-24 text-right text-sm font-medium tabular-nums">{short(part.value)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card mb-4">
            <ExpandableChart title="Net worth and monthly contributions" height={320} overlayButton={false}>
              {() => (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={netWorthChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tickFormatter={short} tick={{ fontSize: 11 }} width={60} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={short} tick={{ fontSize: 11 }} width={56} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend />
                    <Bar yAxisId="right" dataKey="contributed" name="Paid in" fill="#93c5fd" />
                    <Line yAxisId="left" type="monotone" dataKey="netWorth" name="Net worth" stroke="#16a34a" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </ExpandableChart>
          </div>

          <div className="card mb-4 bg-primary-50 border border-primary-200">
            <h3 className="font-bold text-primary-900 mb-1">Twelve months out</h3>
            <p className="text-sm text-primary-900">
              {short(selvam.projection.low)} – {short(selvam.projection.high)}. The lower bound is your recent{' '}
              {formatCurrency(selvam.projection.monthlySaved)} a month of new saving with zero market
              return; the upper is a straight-line extension of the last twelve months. Neither is a forecast of
              markets.
            </p>
          </div>

          <h3 className="font-bold text-gray-900 mb-3">This month&apos;s findings</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {selvam.insights.map((insight) => (
              <InsightCard
                key={insight.id}
                icon={insight.icon}
                type={insight.type}
                title={insight.title}
                description={insight.description}
                severity={insight.severity}
                value={insight.value}
                change={insight.change}
                action={insight.action}
              />
            ))}
          </div>
        </>
      )}
    </PageContainer>
  );
}
