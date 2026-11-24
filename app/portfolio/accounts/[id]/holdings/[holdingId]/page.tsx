'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { formatCurrency, formatCompactCurrency, formatMonth } from '@/lib/utils';
import { useAccountTypes } from '@/lib/useAccountTypes';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { ExpandableChart } from '@/components/charts/ExpandableChart';

interface Holding {
  id: string;
  name: string;
  symbol: string | null;
  identifier: string;
  instrument_type: string;
  quantity_unit: string | null;
  account_id: string;
  account?: { id: string; name: string; type: string };
}

interface SnapshotRow {
  id: string;
  snapshot_date: string;
  quantity: number;
  unit_amount: number | null;
  amount: number;
}

export default function HoldingDetailsPage() {
  const params = useParams();
  const accountId = params?.id as string | undefined;
  const holdingId = params?.holdingId as string | undefined;
  const { typeIds } = useAccountTypes();

  const [holding, setHolding] = useState<Holding | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Show the spinner again when the holding changes (set during render, not in the effect).
  const [loadingFor, setLoadingFor] = useState(holdingId);
  if (holdingId !== loadingFor) {
    setLoadingFor(holdingId);
    setLoading(true);
  }

  useEffect(() => {
    if (!holdingId) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/portfolio/holdings?id=${holdingId}`).then((r) => r.json()),
      fetch(`/api/portfolio/holding-snapshots?holdingId=${holdingId}&limit=500`).then((r) => r.json()),
    ])
      .then(([holdingData, snapData]) => {
        if (cancelled) return;
        setHolding(holdingData?.id ? holdingData : null);
        setSnapshots(Array.isArray(snapData) ? snapData : []);
      })
      .catch(() => {
        if (!cancelled) {
          setHolding(null);
          setSnapshots([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [holdingId]);

  if (!accountId || !holdingId) {
    return (
      <PageContainer>
        <PageHeader title="Holding" />
        <p className="text-gray-600">Invalid link.</p>
        <Link href="/portfolio" className="text-indigo-600 hover:underline mt-2 inline-block">
          ← Portfolio
        </Link>
      </PageContainer>
    );
  }

  if (loading && !holding) {
    return (
      <PageContainer>
        <LoadingSpinner message="Loading holding…" />
      </PageContainer>
    );
  }

  if (!holding) {
    return (
      <PageContainer>
        <PageHeader title="Holding" />
        <p className="text-gray-600">Holding not found.</p>
        <Link href={`/portfolio/accounts/${accountId}`} className="text-indigo-600 hover:underline mt-2 inline-block">
          ← Back to account
        </Link>
      </PageContainer>
    );
  }

  const account = holding.account;
  const sortedSnapshots = [...snapshots].sort(
    (a, b) => b.snapshot_date.localeCompare(a.snapshot_date)
  );
  const latest = sortedSnapshots[0] ?? null;
  const previous = sortedSnapshots[1] ?? null;

  const latestValueChange = latest && previous ? latest.amount - previous.amount : null;
  const latestValueChangePct =
    latestValueChange !== null && previous && previous.amount !== 0
      ? (latestValueChange / Math.abs(previous.amount)) * 100
      : null;

  const trendData = (() => {
    const byMonth: Record<string, number> = {};
    snapshots.forEach((s) => {
      const month = format(new Date(s.snapshot_date), 'yyyy-MM');
      byMonth[month] = Number(s.amount);
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month]) => ({
        month: formatMonth(month + '-01'),
        value: byMonth[month],
      }));
  })();

  return (
    <PageContainer maxWidth="7xl">
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        {/* Mobile: single back link to account */}
        <Link
          href={`/portfolio/accounts/${accountId}`}
          className="flex items-center gap-1 hover:text-gray-700 sm:hidden min-w-0"
        >
          <span aria-hidden className="flex-shrink-0">←</span>
          <span className="truncate max-w-[180px]">{account?.name ?? 'Account'}</span>
        </Link>

        {/* Desktop: full trail, holding name truncated */}
        <Link href="/portfolio" className="hover:text-gray-700 hidden sm:inline flex-shrink-0">Portfolio</Link>
        {account && (
          <>
            <span aria-hidden className="hidden sm:inline flex-shrink-0">/</span>
            <Link
              href={typeIds[account.type] ? `/portfolio/types/${typeIds[account.type]}` : `/portfolio/types/${encodeURIComponent(account.type)}`}
              className="hover:text-gray-700 hidden sm:inline flex-shrink-0"
            >
              {account.type}
            </Link>
          </>
        )}
        <span aria-hidden className="hidden sm:inline flex-shrink-0">/</span>
        <Link href={`/portfolio/accounts/${accountId}`} className="hover:text-gray-700 hidden sm:inline flex-shrink-0 max-w-[120px] truncate">
          {account?.name ?? 'Account'}
        </Link>
        <span aria-hidden className="hidden sm:inline flex-shrink-0">/</span>
        <span className="text-gray-900 font-medium hidden sm:inline truncate max-w-[220px]" title={holding.name}>
          {holding.name}
        </span>

        <span className="flex-1" />
        <Link
          href={`/portfolio/settings/accounts/${accountId}/holdings/${holdingId}`}
          className="text-gray-500 hover:text-gray-700 flex-shrink-0 text-xs"
        >
          Manage
        </Link>
      </nav>

      <PageHeader
        title={holding.name}
        description={
          [
            holding.symbol && `Symbol: ${holding.symbol}`,
            holding.instrument_type !== 'manual' && holding.instrument_type,
            holding.quantity_unit && holding.quantity_unit,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />

      {/* Instrument details */}
      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Instrument</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Name</dt>
            <dd className="font-medium text-gray-900">{holding.name}</dd>
          </div>
          {holding.symbol && (
            <div>
              <dt className="text-gray-500">Symbol</dt>
              <dd className="font-medium text-gray-900">{holding.symbol}</dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Identifier</dt>
            <dd className="font-medium text-gray-900">{holding.identifier}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Price source</dt>
            <dd className="font-medium text-gray-900">{holding.instrument_type}</dd>
          </div>
          {holding.quantity_unit && (
            <div>
              <dt className="text-gray-500">Quantity unit</dt>
              <dd className="font-medium text-gray-900">{holding.quantity_unit}</dd>
            </div>
          )}
          {account && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Account</dt>
              <dd className="font-medium text-gray-900">
                <Link href={`/portfolio/accounts/${accountId}`} className="text-indigo-600 hover:underline">
                  {account.name}
                </Link>
                <span className="text-gray-500 font-normal ml-1">({account.type})</span>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Latest snapshot summary */}
      {latest ? (
        <div className="card mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-1">Current value</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(latest.amount)}</p>
              {latestValueChange !== null && latestValueChangePct !== null && (
                <p className={`text-sm mt-1 ${latestValueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {latestValueChange >= 0 ? '↑' : '↓'}{' '}
                  {formatCurrency(Math.abs(latestValueChange))}
                  {' '}({Math.abs(latestValueChangePct).toFixed(1)}%)
                  <span className="text-gray-400 ml-1">vs prev snapshot</span>
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                As of{' '}
                {new Date(latest.snapshot_date).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
            <div className="text-right space-y-3">
              <div>
                <p className="text-xs text-gray-500">Quantity</p>
                <p className="text-sm font-semibold text-gray-900">
                  {Number(latest.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                  {holding.quantity_unit && (
                    <span className="text-gray-400 font-normal ml-1 text-xs">{holding.quantity_unit}</span>
                  )}
                </p>
              </div>
              {latest.unit_amount != null && (
                <div>
                  <p className="text-xs text-gray-500">Unit price</p>
                  <p className="text-sm font-semibold text-gray-900">{formatCurrency(latest.unit_amount)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Value trend chart */}
      {trendData.length > 1 && (
        <div className="card mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Value trend</h3>
          <ExpandableChart title={`Value trend — ${holding.name}`} height={180} expandedHeight={560} overlayButton>
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    angle={-45}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) =>
                      v >= 100000
                        ? `${(v / 100000).toFixed(1)}L`
                        : v >= 1000
                        ? `${(v / 1000).toFixed(0)}K`
                        : String(v)
                    }
                    width={42}
                  />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), 'Value']}
                    contentStyle={{
                      backgroundColor: 'rgba(255,255,255,0.95)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ExpandableChart>
        </div>
      )}

      {/* Snapshot history */}
      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Snapshot history
          {sortedSnapshots.length > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-400 normal-case">
              {sortedSnapshots.length} {sortedSnapshots.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </h2>
        {sortedSnapshots.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">
            No snapshots yet. Import a CDSL statement or add snapshots from the account page.
          </p>
        ) : (
          <div className="space-y-2">
            {sortedSnapshots.map((s, idx) => {
              const prev = sortedSnapshots[idx + 1];
              const valueChange = prev ? s.amount - prev.amount : null;
              const valueChangePct =
                valueChange !== null && prev && prev.amount !== 0
                  ? (valueChange / Math.abs(prev.amount)) * 100
                  : null;
              const qtyChange =
                prev && s.quantity !== prev.quantity ? s.quantity - prev.quantity : null;
              const isLatest = idx === 0;

              return (
                <div
                  key={s.id}
                  className={`rounded-lg px-4 py-3 ${
                    isLatest ? 'bg-indigo-50 ring-1 ring-indigo-100' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: date + changes */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">
                          {new Date(s.snapshot_date).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                        {isLatest && (
                          <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-full">
                            Latest
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                        <p className="text-xs text-gray-500">
                          {Number(s.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                          {holding.quantity_unit && (
                            <span className="text-gray-400 ml-0.5">{holding.quantity_unit}</span>
                          )}
                          {qtyChange !== null && (
                            <span className={`ml-1 ${qtyChange > 0 ? 'text-green-600' : 'text-red-500'}`}>
                              ({qtyChange > 0 ? '+' : ''}{Number(qtyChange).toLocaleString('en-IN', { maximumFractionDigits: 4 })})
                            </span>
                          )}
                        </p>
                        {s.unit_amount != null && (
                          <p className="text-xs text-gray-500">@ {formatCurrency(s.unit_amount)}</p>
                        )}
                      </div>
                    </div>

                    {/* Right: value + change */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-gray-900">{formatCompactCurrency(s.amount)}</p>
                      {valueChange !== null && valueChangePct !== null && (
                        <p className={`text-xs mt-0.5 ${valueChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {valueChange >= 0 ? '+' : ''}
                          {formatCompactCurrency(valueChange)}{' '}
                          <span className="opacity-80">({valueChangePct >= 0 ? '+' : ''}{valueChangePct.toFixed(1)}%)</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-2">
        <Link
          href={`/portfolio/accounts/${accountId}`}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← Back to account
        </Link>
      </div>
    </PageContainer>
  );
}
