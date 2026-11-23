'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { PortfolioAccount, PortfolioHolding, PortfolioHoldingSnapshot } from '@/types';
import { formatCurrency, formatCompactCurrency, formatMonth } from '@/lib/utils';
import { Check } from 'lucide-react';

const INSTRUMENT_LABEL: Record<string, string> = {
  nse_stock:      'NSE',
  bse_stock:      'BSE',
  mf_nav:         'Mutual Fund',
  us_stock:       'US Stock',
  gold_etf:       'Gold ETF',
  gold_physical:  'Gold',
  gold_rate:      'Gold',
  sgb:            'SGB',
  bond:           'Bond',
  nps:            'NPS',
  manual:         'Manual',
};

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { useAccountTypes } from '@/lib/useAccountTypes';
import { ExpandableChart } from '@/components/charts/ExpandableChart';

function typeHref(typeIds: Record<string, string>, typeName: string): string {
  const id = typeIds[typeName];
  return id ? `/portfolio/types/${id}` : `/portfolio/types/${encodeURIComponent(typeName)}`;
}

interface SnapshotRow {
  id: string;
  snapshot_date: string;
  amount: number;
}

export default function AccountSnapshotPage() {
  const params = useParams();
  const id = params?.id as string | undefined;
  const { typeColors, typeIds } = useAccountTypes();

  const [account, setAccount] = useState<PortfolioAccount | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [holdingSnapshots, setHoldingSnapshots] = useState<PortfolioHoldingSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch('/api/portfolio/accounts?includeArchived=true').then((r) => r.json()),
      fetch(`/api/portfolio/snapshots?accountId=${id}&limit=60`).then((r) => r.json()),
      fetch(`/api/portfolio/holdings?accountId=${id}&includeInactive=true`).then((r) => r.json()),
      fetch(`/api/portfolio/holding-snapshots?accountId=${id}`).then((r) => r.json()),
    ])
      .then(([accountsData, snapshotsData, holdingsData, holdingSnapshotsData]) => {
        if (cancelled) return;
        const accounts = Array.isArray(accountsData) ? accountsData : [];
        setAccount(accounts.find((a: PortfolioAccount) => a.id === id) ?? null);
        setSnapshots(Array.isArray(snapshotsData) ? snapshotsData : []);
        setHoldings(Array.isArray(holdingsData) ? holdingsData : []);
        setHoldingSnapshots(Array.isArray(holdingSnapshotsData) ? holdingSnapshotsData : []);
      })
      .catch(() => {
        if (!cancelled) {
          setAccount(null);
          setSnapshots([]);
          setHoldings([]);
          setHoldingSnapshots([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  if (loading && !account) {
    return <LoadingSpinner message="Loading account…" />;
  }

  if (!id || !account) {
    return (
      <PageContainer maxWidth="7xl">
        <PageHeader title="Account not found" />
        <div className="card text-center py-8">
          <p className="text-gray-600 mb-4">This account does not exist or was removed.</p>
          <Link href="/portfolio" className="text-indigo-600 hover:underline">
            ← Portfolio
          </Link>
        </div>
      </PageContainer>
    );
  }

  const sortedSnapshots = [...snapshots].sort((a, b) =>
    b.snapshot_date.localeCompare(a.snapshot_date)
  );
  const latestSnapshot = sortedSnapshots[0];

  // Find the latest month that has any holding snapshot.
  // Only snapshots from this month are considered "current" — older ones belong
  // to instruments that have since been sold off or stopped being tracked.
  const latestHoldingMonth = holdingSnapshots
    .map(s => s.snapshot_date.substring(0, 7))
    .sort()
    .at(-1) ?? '';

  // Best snapshot per holding, restricted to the latest month only
  const latestHoldingSnapshotByHolding = holdingSnapshots
    .filter(s => s.snapshot_date.startsWith(latestHoldingMonth))
    .reduce((map, s) => {
      const existing = map.get(s.holding_id);
      if (!existing || s.snapshot_date > existing.snapshot_date) {
        map.set(s.holding_id, s);
      }
      return map;
    }, new Map<string, PortfolioHoldingSnapshot>());

  const instrumentsTotal = Array.from(latestHoldingSnapshotByHolding.values())
    .reduce((sum, s) => sum + s.amount, 0);

  const latestHoldingDate = latestHoldingMonth
    ? holdingSnapshots
        .filter(s => s.snapshot_date.startsWith(latestHoldingMonth))
        .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0]?.snapshot_date
    : undefined;

  const hasHoldingsData = instrumentsTotal > 0;
  const balanceDiff = hasHoldingsData && latestSnapshot
    ? instrumentsTotal - latestSnapshot.amount
    : 0;
  const hasDiff = Math.abs(balanceDiff) > 0.01;
  const trendData = (() => {
    // Keep only the latest snapshot per month (by date), not the sum
    const byMonth: Record<string, { date: string; amount: number }> = {};
    snapshots.forEach((s) => {
      const month = format(new Date(s.snapshot_date), 'yyyy-MM');
      const existing = byMonth[month];
      if (!existing || s.snapshot_date > existing.date) {
        byMonth[month] = { date: s.snapshot_date, amount: Number(s.amount) };
      }
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month]) => ({
        month: formatMonth(month + '-01'),
        value: byMonth[month].amount,
      }));
  })();
  const color = typeColors[account.type] ?? '#10b981';

  // Calculate median for trend chart
  const medianBalance = (() => {
    if (trendData.length === 0) return 0;
    const values = trendData.map(d => d.value).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
    console.log('Account balance trend median:', {
      dataPoints: trendData.length,
      values: values,
      median
    });
    return median;
  })();

  // Calculate 12-month growth
  const growth12M = (() => {
    if (sortedSnapshots.length < 2) return 0;

    const latest = sortedSnapshots[0];
    const latestDate = new Date(latest.snapshot_date);

    // Find snapshot from 12 months ago (or closest before that)
    const twelveMonthsAgo = new Date(latestDate);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const targetMonth = format(twelveMonthsAgo, 'yyyy-MM');

    // Find the snapshot closest to (but not after) 12 months ago
    let baseSnapshot = null;
    for (let i = sortedSnapshots.length - 1; i >= 0; i--) {
      const snapshot = sortedSnapshots[i];
      if (snapshot.snapshot_date.substring(0, 7) <= targetMonth) {
        baseSnapshot = snapshot;
        break;
      }
    }

    if (!baseSnapshot || baseSnapshot.amount === 0) return 0;

    return ((latest.amount - baseSnapshot.amount) / Math.abs(baseSnapshot.amount)) * 100;
  })();

  const handleSyncSnapshot = async () => {
    if (!latestHoldingDate || !id) return;
    setSyncing(true);
    try {
      await fetch('/api/portfolio/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: id,
          snapshot_date: latestHoldingDate,
          amount: instrumentsTotal,
          units: null,
        }),
      });
      // Refresh snapshots
      const res = await fetch(`/api/portfolio/snapshots?accountId=${id}&limit=60`);
      const data = await res.json();
      setSnapshots(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to sync snapshot', e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <PageContainer maxWidth="7xl">
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        {/* Mobile: back to type */}
        <Link href={typeHref(typeIds, account.type)} className="flex items-center gap-1 hover:text-gray-700 sm:hidden min-w-0">
          <span aria-hidden className="flex-shrink-0">←</span>
          <span className="truncate max-w-[180px]">{account.type}</span>
        </Link>

        {/* Desktop: full trail */}
        <Link href="/portfolio" className="hover:text-gray-700 hidden sm:inline flex-shrink-0">Portfolio</Link>
        <span aria-hidden className="hidden sm:inline flex-shrink-0">/</span>
        <Link href={typeHref(typeIds, account.type)} className="hover:text-gray-700 hidden sm:inline flex-shrink-0">
          {account.type}
        </Link>
        <span aria-hidden className="hidden sm:inline flex-shrink-0">/</span>
        <span className="text-gray-900 font-medium hidden sm:inline truncate max-w-[220px]">{account.name}</span>

        <span className="flex-1" />
        <Link href={`/portfolio/settings/accounts/${id}`} className="text-gray-500 hover:text-gray-700 flex-shrink-0 text-xs">
          Manage
        </Link>
      </nav>

      <PageHeader
        title={account.name}
        description={account.type}
      />

      {/* Current balance */}
      <div className={`card mb-6 ${hasDiff ? 'border-2 border-amber-300' : ''}`}>
        {/* Synced view: one primary number with a verification note */}
        {hasHoldingsData && !hasDiff && latestSnapshot ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Balance</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                <Check size={12} aria-hidden />
                In sync
              </span>
            </div>
            <div className="flex items-baseline gap-3">
              <p className={`text-3xl font-bold ${latestSnapshot.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatCurrency(latestSnapshot.amount)}
              </p>
              {Math.abs(growth12M) > 0.01 && (
                <p className={`text-sm font-medium ${growth12M >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {growth12M >= 0 ? '↑' : '↓'} {Math.abs(growth12M).toFixed(1)}%
                  <span className="text-xs text-gray-400 ml-1">12M</span>
                </p>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Recorded {new Date(latestSnapshot.snapshot_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              {latestHoldingDate && (
                <> · holdings as of {new Date(latestHoldingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</>
              )}
            </p>
          </div>
        ) : (
          /* Split view: diff exists or no holdings — show both columns */
          <div className="flex items-start justify-between gap-4">
            {/* Manual snapshot */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Account Balance</span>
              </div>
              {latestSnapshot ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <p className={`text-2xl font-bold ${latestSnapshot.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {formatCurrency(latestSnapshot.amount)}
                    </p>
                    {Math.abs(growth12M) > 0.01 && (
                      <p className={`text-xs font-medium ${growth12M >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {growth12M >= 0 ? '↑' : '↓'} {Math.abs(growth12M).toFixed(1)}% <span className="text-gray-400">12M</span>
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    As of {new Date(latestSnapshot.snapshot_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {' · '}manually recorded
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-400">No snapshot recorded yet</p>
              )}
            </div>

            {/* Instruments sum */}
            {hasHoldingsData && (
              <div className="flex-1 border-l border-gray-100 pl-4">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Instruments Sum</span>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(instrumentsTotal)}</p>
                {latestHoldingDate && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    As of {new Date(latestHoldingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {' · '}from holdings
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Diff banner */}
        {hasDiff && (
          <div className="mt-4 pt-4 border-t border-amber-200 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-amber-700">
                {balanceDiff > 0 ? '↑' : '↓'} Difference of {formatCurrency(Math.abs(balanceDiff))}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Instruments sum is {balanceDiff > 0 ? 'higher' : 'lower'} than the recorded account balance.
              </p>
            </div>
            <button
              onClick={handleSyncSnapshot}
              disabled={syncing}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50 whitespace-nowrap"
            >
              {syncing ? 'Updating…' : `Sync to ${formatCurrency(instrumentsTotal)}`}
            </button>
          </div>
        )}

        {!latestSnapshot && !hasHoldingsData && (
          <p className="text-gray-400 text-sm mt-2">No snapshots yet. Record from Snapshots or import CDSL.</p>
        )}
      </div>

      {/* Balance trend */}
      {trendData.length > 0 && (
        <div className="card mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Balance trend</h3>
          <ExpandableChart title={`Balance trend — ${account.name}`} height={200} expandedHeight={560} overlayButton>
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
                    tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), account.name]}
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
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  {medianBalance > 0 && (
                    <ReferenceLine
                      y={medianBalance}
                      stroke="#9ca3af"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      label={{
                        value: `Median: ${formatCurrency(medianBalance)}`,
                        position: 'right',
                        fill: '#6b7280',
                        fontSize: 11,
                        fontWeight: 600,
                        offset: 10,
                      }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </ExpandableChart>
        </div>
      )}

      {/* Balance history */}
      <div className="card mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Balance history</h3>
        {sortedSnapshots.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">
            No snapshot history. Add entries from the Snapshots page or import a CDSL statement.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sortedSnapshots.map((snapshot, idx) => {
              const prev = sortedSnapshots[idx + 1];
              const change = prev ? snapshot.amount - prev.amount : 0;
              const changePct =
                prev && prev.amount !== 0
                  ? (change / Math.abs(prev.amount)) * 100
                  : 0;
              return (
                <div
                  key={snapshot.id}
                  className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="text-sm text-gray-900">
                      {new Date(snapshot.snapshot_date).toLocaleDateString('en-IN', {
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                    {prev && change !== 0 && (
                      <p
                        className={`text-xs ${
                          change > 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {change > 0 ? '↑' : '↓'} {formatCompactCurrency(Math.abs(change))} (
                        {Math.abs(changePct).toFixed(1)}%)
                      </p>
                    )}
                  </div>
                  <p
                    className={`text-sm font-medium ${
                      snapshot.amount < 0 ? 'text-red-600' : 'text-gray-900'
                    }`}
                  >
                    {formatCompactCurrency(snapshot.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Instruments — links to holding details */}
      {holdings.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Instruments
              <span className="ml-2 text-xs font-normal text-gray-400">{holdings.filter(h => h.is_active).length} active</span>
            </h3>
            <Link href={`/portfolio/settings/accounts/${id}`} className="text-xs text-indigo-600 hover:text-indigo-800">
              Manage →
            </Link>
          </div>
          {latestHoldingMonth && (
            <p className="text-xs text-gray-400 mb-2">
              Showing data for {format(new Date(latestHoldingMonth + '-01'), 'MMM yyyy')}
            </p>
          )}
          {(() => {
            const current = holdings.filter(h => latestHoldingSnapshotByHolding.has(h.id));
            const stale = holdings.filter(h => !latestHoldingSnapshotByHolding.has(h.id));

            const renderHolding = (h: typeof holdings[0]) => {
              const latest = latestHoldingSnapshotByHolding.get(h.id);
              const typeLabel = INSTRUMENT_LABEL[h.instrument_type] ?? h.instrument_type;
              const showSymbol = h.symbol && h.symbol !== h.name && h.symbol.length <= 20;
              const displayName = toTitleCase(h.name);

              return (
                <li key={h.id}>
                  <Link
                    href={`/portfolio/accounts/${id}/holdings/${h.id}`}
                    className={`flex items-center justify-between py-3 px-2 rounded-lg hover:bg-gray-50 group ${!h.is_active ? 'opacity-50' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 truncate">
                          {displayName}
                        </p>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 flex-shrink-0">
                          {typeLabel}
                        </span>
                        {!h.is_active && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-500 flex-shrink-0">
                            Inactive
                          </span>
                        )}
                      </div>
                      {showSymbol && (
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">{h.symbol}</p>
                      )}
                    </div>
                    {latest && (
                      <div className="text-right flex-shrink-0 ml-4">
                        <p className="text-sm font-semibold text-gray-900">{formatCompactCurrency(latest.amount)}</p>
                        {latest.quantity != null && (
                          <p className="text-xs text-gray-400">
                            {Number(latest.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })} units
                          </p>
                        )}
                      </div>
                    )}
                  </Link>
                </li>
              );
            };

            return (
              <>
                <ul className="divide-y divide-gray-100">
                  {current.map(renderHolding)}
                </ul>
                {stale.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-gray-400 cursor-pointer select-none hover:text-gray-600">
                      {stale.length} instrument{stale.length > 1 ? 's' : ''} with no recent data (not included in sum)
                    </summary>
                    <ul className="divide-y divide-gray-100 mt-1 opacity-50">
                      {stale.map(renderHolding)}
                    </ul>
                  </details>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Account details & metadata */}
      <div className="card mt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Account details</h3>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Type</dt>
            <dd className="font-medium text-gray-900">{account.type}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Currency</dt>
            <dd className="font-medium text-gray-900">{account.currency}</dd>
          </div>
          {account.unit && (
            <div>
              <dt className="text-xs text-gray-500 mb-0.5">Unit</dt>
              <dd className="font-medium text-gray-900">{account.unit}</dd>
            </div>
          )}
          {account.multiplier != null && (
            <div>
              <dt className="text-xs text-gray-500 mb-0.5">Multiplier</dt>
              <dd className="font-medium text-gray-900">{account.multiplier}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Status</dt>
            <dd>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${account.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {account.is_active ? 'Active' : 'Inactive'}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Created</dt>
            <dd className="font-medium text-gray-900">
              {new Date(account.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </dd>
          </div>
        </dl>

        {account.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{account.notes}</p>
          </div>
        )}

        {account.details && Object.keys(account.details).length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-3">Metadata</p>
            <div className="space-y-3">
              {Object.entries(account.details).map(([key, value]) => {
                const isComplex = typeof value === 'object' && value !== null;
                return (
                  <div key={key}>
                    <p className="text-xs text-gray-500 mb-1 capitalize">{key.replace(/_/g, ' ')}</p>
                    {isComplex ? (
                      <pre className="text-xs text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-sm font-medium text-gray-900">{String(value)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <Link
          href={typeHref(typeIds, account.type)}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← Back to {account.type}
        </Link>
      </div>
    </PageContainer>
  );
}
