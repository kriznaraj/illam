'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatCurrency, formatCompactCurrency, formatMonth } from '@/lib/utils';
import { PortfolioAccount, PortfolioSnapshot } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { format } from 'date-fns';
import { ExpandableChart } from '@/components/charts/ExpandableChart';
import { monthlyTotals } from '@/lib/portfolio/monthlySnapshots';

interface AccountType {
  id: string;
  name: string;
  color: string;
}

interface AccountWithLatestBalance extends PortfolioAccount {
  latestBalance: number;
  latestDate: string;
}

export default function PortfolioTypeDetailsPage() {
  const params = useParams();
  const typeId = params?.typeId as string | undefined;

  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [accounts, setAccounts] = useState<AccountWithLatestBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeTotal, setTypeTotal] = useState(0);
  const [typeTrend, setTypeTrend] = useState<{ month: string; value: number }[]>([]);

  useEffect(() => {
    if (!typeId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch('/api/portfolio/account-types', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/portfolio/accounts',      { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/portfolio/snapshots',     { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([typesData, accountsData, snapshotsData]: [AccountType[], PortfolioAccount[], PortfolioSnapshot[]]) => {
        if (cancelled) return;
        const types = Array.isArray(typesData) ? typesData : [];
        const foundType = types.find((t) => t.id === typeId) ?? null;
        setAccountType(foundType);

        if (!foundType) return;

        const accountsList = Array.isArray(accountsData) ? accountsData : [];
        const snaps = Array.isArray(snapshotsData) ? snapshotsData : [];
        const ofType = accountsList.filter((a) => a.type === foundType.name);

        const balanceMap: Record<string, { balance: number; date: string }> = {};
        snaps.forEach((s) => {
          const cur = balanceMap[s.account_id];
          if (!cur || s.snapshot_date > cur.date) {
            balanceMap[s.account_id] = { balance: s.amount, date: s.snapshot_date };
          }
        });

        const withBalances: AccountWithLatestBalance[] = ofType.map((a) => ({
          ...a,
          latestBalance: balanceMap[a.id]?.balance ?? 0,
          latestDate: balanceMap[a.id]?.date ?? '',
        }));
        setAccounts(withBalances);
        setTypeTotal(withBalances.reduce((s, a) => s + a.latestBalance, 0));

        // Deduped per (account, month): summing every row counts an account with two
        // snapshots in one month twice, spiking this chart far above its neighbouring months.
        const monthly = monthlyTotals(snaps, ofType.map((a) => a.id));
        setTypeTrend(
          Array.from(monthly.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, value]) => ({
              month: formatMonth(month + '-01'),
              value,
            }))
        );
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [typeId]);

  if (!typeId) {
    return (
      <PageContainer>
        <PageHeader title="Type" />
        <p className="text-gray-600">Invalid link.</p>
        <Link href="/portfolio" className="text-indigo-600 hover:underline mt-2 inline-block">
          ← Portfolio
        </Link>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer>
        <LoadingSpinner message="Loading…" />
      </PageContainer>
    );
  }

  if (!accountType) {
    return (
      <PageContainer>
        <PageHeader title="Not found" />
        <p className="text-gray-600">Account type not found.</p>
        <Link href="/portfolio" className="text-indigo-600 hover:underline mt-2 inline-block">
          ← Portfolio
        </Link>
      </PageContainer>
    );
  }

  const color = accountType.color ?? '#6b7280';

  // Calculate median for trend chart
  const medianTypeBalance = (() => {
    if (typeTrend.length === 0) return 0;
    const values = typeTrend.map(d => d.value).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
    console.log('Type balance trend median:', {
      typeName: accountType.name,
      dataPoints: typeTrend.length,
      median
    });
    return median;
  })();

  return (
    <PageContainer maxWidth="7xl">
      <Link href="/portfolio" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">
        ← Portfolio
      </Link>
      <PageHeader
        title={accountType.name}
        description={`${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}
      />

      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium text-gray-600">Total</span>
        </div>
        <p className={`text-2xl font-bold ${typeTotal < 0 ? 'text-red-600' : 'text-gray-900'}`}>
          {formatCurrency(typeTotal)}
        </p>
      </div>

      {typeTrend.length > 0 && (
        <div className="card mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Balance trend</h3>
          <ExpandableChart title={`Balance trend — ${accountType.name}`} height={200} expandedHeight={560} overlayButton>
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={typeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} width={40} />
                  <Tooltip formatter={(v: number) => [formatCurrency(v), accountType.name]} />
                  <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  {medianTypeBalance > 0 && (
                    <ReferenceLine
                      y={medianTypeBalance}
                      stroke="#9ca3af"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      label={{
                        value: `Median: ${formatCurrency(medianTypeBalance)}`,
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

      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Accounts</h3>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No accounts of this type.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {accounts.map((account) => (
              <li key={account.id}>
                <Link
                  href={`/portfolio/accounts/${account.id}`}
                  className="flex items-center justify-between py-3 px-2 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{account.name}</p>
                    {account.latestDate && (
                      <p className="text-xs text-gray-500">
                        As of {new Date(account.latestDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  <p className={`text-sm font-bold ${account.latestBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {formatCompactCurrency(account.latestBalance)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
