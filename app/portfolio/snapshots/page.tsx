'use client';

import { useState, useEffect, useMemo } from 'react';
import { formatCurrency, formatCompactCurrency } from '@/lib/utils';
import { PortfolioAccount, PortfolioSnapshot } from '@/types';
import { format, parseISO, subMonths } from 'date-fns';
import { monthKeys } from '@/lib/utils/dateUtils';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { MonthNavigator } from '@/components/MonthNavigator';
import Toast from '@/components/Toast';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ModalRecordActions } from '@/components/ModalRecordActions';
import { SegmentedControl } from '@/components/SegmentedControl';
import { findStaleAccounts } from '@/lib/portfolio/staleness';
import { latestRowPerAccountMonth } from '@/lib/portfolio/monthlySnapshots';
import { statementLabel, type LateStatement } from '@/lib/inbox/statementCadence';
import { MailX, Snowflake, Landmark, CircleCheck } from 'lucide-react';

/** recorded = a value saved for this month; carried = last known value shown in its place. */
type RowStatus = 'recorded' | 'carried' | 'missing';

const STATUS_DOT: Record<RowStatus, string> = {
  recorded: 'bg-emerald-500',
  carried: 'bg-amber-400',
  missing: 'bg-gray-300',
};

interface SnapshotModalData {
  account: PortfolioAccount;
  month: string; // yyyy-MM format
  existingSnapshot: PortfolioSnapshot | null;
  previousSnapshot: PortfolioSnapshot | null;
}

export default function PortfolioSnapshotsPage() {
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeys.current());
  const [modalData, setModalData] = useState<SnapshotModalData | null>(null);

  // Modal form state
  const [amount, setAmount] = useState('');
  const [units, setUnits] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingAllCards, setSyncingAllCards] = useState(false);
  const [filter, setFilter] = useState<'all' | 'todo' | 'recorded'>('all');
  const [showStale, setShowStale] = useState(false);
  const [lateStatements, setLateStatements] = useState<LateStatement[]>([]);

  // Statements are what fill this page on their own; one that stopped arriving left it
  // silently empty (Oct 2026). Separate from fetchData: the page never waits on it, and
  // a failure only means no banner.
  useEffect(() => {
    fetch('/api/inbox/late-statements')
      .then((res) => (res.ok ? res.json() : { late: [] }))
      .then((body) => setLateStatements(Array.isArray(body.late) ? body.late : []))
      .catch(() => setLateStatements([]));
  }, []);

  /**
   * `loading` swaps the entire page for a spinner, so refetching after every write
   * blanked the page and rebuilt it — losing scroll position on each save. Only the
   * first load does that now; refreshes after a write are silent, with a small
   * "Updating…" marker in the header instead.
   */
  const fetchData = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [ar, sr] = await Promise.all([
        fetch('/api/portfolio/accounts'),
        fetch('/api/portfolio/snapshots'),
      ]);
      const ad = await ar.json();
      const sd = await sr.json();
      setAccounts(Array.isArray(ad) ? ad.filter((a: PortfolioAccount) => a.is_active !== false) : []);
      setSnapshots(Array.isArray(sd) ? sd : []);
    } catch {
      // A failed silent refresh must not wipe what is already on screen.
      if (!silent) {
        setAccounts([]);
        setSnapshots([]);
      }
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount
    fetchData();
  }, []);

  const openModal = (account: PortfolioAccount) => {
    const monthDate = `${selectedMonth}-01`;

    const existingSnapshot = getSnapshotForMonth(account.id, selectedMonth);

    const previousSnapshot = snapshots
      .filter(s => s.account_id === account.id && s.snapshot_date < monthDate)
      .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0] || null;

    // Pre-fill form
    if (existingSnapshot) {
      if (account.multiplier) {
        setUnits(existingSnapshot.units?.toString() || '');
        setPrice(existingSnapshot.units && existingSnapshot.units > 0
          ? (existingSnapshot.amount / existingSnapshot.units).toFixed(6)
          : account.multiplier.toString());
        setAmount('');
      } else {
        setAmount(existingSnapshot.amount.toString());
        setUnits('');
        setPrice('');
      }
    } else if (previousSnapshot) {
      if (account.multiplier) {
        setUnits(previousSnapshot.units?.toString() || '');
        setPrice(previousSnapshot.units && previousSnapshot.units > 0
          ? (previousSnapshot.amount / previousSnapshot.units).toFixed(6)
          : account.multiplier.toString());
        setAmount('');
      } else {
        setAmount(previousSnapshot.amount.toString());
        setUnits('');
        setPrice('');
      }
    } else {
      setAmount('');
      setUnits('');
      setPrice(account.multiplier?.toString() || '');
    }

    setModalData({ account, month: selectedMonth, existingSnapshot, previousSnapshot });
  };

  const closeModal = () => {
    setModalData(null);
    setAmount('');
    setUnits('');
    setPrice('');
    setShowDeleteConfirm(false);
  };


  const handleSave = async () => {
    if (!modalData) return;

    const { account, month } = modalData;
    const snapshotDate = `${month}-01`;

    let finalAmount: number;
    let finalUnits: number | null = null;

    if (account.multiplier) {
      const u = parseFloat(units);
      const p = parseFloat(price);
      if (isNaN(u) || isNaN(p)) {
        setToast({ message: 'Please enter valid units and price', type: 'error' });
        return;
      }
      finalAmount = u * p;
      finalUnits = u;
    } else {
      const a = parseFloat(amount);
      if (isNaN(a)) {
        setToast({ message: 'Please enter a valid amount', type: 'error' });
        return;
      }
      finalAmount = a;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/portfolio/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: account.id,
          snapshot_date: snapshotDate,
          amount: finalAmount,
          units: finalUnits,
        }),
      });

      if (!response.ok) throw new Error('Failed to save');

      await fetchData({ silent: true });
      setToast({ message: 'Snapshot saved successfully!', type: 'success' });
      closeModal();
    } catch {
      setToast({ message: 'Failed to save snapshot', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!modalData?.existingSnapshot) return;

    try {
      const response = await fetch(`/api/portfolio/snapshots?id=${modalData.existingSnapshot.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete');

      await fetchData({ silent: true });
      setToast({ message: 'Snapshot deleted', type: 'success' });
      closeModal();
    } catch {
      setToast({ message: 'Failed to delete snapshot', type: 'error' });
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleCopyPreviousMonth = async () => {
    const monthDate = `${selectedMonth}-01`;

    // Find all accounts without current month snapshot but with previous data
    const accountsToCopy = accounts.filter(account => {
      const hasActual = getSnapshotForMonth(account.id, selectedMonth);
      if (hasActual) return false;
      const previous = getPreviousSnapshotForAccount(account.id);
      return previous !== null;
    });

    if (accountsToCopy.length === 0) {
      setToast({ message: 'No previous values to copy', type: 'error' });
      return;
    }

    setSaving(true);
    setShowCopyConfirm(false);
    try {
      await Promise.all(
        accountsToCopy.map(account => {
          const previous = getPreviousSnapshotForAccount(account.id);
          if (!previous) return Promise.resolve();

          return fetch('/api/portfolio/snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_id: account.id,
              snapshot_date: monthDate,
              amount: previous.amount,
              units: previous.units,
            }),
          });
        })
      );

      await fetchData({ silent: true });
      setToast({
        message: `Auto-filled ${accountsToCopy.length} account${accountsToCopy.length !== 1 ? 's' : ''} from previous month`,
        type: 'success'
      });
    } catch {
      setToast({ message: 'Failed to auto-fill snapshots', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const getPreviousSnapshotForAccount = (accountId: string) => {
    const monthDate = `${selectedMonth}-01`;
    return snapshots
      .filter(s => s.account_id === accountId && s.snapshot_date < monthDate)
      .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0] || null;
  };

  const prevMonthKey = format(subMonths(parseISO(selectedMonth + '-01'), 1), 'yyyy-MM');

  // Latest row within the month wins. Matching only `${monthKey}-01` meant a
  // mid-month snapshot was invisible here: an account with rows on both the 1st and the
  // 27th showed the value from the 1st, and an account whose only row that month was
  // mid-month read as "never recorded".
  const rowsByAccountMonth = useMemo(() => latestRowPerAccountMonth(snapshots), [snapshots]);

  const getSnapshotForMonth = (accountId: string, monthKey: string) =>
    rowsByAccountMonth.get(accountId)?.get(monthKey) ?? null;

  const getPreviousSnapshotBeforeMonth = (accountId: string, monthKey: string) => {
    const monthDate = `${monthKey}-01`;
    return snapshots
      .filter(s => s.account_id === accountId && s.snapshot_date < monthDate)
      .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0] || null;
  };

  const getEffectiveValueForMonth = (
    monthKey: string,
    accountId: string,
  ): { amount: number; isActual: boolean; hasData: boolean; sourceMonthKey: string | null; snapshot: PortfolioSnapshot | null } => {
    const current = getSnapshotForMonth(accountId, monthKey);
    if (current) return { amount: current.amount, isActual: true, hasData: true, sourceMonthKey: monthKey, snapshot: current };

    const previous = getPreviousSnapshotBeforeMonth(accountId, monthKey);
    if (previous) return { amount: previous.amount, isActual: false, hasData: true, sourceMonthKey: String(previous.snapshot_date).slice(0, 7), snapshot: previous };

    return { amount: 0, isActual: false, hasData: false, sourceMonthKey: null, snapshot: null };
  };

  const [goldRateInput, setGoldRateInput] = useState('');
  const [pendingGoldSync, setPendingGoldSync] = useState<{ accountId: string; total_grams: number } | null>(null);

  const syncPhysicalGold = async (accountId: string) => {
    setSyncingId(accountId);
    try {
      const [summaryRes, rateRes] = await Promise.all([
        fetch('/api/portfolio/gold/physical-summary'),
        fetch('/api/portfolio/gold-rate'),
      ]);
      const { total_grams } = await summaryRes.json();
      const { rate_22k } = await rateRes.json();
      const rate = rate_22k;

      if (!rate) {
        setSyncingId(null);
        setPendingGoldSync({ accountId, total_grams });
        setGoldRateInput('');
        return;
      }
      if (!total_grams) {
        setToast({ message: 'No physical gold items found', type: 'error' });
        return;
      }

      const amount = Math.round(total_grams * rate);
      const snapshotRes = await fetch('/api/portfolio/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          snapshot_date: `${selectedMonth}-01`,
          amount,
          units: total_grams,
        }),
      });
      if (!snapshotRes.ok) throw new Error('Failed to save snapshot');
      await fetchData({ silent: true });
      setToast({ message: `Synced ${total_grams.toFixed(3)}g × ₹${rate}/g = ₹${amount.toLocaleString('en-IN')}`, type: 'success' });
    } catch {
      setToast({ message: 'Sync failed', type: 'error' });
    } finally {
      setSyncingId(null);
    }
  };

  const confirmGoldSync = async () => {
    if (!pendingGoldSync) return;
    const rate = parseFloat(goldRateInput);
    if (isNaN(rate) || rate <= 0) return;
    const { accountId, total_grams } = pendingGoldSync;
    setSyncingId(accountId);
    setPendingGoldSync(null);
    try {
      // Save the rate for current month
      await fetch('/api/portfolio/gold-rate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate_22k: rate }),
      });
      const amount = Math.round(total_grams * rate);
      const snapshotRes = await fetch('/api/portfolio/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, snapshot_date: `${selectedMonth}-01`, amount, units: total_grams }),
      });
      if (!snapshotRes.ok) throw new Error();
      await fetchData({ silent: true });
      setToast({ message: `Synced ${total_grams.toFixed(3)}g × ₹${rate}/g = ₹${amount.toLocaleString('en-IN')}`, type: 'success' });
    } catch {
      setToast({ message: 'Sync failed', type: 'error' });
    } finally {
      setSyncingId(null);
    }
  };

  const syncAllCreditCards = async () => {
    setSyncingAllCards(true);
    try {
      // One request for every active card — see POST /api/credit-cards/sync-snapshot.
      const res = await fetch('/api/credit-cards/sync-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body?.error ?? 'Sync failed', type: 'error' });
        return;
      }

      await fetchData({ silent: true });

      const synced: Array<{ carried_forward: boolean }> = body.synced ?? [];
      const skipped: Array<{ name: string }> = body.skipped ?? [];
      const carried = synced.filter((c) => c.carried_forward).length;

      if (synced.length === 0) {
        setToast({ message: 'No statements found for any card', type: 'error' });
        return;
      }

      setToast({
        message:
          `Synced ${synced.length} card${synced.length === 1 ? '' : 's'}` +
          (carried > 0 ? ` — ${carried} from an earlier statement` : '') +
          (skipped.length > 0 ? `; no statement for ${skipped.map((c) => c.name).join(', ')}` : ''),
        type: 'success',
      });
    } catch {
      setToast({ message: 'Sync failed', type: 'error' });
    } finally {
      setSyncingAllCards(false);
    }
  };


  // Accounts sitting at the same balance for months. The `stale-snapshots` insight
  // already knows this, but it says so on /portfolio/insights — this is the page where
  // it can actually be fixed, so surface it here too.
  const staleAccounts = useMemo(
    () => findStaleAccounts({ accounts, snapshots, asOfMonth: selectedMonth }),
    [accounts, snapshots, selectedMonth]
  );

  /**
   * One row per account, built once and reused by the summary, the filter counts and
   * the list — the three used to recompute the same effective values independently.
   */
  const rows = useMemo(() => {
    return accounts.map((account) => {
      const currentEff = getEffectiveValueForMonth(selectedMonth, account.id);
      const prevEff = getEffectiveValueForMonth(prevMonthKey, account.id);
      const hasActual = !!getSnapshotForMonth(account.id, selectedMonth);
      const status: RowStatus = hasActual ? 'recorded' : currentEff.hasData ? 'carried' : 'missing';
      return {
        account,
        currentEff,
        prevEff,
        diff: prevEff.hasData ? currentEff.amount - prevEff.amount : null,
        status,
        isCreditCard: account.type === 'Credit Card',
        isPhysicalGold: account.type === 'GOLD' && account.name === 'Physical Gold',
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, snapshots, selectedMonth, prevMonthKey]);

  const totalValue = rows.reduce((sum, r) => sum + (r.currentEff.hasData ? r.currentEff.amount : 0), 0);
  const prevMonthTotalValue = rows.reduce((sum, r) => sum + (r.prevEff.hasData ? r.prevEff.amount : 0), 0);
  const totalDiff = totalValue - prevMonthTotalValue;

  const goldAccount = accounts.find((a) => a.type === 'GOLD' && a.name === 'Physical Gold') ?? null;

  const recordedCount = rows.filter((r) => r.status === 'recorded').length;
  const carriedCount = rows.filter((r) => r.status === 'carried').length;
  const missingCount = rows.filter((r) => r.status === 'missing').length;
  const todoCount = carriedCount + missingCount;

  // Group totals come from every row, not the filtered ones: a group's value is a fact
  // about the portfolio, and showing a partial sum under a filter would just be wrong.
  const groups = useMemo(() => {
    const isVisible = (status: RowStatus) =>
      filter === 'all' ? true : filter === 'todo' ? status !== 'recorded' : status === 'recorded';

    const byType = new Map<string, { shown: typeof rows; total: number; prevTotal: number; count: number }>();
    for (const row of rows) {
      const entry = byType.get(row.account.type) ?? { shown: [], total: 0, prevTotal: 0, count: 0 };
      entry.total += row.currentEff.hasData ? row.currentEff.amount : 0;
      entry.prevTotal += row.prevEff.hasData ? row.prevEff.amount : 0;
      entry.count += 1;
      if (isVisible(row.status)) entry.shown.push(row);
      byType.set(row.account.type, entry);
    }
    return Array.from(byType.entries()).filter(([, entry]) => entry.shown.length > 0);
  }, [rows, filter]);

  if (loading) return <LoadingSpinner message="Loading accounts..." />;

  const pct = (n: number) => (accounts.length ? (n / accounts.length) * 100 : 0);

  return (
    <PageContainer maxWidth="4xl">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <PageHeader title="Snapshots" />

      {/*
        Month, total and progress used to be three stacked blocks that reported the same
        counts three times, followed by two competing amber banners. One card now says
        what month it is, what it adds up to, and how much of the month is left to do.
      */}
      <div className="card mb-4 p-4 sm:p-5">
        <MonthNavigator value={selectedMonth} onChange={setSelectedMonth} ariaLabel="Snapshot month" />

        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Net worth
              {refreshing && <span className="ml-2 normal-case tracking-normal text-primary-600">Updating…</span>}
            </p>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">
              {formatCurrency(totalValue)}
            </p>
          </div>
          {prevMonthTotalValue !== 0 && (
            <p
              className={`text-sm font-semibold tabular-nums ${
                totalDiff > 0 ? 'text-emerald-600' : totalDiff < 0 ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {totalDiff > 0 ? '▲' : totalDiff < 0 ? '▼' : '—'} {formatCompactCurrency(Math.abs(totalDiff))}
              <span className="ml-1 font-normal text-gray-400">
                vs {format(parseISO(`${prevMonthKey}-01`), 'MMM')}
              </span>
            </p>
          )}
        </div>

        {accounts.length > 0 && (
          <div className="mt-4">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
              <div className="bg-emerald-500" style={{ width: `${pct(recordedCount)}%` }} />
              <div className="bg-amber-400" style={{ width: `${pct(carriedCount)}%` }} />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              <span className="font-semibold text-gray-900">{recordedCount} of {accounts.length}</span> recorded
              for {format(parseISO(`${selectedMonth}-01`), 'MMMM')}
              {carriedCount > 0 && <> · {carriedCount} carried forward</>}
              {missingCount > 0 && <> · {missingCount} never recorded</>}
            </p>

            {carriedCount > 0 && (
              <button
                onClick={() => setShowCopyConfirm(true)}
                disabled={saving}
                className="btn btn-secondary btn-sm mt-3 disabled:opacity-40"
              >
                {saving ? 'Saving…' : `Carry ${carriedCount} forward into ${format(parseISO(`${selectedMonth}-01`), 'MMM')}`}
              </button>
            )}
          </div>
        )}
      </div>

      {lateStatements.length > 0 && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="flex items-center gap-2 text-xs text-rose-900">
            <MailX size={16} className="flex-shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">
                {lateStatements.length} statement{lateStatements.length === 1 ? '' : 's'} not received
              </span>{' '}
              — the accounts they update stay carried forward until they arrive.
            </span>
          </p>
          <ul className="mt-2 space-y-1.5 border-t border-rose-200/70 pt-2">
            {lateStatements.map((s) => (
              <li key={`${s.owner}:${s.source}`} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate font-medium text-rose-900">
                  {statementLabel(s)} · <span className="capitalize">{s.owner}</span>
                </span>
                <span className="shrink-0 tabular-nums text-rose-800/80">
                  due {format(parseISO(s.expectedBy), 'd MMM')} · last {format(parseISO(s.lastReceived), 'd MMM')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Collapsed by default. Expanded it can run to eleven rows, which pushed the list
        this page exists for below the fold on a phone.
      */}
      {staleAccounts.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50">
          <button
            onClick={() => setShowStale((open) => !open)}
            aria-expanded={showStale}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <Snowflake size={16} className="flex-shrink-0 text-amber-900" aria-hidden />
            <span className="min-w-0 flex-1 text-xs text-amber-900">
              <span className="font-semibold">{staleAccounts.length} accounts</span> unchanged for 3+ months ·{' '}
              {formatCompactCurrency(staleAccounts.reduce((sum, a) => sum + Math.abs(a.amount), 0))}
            </span>
            <span aria-hidden className={`text-amber-500 transition-transform ${showStale ? 'rotate-90' : ''}`}>›</span>
          </button>

          {showStale && (
            <ul className="space-y-1.5 border-t border-amber-200/70 px-4 py-3">
              {staleAccounts.map((a) => (
                <li key={a.accountId} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-amber-900">{a.name}</span>
                  <span className="shrink-0 tabular-nums text-amber-800/80">
                    {formatCompactCurrency(Math.abs(a.amount))} · since{' '}
                    {format(parseISO(`${a.since}-01`), 'MMM yyyy')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="card py-16 text-center">
          <Landmark size={20} className="mx-auto mb-3 text-gray-400" aria-hidden />
          <p className="mb-1 font-semibold text-gray-900">No accounts yet</p>
          <p className="mb-5 text-sm text-gray-500">Create accounts before recording snapshots.</p>
          <a href="/portfolio/settings" className="btn btn-primary btn-sm">Go to Settings</a>
        </div>
      ) : (
        <>
          {/* Recording a month is a chore across 37 accounts; being able to see only
              what is left is the difference between finishing it and losing your place. */}
          <div className="mb-4">
            <SegmentedControl
              value={filter}
              onChange={setFilter}
              ariaLabel="Filter accounts"
              fullWidth
              options={[
                { value: 'all', label: `All ${accounts.length}` },
                { value: 'todo', label: `To do ${todoCount}` },
                { value: 'recorded', label: `Done ${recordedCount}` },
              ]}
            />
          </div>

          {groups.length === 0 ? (
            <div className="card py-12 text-center">
              <CircleCheck size={20} className="mx-auto mb-2 text-green-600" aria-hidden />
              <p className="font-semibold text-gray-900">
                {filter === 'todo' ? 'Nothing left for this month' : 'Nothing recorded yet'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {filter === 'todo'
                  ? `All ${accounts.length} accounts have a value for ${format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}.`
                  : 'Tap an account under “To do” to record its balance.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map(([type, entry]) => {
                const groupDiff = entry.total - entry.prevTotal;
                return (
                  <section key={type}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
                      <h2 className="min-w-0 truncate text-[11px] font-bold uppercase tracking-widest text-gray-400">
                        {type}
                        {/* Only worth saying when the filter is actually hiding something. */}
                        {entry.shown.length !== entry.count && (
                          <span className="ml-2 font-medium normal-case tracking-normal text-gray-400">
                            {entry.shown.length} of {entry.count}
                          </span>
                        )}
                      </h2>

                      <div className="flex flex-shrink-0 items-center gap-3">
                        {/* Before the total, so a group with a sync action keeps its total
                            aligned with every other group's. */}
                        {type === 'Credit Card' && (
                          <button
                            onClick={syncAllCreditCards}
                            disabled={syncingAllCards}
                            className="btn btn-secondary btn-sm disabled:opacity-40"
                          >
                            {syncingAllCards ? 'Syncing…' : 'Sync all'}
                          </button>
                        )}
                        {goldAccount && type === goldAccount.type && (
                          <button
                            onClick={() => syncPhysicalGold(goldAccount.id)}
                            disabled={syncingId === goldAccount.id}
                            className="btn btn-secondary btn-sm disabled:opacity-40"
                          >
                            {syncingId === goldAccount.id ? 'Syncing…' : 'Sync gold'}
                          </button>
                        )}
                        <p className="text-xs tabular-nums text-gray-500">
                          {formatCompactCurrency(entry.total)}
                          {groupDiff !== 0 && (
                            <span className={`ml-2 font-semibold ${groupDiff > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {groupDiff > 0 ? '▲' : '▼'} {formatCompactCurrency(Math.abs(groupDiff))}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                      <div className="divide-y divide-gray-100">
                        {entry.shown.map((r) => {
                          const { account, currentEff, diff, status, isCreditCard, isPhysicalGold } = r;
                          const isSyncOnly = isCreditCard || isPhysicalGold;
                          const open = () => { if (!isSyncOnly) openModal(account); };

                          // Blank for an ordinary recorded account — the dot already says that.
                          const meta =
                            status === 'carried' && currentEff.sourceMonthKey
                              ? `carried from ${format(parseISO(`${currentEff.sourceMonthKey}-01`), 'MMM yyyy')}`
                              : status === 'missing'
                                ? 'never recorded'
                                : isCreditCard
                                  ? 'from statement'
                                  : isPhysicalGold
                                    ? 'from gold register'
                                    : account.multiplier && currentEff.snapshot?.units
                                      ? `${currentEff.snapshot.units.toLocaleString()} ${account.unit || 'units'}`
                                      : null;

                          return (
                            <div
                              key={account.id}
                              onClick={open}
                              onKeyDown={(e) => {
                                if (isSyncOnly) return;
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                              }}
                              role={isSyncOnly ? undefined : 'button'}
                              tabIndex={isSyncOnly ? undefined : 0}
                              aria-label={isSyncOnly ? undefined : `Record ${account.name} for this month`}
                              className={`flex items-center gap-3 px-4 py-2.5 transition ${
                                isSyncOnly ? '' : 'cursor-pointer hover:bg-primary-50/50'
                              }`}
                            >
                              <span
                                aria-hidden
                                className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[status]}`}
                              />

                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-gray-900">{account.name}</p>
                                {/* Only when it explains something. "recorded" under every row
                                    just restated the green dot and cost a second line each time. */}
                                {meta && <p className="mt-0.5 truncate text-[11px] text-gray-500">{meta}</p>}
                              </div>

                              <div className="flex-shrink-0 text-right">
                                <p className="font-semibold text-gray-900 tabular-nums">
                                  {currentEff.hasData ? formatCompactCurrency(currentEff.amount) : '—'}
                                </p>
                                {diff !== null && diff !== 0 && (
                                  <p
                                    className={`text-[11px] font-medium tabular-nums ${
                                      diff > 0 ? 'text-emerald-600' : 'text-red-500'
                                    }`}
                                  >
                                    {diff > 0 ? '▲' : '▼'} {formatCompactCurrency(Math.abs(diff))}
                                  </p>
                                )}
                              </div>

                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {goldAccount && type === goldAccount.type && pendingGoldSync && (
                      <div className="mt-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
                        <p className="mb-2 text-xs font-medium text-yellow-800">
                          No rate on file — enter today’s 22k rate per gram:
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            autoFocus
                            value={goldRateInput}
                            onChange={(e) => setGoldRateInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmGoldSync();
                              if (e.key === 'Escape') setPendingGoldSync(null);
                            }}
                            placeholder="₹ per gram"
                            className="input-sm flex-1 font-mono"
                          />
                          <button onClick={confirmGoldSync} className="btn btn-primary btn-sm">Save</button>
                          <button onClick={() => setPendingGoldSync(null)} className="btn btn-ghost btn-sm">Cancel</button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Modal */}
      <Modal
        isOpen={!!modalData}
        onClose={closeModal}
        title={
          modalData ? (
            <div>
              <h2 className="text-lg font-bold text-gray-900">{modalData.account.name}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {format(parseISO(modalData.month + '-01'), 'MMMM yyyy')}
              </p>
            </div>
          ) : null
        }
        footer={
          modalData ? (
            <>
              {modalData.existingSnapshot ? (
                <ModalRecordActions
                  onDelete={() => setShowDeleteConfirm(true)}
                  onEdit={handleSave}
                  editDisabled={saving || (modalData.account.multiplier ? (!units || !price) : !amount)}
                />
              ) : (
                <button
                  onClick={handleSave}
                  disabled={saving || (modalData.account.multiplier ? (!units || !price) : !amount)}
                  className="btn btn-primary disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Create'}
                </button>
              )}
            </>
          ) : null
        }
        maxWidth="md"
      >
        {modalData && (
          <div className="space-y-5">
            {/* Previous Snapshot Info */}
            {modalData.previousSnapshot && (
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Previous Snapshot</p>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    {format(parseISO(modalData.previousSnapshot.snapshot_date), 'MMMM yyyy')}
                  </p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatCurrency(modalData.previousSnapshot.amount)}
                  </p>
                </div>
                {modalData.account.multiplier && modalData.previousSnapshot.units && (
                  <p className="text-xs text-gray-500 mt-1">
                    {modalData.previousSnapshot.units.toLocaleString()} {modalData.account.unit || 'units'} × ₹
                    {(modalData.previousSnapshot.amount / modalData.previousSnapshot.units).toFixed(2)}
                  </p>
                )}
              </div>
            )}

            {/* Form */}
            {modalData.account.multiplier ? (
              <>
                {/* Units × Price */}
                <div>
                  <label htmlFor="snapshot-units-input" className="label mb-2">
                    {modalData.account.unit || 'Units'}
                  </label>
                  <input
                    id="snapshot-units-input"
                    name="units"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    placeholder="0"
                    className="input font-mono font-semibold"
                    autoFocus
                  />
                </div>

                <div>
                  <label htmlFor="snapshot-price-input" className="label mb-2">
                    Price per {modalData.account.unit || 'unit'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₹</span>
                    <input
                      id="snapshot-price-input"
                      name="unit_price"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                      className="input pl-8 font-mono font-semibold"
                    />
                  </div>
                </div>

                {/* Computed Total */}
                {units && price && !isNaN(parseFloat(units)) && !isNaN(parseFloat(price)) && (
                  <div className="rounded-xl bg-primary-50 p-4">
                    <p className="text-xs font-medium text-primary-600 mb-1">Total Value</p>
                    <p className="text-xl font-bold text-primary-900">
                      {formatCurrency(parseFloat(units) * parseFloat(price))}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Amount */}
                <div>
                  <label htmlFor="snapshot-amount-input" className="label mb-2">
                    Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₹</span>
                    <input
                      id="snapshot-amount-input"
                      name="amount"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="input pl-8 font-mono font-semibold"
                      autoFocus
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        isOpen={showCopyConfirm}
        onClose={() => setShowCopyConfirm(false)}
        onConfirm={handleCopyPreviousMonth}
        title={`Carry ${carriedCount} account${carriedCount === 1 ? '' : 's'} forward?`}
        message={`Their last known values will be saved as ${format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')} snapshots. You can edit any of them afterwards.`}
        confirmLabel="Carry forward"
      />
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete this snapshot?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </PageContainer>
  );
}
