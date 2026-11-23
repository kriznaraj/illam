'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import Modal from '@/components/Modal';
import InvestmentDetailModal from '@/components/portfolio/InvestmentDetailModal';
import { ExpandableChart } from '@/components/charts/ExpandableChart';
import { SegmentedControl } from '@/components/SegmentedControl';
import { MonthNavigator } from '@/components/MonthNavigator';
import { formatCurrency } from '@/lib/utils';
import type { PortfolioAccount, PortfolioInvestment } from '@/types';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { INVESTMENT_START_MONTH } from '@/lib/portfolio/constants';
import { resolveSipAmount, type SipAmountChange } from '@/lib/portfolio/sipSchedule';
import { getAppMonthKey, getTodayAppDate } from '@/lib/utils/dateUtils';

type InvestmentReport = {
  months: string[];
  monthly: Array<{
    month: string;
    manual: number;
    auto_sip: number;
    total: number;
  }>;
  monthly_split: Record<
    string,
    Array<{
      account_id: string;
      account_name: string;
      manual_amount: number;
      auto_sip_amount: number;
      total_amount: number;
      percentage: number;
    }>
  >;
};

type SipFund = {
  name?: string;
  sip_amount?: number;
  sip_date?: string;
  active?: boolean;
  notes?: string;
  amount_history?: SipAmountChange[];
};

type InvestmentListRow = {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  accountName: string;
  kind: 'adhoc' | 'recurring' | 'sip_auto' | 'auto_recurring';
  note: string | null;
  deletable: boolean;
};

const MIN_INVESTMENT_MONTH = INVESTMENT_START_MONTH;
const AUTO_RECURRING_NOTE = '__AUTO_MONTHLY__';
const AUTO_SIP_VIRTUAL_NOTE = '__AUTO_SIP_VIRTUAL__';

const toMonthLabel = (month: string): string => {
  const [y, m] = month.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

const getCurrentMonth = (): string => getAppMonthKey();
const clampMonth = (month: string): string => (month < MIN_INVESTMENT_MONTH ? MIN_INVESTMENT_MONTH : month);
const getMonthStart = (month: string): string => `${month}-01`;
const getMonthEnd = (month: string): string => {
  const [year, monthIndex] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!year || !monthIndex) return `${month}-31`;
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
};
const listMonthDays = (month: string): string[] => {
  const [year, monthIndex] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!year || !monthIndex) return [];
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, idx) => `${month}-${String(idx + 1).padStart(2, '0')}`);
};
const parseSipDay = (sipDate: string | undefined, month: string): number => {
  const fallback = 1;
  if (!sipDate) return fallback;
  const [year, monthIndex] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!year || !monthIndex) return fallback;
  const maxDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const parsed = Number.parseInt((sipDate.match(/\d+/)?.[0] ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(maxDay, parsed));
};

const formatSplitParts = (autoAmount: number, manualAmount: number): string => {
  const auto = Number(autoAmount ?? 0);
  const manual = Number(manualAmount ?? 0);
  const hasAuto = auto > 0;
  const hasManual = manual > 0;
  if (hasAuto && hasManual) {
    return `${formatCurrency(auto)} recurring + ${formatCurrency(manual)} adhoc`;
  }
  if (hasAuto) {
    return 'recurring';
  }
  if (hasManual) {
    return 'adhoc';
  }
  return '-';
};

const isAutoInvestmentKind = (kind: InvestmentListRow['kind']): boolean =>
  kind === 'sip_auto' || kind === 'auto_recurring';

const getInvestmentBadge = (kind: InvestmentListRow['kind']): { label: 'Recurring' | 'Adhoc'; className: string } => {
  if (kind === 'sip_auto' || kind === 'auto_recurring' || kind === 'recurring') {
    return { label: 'Recurring', className: 'text-purple-600' };
  }
  return { label: 'Adhoc', className: 'text-primary-600' };
};

const TREND_CATEGORY_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#0d9488',
  '#ea580c',
  '#dc2626',
  '#0891b2',
  '#65a30d',
  '#9333ea',
];

export default function PortfolioInvestmentsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedInvestment, setSelectedInvestment] = useState<PortfolioInvestment | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(clampMonth(getCurrentMonth()));
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [entries, setEntries] = useState<PortfolioInvestment[]>([]);
  const [report, setReport] = useState<InvestmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splitView, setSplitView] = useState<'account' | 'category'>('account');
  const [trendView, setTrendView] = useState<'total' | 'category'>('total');
  const [totalsChartView, setTotalsChartView] = useState<'account' | 'category'>('account');
  const [filterModal, setFilterModal] = useState<null | { type: 'account' | 'category'; name: string }>(null);
  const hasFetchedReportRef = useRef(false);
  const [form, setForm] = useState({
    account_id: '',
    investment_date: getTodayAppDate(),
    amount: '',
    kind: 'adhoc' as 'adhoc' | 'recurring',
    note: '',
  });

  const openAddModal = () => {
    setForm((prev) => ({ ...prev, investment_date: `${selectedMonth}-01` }));
    setShowAddModal(true);
  };

  const fetchMonthEntries = async (month: string) => {
    const effectiveMonth = clampMonth(month);
    const startDate = getMonthStart(effectiveMonth);
    const endDate = getMonthEnd(effectiveMonth);
    const entriesRes = await fetch(
      `/api/portfolio/investments?startDate=${startDate}&endDate=${endDate}&limit=500`,
      { cache: 'no-store' }
    );
    const entriesData = await entriesRes.json();
    if (!entriesRes.ok) {
      throw new Error(
        (entriesData && typeof entriesData.error === 'string' && entriesData.error) ||
          'Failed to load investments'
      );
    }
    setEntries(Array.isArray(entriesData) ? entriesData : []);
  };

  const fetchAccountsAndMaybeReport = async (includeReport: boolean) => {
    const requests = [
      fetch('/api/portfolio/accounts?includeArchived=false', { cache: 'no-store' }),
    ];
    if (includeReport) {
      requests.push(fetch('/api/portfolio/investments/report?months=24', { cache: 'no-store' }));
    }

    const responses = await Promise.all(requests);
    const accountsRes = responses[0];
    const accountsData = await accountsRes.json();
    if (!accountsRes.ok) {
      throw new Error(
        (accountsData && typeof accountsData.error === 'string' && accountsData.error) ||
          'Failed to load accounts'
      );
    }

    const activeAccounts = (Array.isArray(accountsData) ? accountsData : []).filter(
      (a: PortfolioAccount) => a.is_active !== false
    );
    setAccounts(activeAccounts);
    if (!form.account_id && activeAccounts.length > 0) {
      setForm((prev) => ({ ...prev, account_id: activeAccounts[0].id }));
    }

    if (includeReport) {
      const reportRes = responses[1];
      if (!reportRes) return;
      const reportData = await reportRes.json();
      if (!reportRes.ok) {
        throw new Error(
          (reportData && typeof reportData.error === 'string' && reportData.error) ||
            'Failed to load report'
        );
      }
      setReport(reportData as InvestmentReport);
    }
  };

  const fetchAll = async (options?: { includeReport?: boolean; month?: string }) => {
    const includeReport = options?.includeReport ?? false;
    const month = options?.month ?? selectedMonth;
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchMonthEntries(month), fetchAccountsAndMaybeReport(includeReport)]);
      if (includeReport) {
        hasFetchedReportRef.current = true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load investments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll({ includeReport: !hasFetchedReportRef.current, month: selectedMonth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  const trendTotalData = useMemo(
    () =>
      (report?.monthly ?? []).map((point) => ({
        month: point.month,
        label: toMonthLabel(point.month),
        total: Number(point.total ?? 0),
      })),
    [report]
  );

  const trendData = useMemo(() => {
    if (!report) return [] as Array<Record<string, string | number>>;

    const typeByAccountId = new Map(accounts.map((a) => [a.id, a.type || 'Other']));

    return (report.monthly ?? []).map((point) => {
      const splitRows = report.monthly_split?.[point.month] ?? [];
      const byCategory = new Map<string, number>();

      for (const row of splitRows) {
        const category = typeByAccountId.get(row.account_id) ?? 'Other';
        byCategory.set(category, (byCategory.get(category) ?? 0) + Number(row.total_amount ?? 0));
      }

      const dataPoint: Record<string, string | number> = {
        month: point.month,
        label: toMonthLabel(point.month),
        total: Number(point.total ?? 0),
      };

      for (const [category, value] of byCategory.entries()) {
        dataPoint[`cat:${category}`] = Number(value.toFixed(2));
      }

      return dataPoint;
    });
  }, [report, accounts]);

  const trendCategoryKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const point of trendData) {
      for (const key of Object.keys(point)) {
        if (key.startsWith('cat:')) keys.add(key);
      }
    }
    return Array.from(keys);
  }, [trendData]);

  const averageInvestment = useMemo(() => {
    const totals = trendTotalData.map((point) => Number(point.total ?? 0)).filter((v) => Number.isFinite(v));
    if (totals.length === 0) return 0;
    return totals.reduce((sum, value) => sum + value, 0) / totals.length;
  }, [trendTotalData]);

  const sipRows = useMemo(() => {
    if (selectedMonth < INVESTMENT_START_MONTH) return [] as InvestmentListRow[];
    return accounts.flatMap((account) => {
      const details = account.details as Record<string, unknown> | null;
      const funds = Array.isArray(details?.funds) ? (details?.funds as SipFund[]) : [];
      return funds
        .map((fund, idx) => ({ fund, idx, amount: resolveSipAmount(fund, selectedMonth) }))
        // The amount is resolved for the month being viewed, so a fund that
        // only started later contributes nothing to earlier months.
        .filter(({ fund, amount }) => fund.active !== false && amount > 0)
        .map(({ fund, idx, amount }) => {
          const day = parseSipDay(fund.sip_date, selectedMonth);
          const date = `${selectedMonth}-${String(day).padStart(2, '0')}`;
          const fundName = fund.name?.trim() || account.name;
          return {
            id: `sip-${selectedMonth}-${account.id}-${idx}`,
            accountId: account.id,
            date,
            amount,
            accountName: account.name,
            kind: 'sip_auto' as const,
            note: `SIP · ${fundName}${fund.notes ? ` · ${fund.notes}` : ''}`,
            deletable: false,
          };
        });
    });
  }, [accounts, selectedMonth]);

  const manualRows = useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        accountId: entry.account_id,
        date: entry.investment_date,
        amount: Number(entry.amount ?? 0),
        accountName: entry.account?.name ?? 'Account',
        kind: entry.kind === 'recurring' && entry.note === AUTO_RECURRING_NOTE ? 'auto_recurring' as const : entry.kind,
        note: entry.note === AUTO_RECURRING_NOTE ? null : (entry.note ?? null),
        deletable: !(entry.kind === 'recurring' && entry.note === AUTO_RECURRING_NOTE),
      })),
    [entries]
  );

  const investmentById = useMemo(() => {
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const map = new Map<string, PortfolioInvestment>();
    for (const entry of entries) {
      map.set(entry.id, entry);
    }
    for (const row of sipRows) {
      const account = accountById.get(row.accountId);
      map.set(row.id, {
        id: row.id,
        account_id: row.accountId,
        investment_date: row.date,
        amount: row.amount,
        kind: 'recurring',
        note: AUTO_SIP_VIRTUAL_NOTE,
        created_at: '',
        updated_at: '',
        account,
      });
    }
    return map;
  }, [entries, sipRows, accounts]);

  const visibleRows = useMemo(() => {
    return [...manualRows, ...sipRows].sort((a, b) => {
      if (a.date === b.date) return b.amount - a.amount;
      return b.date.localeCompare(a.date);
    });
  }, [manualRows, sipRows]);

  const groupedRows = useMemo(() => {
    return visibleRows.reduce((acc, row) => {
      if (!acc[row.date]) acc[row.date] = [];
      acc[row.date].push(row);
      return acc;
    }, {} as Record<string, InvestmentListRow[]>);
  }, [visibleRows]);

  const accountTypeById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.type || 'Other'])),
    [accounts]
  );

  const selectedMonthTotal = useMemo(
    () => visibleRows.reduce((sum, row) => sum + row.amount, 0),
    [visibleRows]
  );
  const selectedMonthAuto = useMemo(
    () => visibleRows.filter((row) => isAutoInvestmentKind(row.kind)).reduce((sum, row) => sum + row.amount, 0),
    [visibleRows]
  );
  const selectedMonthManual = useMemo(
    () => visibleRows.filter((row) => !isAutoInvestmentKind(row.kind)).reduce((sum, row) => sum + row.amount, 0),
    [visibleRows]
  );
  const selectedMonthGross = useMemo(
    () => visibleRows.reduce((sum, row) => sum + Math.abs(row.amount), 0),
    [visibleRows]
  );

  const splitRows = useMemo(() => {
    const byAccount = new Map<string, { account_name: string; manual: number; auto: number }>();
    for (const row of visibleRows) {
      const current = byAccount.get(row.accountId) ?? {
        account_name: row.accountName,
        manual: 0,
        auto: 0,
      };
      if (isAutoInvestmentKind(row.kind)) {
        current.auto += row.amount;
      } else {
        current.manual += row.amount;
      }
      byAccount.set(row.accountId, current);
    }

    return Array.from(byAccount.entries())
      .map(([account_id, values]) => {
        const total_amount = values.manual + values.auto;
        return {
          account_id,
          account_name: values.account_name,
          manual_amount: Number(values.manual.toFixed(2)),
          auto_sip_amount: Number(values.auto.toFixed(2)),
          total_amount: Number(total_amount.toFixed(2)),
          percentage: selectedMonthGross > 0 ? Number(((Math.abs(total_amount) / selectedMonthGross) * 100).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => b.total_amount - a.total_amount);
  }, [visibleRows, selectedMonthGross]);

  const categorySplitRows = useMemo(() => {
    if (!splitRows.length) return [];
    const byType = new Map<string, { total: number; auto: number; manual: number }>();
    for (const row of splitRows) {
      const type = accountTypeById.get(row.account_id) ?? 'Other';
      const current = byType.get(type) ?? { total: 0, auto: 0, manual: 0 };
      current.total += row.total_amount;
      current.auto += row.auto_sip_amount;
      current.manual += row.manual_amount;
      byType.set(type, current);
    }
    return Array.from(byType.entries())
      .map(([type, values]) => ({
        type,
        total_amount: Number(values.total.toFixed(2)),
        auto_amount: Number(values.auto.toFixed(2)),
        manual_amount: Number(values.manual.toFixed(2)),
        percentage: selectedMonthGross > 0 ? Number(((Math.abs(values.total) / selectedMonthGross) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.total_amount - a.total_amount);
  }, [accountTypeById, splitRows, selectedMonthGross]);

  const previousActiveMonth = useMemo(() => {
    const monthly = report?.monthly ?? [];
    for (let i = monthly.length - 1; i >= 0; i -= 1) {
      const point = monthly[i];
      if (point.month >= selectedMonth) continue;
      const total = Number(point.total ?? 0);
      if (Number.isFinite(total) && Math.abs(total) > 0) {
        return point.month;
      }
    }
    return null;
  }, [report, selectedMonth]);

  const filteredRows = useMemo(() => {
    if (!filterModal) return [];
    if (filterModal.type === 'account') {
      return visibleRows.filter((row) => row.accountName === filterModal.name);
    }
    return visibleRows.filter((row) => (accountTypeById.get(row.accountId) ?? 'Other') === filterModal.name);
  }, [filterModal, visibleRows, accountTypeById]);

  const filteredGroupedRows = useMemo(() => {
    return filteredRows.reduce((acc, row) => {
      if (!acc[row.date]) acc[row.date] = [];
      acc[row.date].push(row);
      return acc;
    }, {} as Record<string, InvestmentListRow[]>);
  }, [filteredRows]);

  const filteredTotal = useMemo(
    () => filteredRows.reduce((sum, row) => sum + row.amount, 0),
    [filteredRows]
  );
  const totalsChartData = useMemo(() => {
    // Narrow to {name, total_amount} per branch. Reading row.account_name off
    // the union directly is correct at runtime but unprovable to TS, since it
    // can't tie the property access back to the totalsChartView check.
    const source =
      totalsChartView === 'account'
        ? splitRows.map((row) => ({ name: row.account_name, total_amount: row.total_amount }))
        : categorySplitRows.map((row) => ({ name: row.type, total_amount: row.total_amount }));
    return source
      .map(({ name, total_amount }, index) => {
        const total = Number(total_amount ?? 0);
        return {
          id: `${totalsChartView}-${name}-${index}`,
          name,
          total,
          absTotal: Math.abs(total),
          color: total < 0 ? '#dc2626' : TREND_CATEGORY_COLORS[index % TREND_CATEGORY_COLORS.length],
        };
      })
      .sort((a, b) => b.absTotal - a.absTotal)
      .slice(0, 10);
  }, [totalsChartView, splitRows, categorySplitRows]);

  const dailyChartData = useMemo(() => {
    const days = listMonthDays(selectedMonth);
    if (days.length === 0) return [] as Array<{ date: string; day: string; total: number; cumulative: number }>;

    const totalByDate = new Map<string, number>();
    for (const row of visibleRows) {
      totalByDate.set(row.date, (totalByDate.get(row.date) ?? 0) + row.amount);
    }

    let cumulative = 0;
    return days.map((date) => {
      const total = totalByDate.get(date) ?? 0;
      cumulative += total;
      return {
        date,
        day: date.slice(-2),
        total: Number(total.toFixed(2)),
        cumulative: Number(cumulative.toFixed(2)),
      };
    });
  }, [selectedMonth, visibleRows]);

  // Set when the server finds this deposit already recorded from a bank transfer (HTTP 409).
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const saveInvestment = async (force: boolean) => {
    if (!form.account_id || !form.investment_date) return;
    const amount = Number.parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount === 0) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/portfolio/investments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: form.account_id,
          investment_date: form.investment_date,
          amount,
          kind: form.kind,
          note: form.note.trim() || null,
          force,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && !force) {
        setDuplicateWarning(typeof data?.error === 'string' ? data.error : 'This deposit looks already recorded from a bank transfer');
        return;
      }
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to add investment');
      }

      setDuplicateWarning(null);
      setForm((prev) => ({ ...prev, amount: '', note: '', investment_date: `${selectedMonth}-01` }));
      setShowAddModal(false);
      await fetchAll({ includeReport: true, month: selectedMonth });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add investment');
    } finally {
      setSaving(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveInvestment(false);
  };

  const isInitialLoading = loading && !report && entries.length === 0 && accounts.length === 0;
  if (isInitialLoading) return <LoadingSpinner message="Loading investment tracker..." />;

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Investments"
        description={toMonthLabel(selectedMonth)}
        action={
          <button
            className="btn btn-primary"
            onClick={openAddModal}
          >
            + Add Investment
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && !isInitialLoading && (
        <div className="mb-4 rounded-lg border border-primary-100 bg-primary-50 px-4 py-2 text-xs text-primary-700">
          Updating investments...
        </div>
      )}
      {!loading && visibleRows.length === 0 && previousActiveMonth && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-primary-100 bg-primary-50 px-4 py-2.5 text-sm text-primary-700">
          <span>No investments in {toMonthLabel(selectedMonth)}.</span>
          <button
            type="button"
            className="btn btn-link text-sm whitespace-nowrap"
            onClick={() => setSelectedMonth(previousActiveMonth)}
          >
            Show {toMonthLabel(previousActiveMonth)} →
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Investment Trend</h3>
              <p className="text-xs text-gray-500 mt-0.5">Average: {formatCurrency(averageInvestment)}</p>
            </div>
            <SegmentedControl
              value={trendView}
              onChange={setTrendView}
              ariaLabel="Investment trend view"
              options={[
                { value: 'total', label: 'Total' },
                { value: 'category', label: 'Category' },
              ]}
            />
          </div>
          <ExpandableChart title="Investment Trend" height={260} expandedHeight={560} overlayButton>
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendView === 'category' ? trendData : trendTotalData}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(Number(v) / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      formatCurrency(value),
                      trendView === 'category' && name.startsWith('cat:') ? name.slice(4) : name,
                    ]}
                    contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                  <ReferenceLine
                    y={averageInvestment}
                    stroke="#6b7280"
                    strokeDasharray="6 4"
                    strokeWidth={1.5}
                    label={{
                      value: 'Avg',
                      position: 'insideTopRight',
                      fill: '#6b7280',
                      fontSize: 10,
                    }}
                  />
                  {trendView === 'category' && trendCategoryKeys.length > 0 ? (
                    trendCategoryKeys.map((key, index) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        name={key.slice(4)}
                        stackId="investment-by-category"
                        fill={TREND_CATEGORY_COLORS[index % TREND_CATEGORY_COLORS.length]}
                        radius={[3, 3, 0, 0]}
                      />
                    ))
                  ) : (
                    <Bar dataKey="total" name="Total Investment" fill="#2563eb" radius={[3, 3, 0, 0]} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </ExpandableChart>
          <MonthNavigator
            className="mt-4"
            value={selectedMonth}
            onChange={setSelectedMonth}
            min={MIN_INVESTMENT_MONTH}
            allowFuture
            ariaLabel="Investment month"
          />
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Overview</h3>
          <div className="space-y-2 text-sm">
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs text-gray-500">Total Investment</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">
                {formatCurrency(selectedMonthTotal)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs text-gray-500">Recurring Contributions</p>
              <p className="text-base font-medium text-purple-700 mt-1">
                {formatCurrency(selectedMonthAuto)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs text-gray-500">Adhoc</p>
              <p className="text-base font-medium text-emerald-700 mt-1">
                {formatCurrency(selectedMonthManual)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Investment Split</h3>
            <SegmentedControl
              value={splitView}
              onChange={setSplitView}
              ariaLabel="Investment split view"
              options={[
                { value: 'account', label: 'Account' },
                { value: 'category', label: 'Category' },
              ]}
            />
          </div>
          <p className="text-xs text-gray-500 mb-3">
            {formatCurrency(selectedMonthTotal)} total{selectedMonthTotal !== 0 ? ` · ${formatSplitParts(selectedMonthAuto, selectedMonthManual)}` : ''}
          </p>
          <div className="space-y-2">
            {(splitView === 'account' ? splitRows.length : categorySplitRows.length) === 0 ? (
              <p className="text-sm text-gray-500 py-4">No investments for this month.</p>
            ) : (
              splitView === 'account'
                ? splitRows.map((row) => (
                    <button
                      type="button"
                      key={row.account_id}
                      className="w-full text-left rounded-lg border border-gray-100 p-3 hover:bg-gray-50 transition-colors"
                      onClick={() => setFilterModal({ type: 'account', name: row.account_name })}
                    >
                      <div className="flex items-center justify-between text-sm">
                        <p className="font-medium text-gray-900">{row.account_name}</p>
                        <p className="font-semibold text-gray-900">{row.percentage.toFixed(1)}%</p>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {formatCurrency(row.total_amount)} ({formatSplitParts(row.auto_sip_amount, row.manual_amount)})
                      </div>
                    </button>
                  ))
                : categorySplitRows.map((row) => (
                    <button
                      type="button"
                      key={row.type}
                      className="w-full text-left rounded-lg border border-gray-100 p-3 hover:bg-gray-50 transition-colors"
                      onClick={() => setFilterModal({ type: 'category', name: row.type })}
                    >
                      <div className="flex items-center justify-between text-sm">
                        <p className="font-medium text-gray-900">{row.type}</p>
                        <p className="font-semibold text-gray-900">{row.percentage.toFixed(1)}%</p>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {formatCurrency(row.total_amount)} ({formatSplitParts(row.auto_amount, row.manual_amount)})
                      </div>
                    </button>
                  ))
            )}
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            All Investments ({visibleRows.length})
          </h3>
          <div className="space-y-4">
            {visibleRows.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No investments for this month.</p>
            ) : (
              Object.entries(groupedRows)
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([date, dayRows]) => {
                  const dayTotal = dayRows.reduce((sum, row) => sum + row.amount, 0);
                  return (
                    <div key={date}>
                      <div className="flex items-center mb-2 pb-2 border-b-2 border-gray-200">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900">
                            {new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                          <p className="text-xs text-gray-500">
                            {dayRows.length} investment{dayRows.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <p className="text-base font-bold text-primary-900">{formatCurrency(dayTotal)}</p>
                      </div>
                      <div className="space-y-2">
                        {dayRows.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            className="w-full text-left rounded-lg border border-gray-100 p-3 flex items-start justify-between gap-3 hover:bg-gray-50 transition-colors"
                            onClick={() => {
                              const investment = investmentById.get(row.id);
                              if (investment) setSelectedInvestment(investment);
                            }}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{row.accountName}</p>
                              <p className="text-xs text-gray-500">
                                {row.kind === 'sip_auto'
                                  ? 'SIP (recurring)'
                                  : row.kind === 'auto_recurring'
                                  ? 'Recurring'
                                  : row.kind}
                                {row.note ? ` · ${row.note}` : ''}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-semibold text-gray-900">{formatCurrency(row.amount)}</p>
                              {(() => {
                                const badge = getInvestmentBadge(row.kind);
                                return <span className={`text-[11px] font-medium ${badge.className}`}>{badge.label}</span>;
                              })()}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <div className="card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-700">Total Investment by</h3>
            <SegmentedControl
              value={totalsChartView}
              onChange={setTotalsChartView}
              ariaLabel="Total investment breakdown view"
              options={[
                { value: 'account', label: 'Account' },
                { value: 'category', label: 'Category' },
              ]}
            />
          </div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={totalsChartData} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(Number(v) / 1000).toFixed(0)}k`} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={108}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value: string) => (value.length > 14 ? `${value.slice(0, 14)}…` : value)}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), 'Total']}
                  labelFormatter={(label: string) => `${toMonthLabel(selectedMonth)} · ${label}`}
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <ReferenceLine x={0} stroke="#9ca3af" strokeDasharray="3 3" />
                <Bar dataKey="total" name="Total Investment" radius={[0, 3, 3, 0]}>
                  {totalsChartData.map((entry) => (
                    <Cell key={entry.id} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Cumulative Investment</h3>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), 'Cumulative']}
                  labelFormatter={(label: string) => `${toMonthLabel(selectedMonth)} · ${label}`}
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  name="Cumulative"
                  stroke="#0f766e"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setDuplicateWarning(null);
        }}
        maxWidth="md"
        title={<span className="text-lg font-semibold text-gray-900">Add Investment</span>}
      >
        <form onSubmit={submit} className="space-y-3">
          <select
            className="select"
            value={form.account_id}
            onChange={(e) => setForm((p) => ({ ...p, account_id: e.target.value }))}
            required
          >
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type})
              </option>
            ))}
          </select>
          <input
            type="date"
            className="input"
            value={form.investment_date}
            onChange={(e) => setForm((p) => ({ ...p, investment_date: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.01"
            className="input"
            placeholder="Amount"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            required
          />
          <select
            className="select"
            value={form.kind}
            onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value as 'adhoc' | 'recurring' }))}
          >
            <option value="adhoc">Adhoc</option>
            <option value="recurring">Recurring</option>
          </select>
          <input
            type="text"
            className="input"
            placeholder="Note (optional)"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />
          {duplicateWarning ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-sm text-amber-900">
                {duplicateWarning}. Adding it again would count the same money twice.
              </p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => saveInvestment(true)} disabled={saving}>
                It&apos;s a different deposit — add anyway
              </button>
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowAddModal(false);
                setDuplicateWarning(null);
              }}
              disabled={saving}
            >
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Adding...' : 'Add Investment'}
            </button>
          </div>
        </form>
      </Modal>

      <InvestmentDetailModal
        investment={selectedInvestment}
        isOpen={!!selectedInvestment}
        accounts={accounts}
        onClose={() => setSelectedInvestment(null)}
        onSuccess={() => {
          void fetchAll({ includeReport: true, month: selectedMonth });
        }}
      />

      <Modal
        isOpen={!!filterModal}
        onClose={() => setFilterModal(null)}
        maxWidth="lg"
        title={
          <div className="min-w-0">
            <div className="text-lg font-bold text-gray-900 truncate">{filterModal?.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {filterModal?.type === 'account' ? 'Account' : 'Category'} · {filteredRows.length} investment
              {filteredRows.length !== 1 ? 's' : ''} · {formatCurrency(filteredTotal)}
            </div>
          </div>
        }
      >
        {filteredRows.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">No matching investments in this month.</div>
        ) : (
          <div className="space-y-4">
            {Object.entries(filteredGroupedRows)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([date, dayRows]) => {
                const dayTotal = dayRows.reduce((sum, row) => sum + row.amount, 0);
                return (
                  <div key={date}>
                    <div className="flex items-center mb-2 pb-2 border-b-2 border-gray-200">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900">
                          {new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        <p className="text-xs text-gray-500">
                          {dayRows.length} investment{dayRows.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <p className="text-base font-bold text-primary-900">{formatCurrency(dayTotal)}</p>
                    </div>
                    <div className="space-y-2">
                      {dayRows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          className="w-full text-left rounded-lg border border-gray-100 p-3 flex items-start justify-between gap-3 hover:bg-gray-50 transition-colors"
                          onClick={() => {
                            const investment = investmentById.get(row.id);
                            if (investment) {
                              setFilterModal(null);
                              setSelectedInvestment(investment);
                            }
                          }}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{row.accountName}</p>
                            <p className="text-xs text-gray-500">
                              {row.kind === 'sip_auto'
                                ? 'SIP (recurring)'
                                : row.kind === 'auto_recurring'
                                ? 'Recurring'
                                : row.kind}
                              {row.note ? ` · ${row.note}` : ''}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold text-gray-900">{formatCurrency(row.amount)}</p>
                            {(() => {
                              const badge = getInvestmentBadge(row.kind);
                              return <span className={`text-[11px] font-medium ${badge.className}`}>{badge.label}</span>;
                            })()}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
