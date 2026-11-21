'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { MonthNavigator } from '@/components/MonthNavigator';
import ConfirmDialog from '@/components/ConfirmDialog';
import { formatCurrency } from '@/lib/utils';
import Modal from '@/components/Modal';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { monthKeys } from '@/lib/utils/dateUtils';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ExpandableChart } from '@/components/charts/ExpandableChart';
import { useToast } from '@/lib/useToast';

// ─── Types ────────────────────────────────────────────────────────────────────

type Statement = {
  id: string;
  account_id: string;
  statement_date: string;
  due_date: string;
  period_start: string;
  period_end: string;
  statement_amount: number;
  paid_amount: number;
  pending_amount: number;
  status: 'paid' | 'pending' | 'overdue';
  due_in_days: number;
  credit_card_payments: { id: string; payment_date: string; amount: number }[];
};

type CardData = {
  account: {
    id: string;
    name: string;
    billing_day: number | null;
    due_day: number | null;
    billing_date_raw: string;
    due_date_raw: string;
  };
  current_month_key: string;
  expected: { statement_date: string | null; due_date: string | null };
  current_statement: Statement | null;
  latest_statement: Statement | null;
  all_statements: Statement[];
  can_add_statement: boolean;
  flags: { statement_ready: boolean; due_soon: boolean; overdue: boolean };
  status: string;
};

type HistoryPoint = { month: string; total: number; paid: number; pending: number };

type OverviewResp = {
  month: { key: string };
  totals: { statement_total: number; pending_total: number };
  cards: CardData[];
  history: HistoryPoint[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMonth(key: string) {
  try { return format(parseISO(key + '-01'), 'MMMM yyyy'); } catch { return key; }
}

function fmtMonthShort(key: string) {
  try { return format(parseISO(key + '-01'), 'MMM yy'); } catch { return key; }
}

function statusBadge(status: string): string {
  if (status === 'paid') return 'bg-emerald-100 text-emerald-700';
  if (status === 'overdue') return 'bg-red-100 text-red-700';
  if (status === 'due_soon') return 'bg-amber-100 text-amber-700';
  if (status === 'need_statement') return 'bg-blue-100 text-blue-700';
  if (status === 'pending') return 'bg-orange-100 text-orange-700';
  return 'bg-gray-100 text-gray-500';
}

function statusLabel(status: string): string {
  if (status === 'paid') return 'Paid';
  if (status === 'overdue') return 'Overdue';
  if (status === 'due_soon') return 'Due soon';
  if (status === 'need_statement') return 'Enter statement';
  if (status === 'pending') return 'Pending';
  return 'No statement';
}

function fmtShort(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}k`;
  return `₹${v.toFixed(0)}`;
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function SpendChart({ data, height = 140, color = '#6366f1', title = 'Monthly spend' }: {
  data: HistoryPoint[];
  height?: number;
  color?: string;
  title?: string;
}) {
  if (data.length < 2) return null;

  // Calculate median
  const totals = data.map(d => d.total).filter(v => v > 0).sort((a, b) => a - b);
  const median = totals.length > 0
    ? totals.length % 2 === 0
      ? (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
      : totals[Math.floor(totals.length / 2)]
    : 0;

  return (
    <ExpandableChart title={title} height={height} expandedHeight={560} overlayButton>
      {() => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="month"
              tickFormatter={fmtMonthShort}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={fmtShort}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip
              formatter={(v: number) => [formatCurrency(v), 'Amount']}
              labelFormatter={(l) => { try { return format(parseISO(l + '-01'), 'MMM yyyy'); } catch { return l; } }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
            <Line type="monotone" dataKey="total" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            {median > 0 && (
              <ReferenceLine
                y={median}
                stroke="#9ca3af"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                label={{
                  value: `Median: ${formatCurrency(median)}`,
                  position: 'insideTopRight',
                  fill: '#6b7280',
                  fontSize: 9,
                  fontWeight: 500,
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ExpandableChart>
  );
}

// ─── Card detail panel ────────────────────────────────────────────────────────
// All add / edit / mark-paid interactions live here.

function CardDetailPanel({ card, selectedMonth, onRefresh }: {
  card: CardData;
  selectedMonth: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const s = card.current_statement;
  const stmts = [...card.all_statements].sort((a, b) => a.statement_date.localeCompare(b.statement_date));
  const chartData: HistoryPoint[] = stmts.map((x) => ({
    month: x.statement_date.slice(0, 7),
    total: Number(x.statement_amount),
    paid: Number(x.paid_amount),
    pending: Number(x.pending_amount),
  }));

  // ── local state for forms ──
  const [mode, setMode] = useState<'view' | 'add' | 'edit'>('view');
  const [stmtAmount, setStmtAmount] = useState('');
  const [editValues, setEditValues] = useState({ statement_amount: '', amount_paid: '' });
  const [partialAmount, setPartialAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const formIdPrefix = `cc-statement-${card.account.id}`;

  // Detect duplicate statements per billing month
  const stmtsByMonth = stmts.reduce<Record<string, typeof stmts>>((acc, x) => {
    const mk = x.statement_date.slice(0, 7);
    acc[mk] = acc[mk] ?? [];
    acc[mk].push(x);
    return acc;
  }, {});
  const hasDuplicates = Object.values(stmtsByMonth).some((g) => g.length > 1);

  // Reset form state when the card or month changes
  useEffect(() => { setMode('view'); setStmtAmount(''); }, [card.account.id, selectedMonth]);

  // Use API-computed flag: true when billing date has passed and no statement for this cycle yet
  const canAdd = card.can_add_statement && !!card.expected.statement_date && !!card.expected.due_date;
  // Cross-month: statement billed in a previous month shown here for payment — disallow edit
  const isCrossMonthDue = !!s && s.statement_date.slice(0, 7) !== selectedMonth;

  const startEdit = () => {
    if (!s) return;
    setEditValues({ statement_amount: String(s.statement_amount), amount_paid: String(s.paid_amount) });
    setMode('edit');
  };

  const saveAdd = async () => {
    if (stmtAmount === '') return;
    const amt = Number(stmtAmount);
    if (isNaN(amt) || amt < 0) return;
    setFormError(null);
    setSaving(true);
    try {
      const sd = parseISO(card.expected.statement_date!);
      const billingDay = card.account.billing_day ?? sd.getDate();
      const res = await fetch('/api/credit-cards/statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: card.account.id,
          statement_date: card.expected.statement_date,
          due_date: card.expected.due_date,
          period_start: format(new Date(sd.getFullYear(), sd.getMonth() - 1, billingDay + 1), 'yyyy-MM-dd'),
          period_end: card.expected.statement_date,
          statement_amount: amt,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to save');
      }
      setStmtAmount('');
      setMode('view');
      onRefresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const res = await fetch('/api/credit-cards/statements', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: s.id,
          statement_amount: Number(editValues.statement_amount),
          amount_paid: Number(editValues.amount_paid),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setMode('view');
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const deleteStatement = async () => {
    if (!pendingDeleteId) return;
    setDeletingId(pendingDeleteId);
    try {
      const res = await fetch(`/api/credit-cards/statements?id=${pendingDeleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      onRefresh();
    } catch {
      setFormError('Failed to delete statement');
    } finally {
      setDeletingId(null);
      setPendingDeleteId(null);
    }
  };

  const payAmount = async (amount: number) => {
    if (!s || amount <= 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/credit-cards/statements', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: s.id,
          amount_paid: amount,
          payment_date: format(new Date(), 'yyyy-MM-dd'),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setPartialAmount('');
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* ── Current month section ── */}
      <div className="pt-2 pb-4 border-b border-gray-100">
        <p className="text-xs font-medium text-gray-500 mb-3">{fmtMonth(selectedMonth)}</p>

        {mode === 'add' && canAdd && (
          <div className="space-y-3">
            {formError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {formError}
              </div>
            )}
            <div>
              <label htmlFor={`${formIdPrefix}-add-statement-amount`} className="label text-xs">Statement amount (₹)</label>
              <input
                id={`${formIdPrefix}-add-statement-amount`}
                name="statement_amount"
                className="input text-sm"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={stmtAmount}
                onChange={(e) => setStmtAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={saveAdd} disabled={saving}>
                {saving ? '…' : 'Save'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setMode('view'); setFormError(null); }} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === 'edit' && s && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor={`${formIdPrefix}-edit-statement-amount`} className="label text-xs">Statement amount (₹)</label>
                <input
                  id={`${formIdPrefix}-edit-statement-amount`}
                  name="statement_amount"
                  className="input text-sm"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editValues.statement_amount}
                  onChange={(e) => setEditValues((p) => ({ ...p, statement_amount: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="flex-1">
                <label htmlFor={`${formIdPrefix}-edit-amount-paid`} className="label text-xs">Amount paid (₹)</label>
                <input
                  id={`${formIdPrefix}-edit-amount-paid`}
                  name="amount_paid"
                  className="input text-sm"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editValues.amount_paid}
                  onChange={(e) => setEditValues((p) => ({ ...p, amount_paid: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                {saving ? '…' : 'Save'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setMode('view')} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === 'view' && (
          <>
            {s ? (
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xl font-bold text-gray-900">{formatCurrency(Number(s.statement_amount))}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Billed {format(parseISO(s.statement_date), 'dd MMM')}
                    {' · '}Due {format(parseISO(s.due_date), 'dd MMM')}
                    {s.paid_amount > 0 && ` · paid ${formatCurrency(s.paid_amount)}`}
                  </p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(s.status)}`}>
                  {statusLabel(s.status)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-3">
                {canAdd
                  ? `Statement not yet entered for ${fmtMonth(selectedMonth)}.`
                  : `No statement for ${fmtMonth(selectedMonth)}.`}
              </p>
            )}

            <div className="flex gap-2 flex-wrap">
              {canAdd && (
                <button className="btn btn-primary btn-sm" onClick={() => setMode('add')}>
                  Add statement
                </button>
              )}
              {s && !isCrossMonthDue && (
                <button className="btn btn-secondary btn-sm" onClick={startEdit}>
                  Edit
                </button>
              )}
              {s && s.pending_amount > 0 && (
                <div className="flex gap-2 items-center flex-wrap mt-1 w-full">
                  <label htmlFor={`${formIdPrefix}-partial-amount`} className="sr-only">
                    Partial payment amount
                  </label>
                  <input
                    id={`${formIdPrefix}-partial-amount`}
                    name="partial_amount"
                    aria-label="Partial payment amount"
                    className="input text-sm py-1.5 w-32"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Partial amt"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                  />
                  <button
                    className="btn btn-secondary btn-sm shrink-0"
                    onClick={() => {
                      const amt = Number(partialAmount);
                      if (!isNaN(amt) && amt > 0) payAmount(amt);
                    }}
                    disabled={saving || !partialAmount}
                  >
                    Pay partial
                  </button>
                  <button
                    className="btn btn-primary btn-sm shrink-0"
                    onClick={() => payAmount(Number(s.statement_amount))}
                    disabled={saving}
                  >
                    {saving ? '…' : `Pay full ${formatCurrency(s.pending_amount)}`}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Mini trend */}
      {chartData.length >= 2 && (
        <div className="pt-4 pb-2">
          <p className="text-xs font-medium text-gray-500 mb-2">Monthly spend</p>
          <SpendChart data={chartData} height={120} color="#6366f1" title={`Monthly spend — ${card.account.name}`} />
        </div>
      )}

      {/* History */}
      <div className="pb-2 mt-2">
        <p className="text-xs font-medium text-gray-500 mb-3">Statement history</p>

        {hasDuplicates && (
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            ⚠️ Duplicate statements detected for one or more months. Delete the extras below.
          </div>
        )}

        {stmts.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No statements yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {[...stmts].reverse().map((x) => {
              const mk = x.statement_date.slice(0, 7);
              const isDuplicate = (stmtsByMonth[mk]?.length ?? 0) > 1;
              return (
                <div key={x.id} className={`flex items-center gap-3 py-2.5 text-sm ${isDuplicate ? 'bg-amber-50 rounded px-1' : ''}`}>
                  <span className="w-24 shrink-0 text-gray-500 text-xs">
                    {format(parseISO(x.statement_date), 'dd MMM yyyy')}
                  </span>
                  <span className="flex-1 font-semibold text-gray-900">
                    {formatCurrency(Number(x.statement_amount))}
                  </span>
                  {Number(x.pending_amount) > 0 && (
                    <span className="text-xs text-amber-600 hidden sm:block">
                      {formatCurrency(Number(x.pending_amount))} remaining
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(x.status)}`}>
                    {statusLabel(x.status)}
                  </span>
                  {isDuplicate && (
                    <button
                      onClick={() => setPendingDeleteId(x.id)}
                      disabled={deletingId === x.id}
                      className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors disabled:opacity-40 shrink-0"
                      title="Delete duplicate"
                    >
                      {deletingId === x.id ? '…' : 'Delete'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ConfirmDialog
        isOpen={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={deleteStatement}
        title="Delete statement?"
        message="This statement record will be removed permanently."
        confirmLabel="Delete"
        variant="danger"
        isLoading={!!deletingId}
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CreditCardsPage() {
  // IST, like every other "what month is it" in the app — the navigator's own
  // ceiling is the same value, and the two must not disagree at midnight.
  const todayKey = monthKeys.current();

  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewResp | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(todayKey);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast, ToastContainer } = useToast();

  const selectedMonthRef = useRef(todayKey);

  const refresh = useCallback(async (month?: string) => {
    const m = month ?? selectedMonthRef.current;
    setError(null);
    try {
      const res = await fetch(`/api/credit-cards/overview?month=${m}&t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Failed (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const handle = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', handle);
    return () => document.removeEventListener('visibilitychange', handle);
  }, [refresh]);

  /** The ref is what the in-flight `refresh` reads, so it must move with the state. */
  const selectMonth = (key: string) => {
    selectedMonthRef.current = key;
    setSelectedMonth(key);
    refresh(key);
  };

  const reload = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const cards = useMemo(() => data?.cards ?? [], [data]);
  const selectedCard = useMemo(() => cards.find((c) => c.account.id === selectedCardId) ?? null, [cards, selectedCardId]);
  const cardsNeedingSetup = useMemo(() => cards.filter((c) => !c.account.billing_day || !c.account.due_day), [cards]);

  if (initialLoading) return <LoadingSpinner message="Loading credit cards…" />;

  if (cards.length === 0) {
    return (
      <PageContainer maxWidth="4xl">
        <PageHeader title="Credit Cards" description="Monthly statements · due reminders" />
        <EmptyState
          icon="💳"
          title="No credit cards yet"
          description='Create a Selvam account with type "Credit Card" to see it here.'
        />
        <div className="text-center mt-4">
          <Link href="/portfolio/accounts" className="btn btn-link btn-sm">
            Open accounts
          </Link>
        </div>
        <ToastContainer />
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="5xl">
      <PageHeader
        title="Credit Cards"
        description="Monthly statements · due reminders"
        action={
          <button
            onClick={reload}
            disabled={refreshing}
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
            title="Refresh"
          >
            <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {error && (
        <div className="card p-4 mb-6 border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {/* Trend chart */}
      {(data?.history ?? []).length >= 2 && (
        <div className="card mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">Monthly spend — all cards</p>
          <SpendChart data={data!.history} height={160} color="#6366f1" title="Monthly spend — all cards" />
        </div>
      )}

      {/* Month navigator */}
      <MonthNavigator
        className="mb-6"
        value={selectedMonth}
        onChange={selectMonth}
        ariaLabel="Statement month"
      />

      {/* Month summary banner */}
      {(data?.totals.statement_total ?? 0) > 0 && (
        <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-100 p-5 mb-6">
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wider mb-1">
            {fmtMonth(selectedMonth)} total
          </p>
          <p className="text-3xl font-bold tracking-tight text-gray-900 mb-1">
            {formatCurrency(data!.totals.statement_total)}
          </p>
          {(data?.totals.pending_total ?? 0) > 0 && (
            <p className="text-sm font-semibold text-amber-600">
              {formatCurrency(data!.totals.pending_total)} pending
            </p>
          )}
        </div>
      )}

      {/* Setup banner */}
      {cardsNeedingSetup.length > 0 && (
        <div className="card p-4 mb-6 border border-amber-200 bg-amber-50">
          <p className="text-sm font-semibold text-amber-800 mb-1">Setup needed</p>
          <p className="text-xs text-amber-700 mb-2">Add billing &amp; due day for these cards in Accounts.</p>
          <div className="flex flex-wrap gap-3">
            {cardsNeedingSetup.map((c) => (
              <Link
                key={c.account.id}
                href={`/portfolio/settings/accounts/${c.account.id}`}
                className="text-xs text-amber-700 hover:text-amber-900 hover:underline font-medium"
              >
                → {c.account.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Card list */}
      <div className="space-y-3">
        {cards.map((c) => {
            const s = c.current_statement;
            const isSelected = c.account.id === selectedCardId;
            const displayStatus = c.flags.overdue ? 'overdue'
              : c.flags.due_soon ? 'due_soon'
              : s?.status ?? 'no_statement';

            return (
              <div
                key={c.account.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedCardId(isSelected ? null : c.account.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedCardId(isSelected ? null : c.account.id); }}
                className={`w-full text-left card p-4 transition-all cursor-pointer card-hover ${isSelected ? 'ring-2 ring-indigo-400' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{c.account.name}</span>
                      {c.all_statements.length > 0 && (
                        <span className="text-[10px] text-gray-400">
                          {c.all_statements.length} stmt{c.all_statements.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Bill {c.account.billing_date_raw || '—'} · Due {c.account.due_date_raw || '—'}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    {s ? (
                      <>
                        <p className="font-bold text-gray-900 text-sm">{formatCurrency(Number(s.statement_amount))}</p>
                        <p className="text-xs text-gray-500">Due {format(parseISO(s.due_date), 'dd MMM')}</p>
                      </>
                    ) : c.latest_statement ? (
                      <>
                        <p className="text-sm text-gray-400">{formatCurrency(Number(c.latest_statement.statement_amount))}</p>
                        <p className="text-[10px] text-gray-400">
                          last {format(parseISO(c.latest_statement.statement_date), 'dd MMM yy')}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">—</p>
                    )}
                  </div>

                  <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(displayStatus)}`}>
                    {statusLabel(displayStatus)}
                  </span>
                </div>
              </div>
            );
          })}
      </div>

      {/* ── Detail modal ── */}
      <Modal
        isOpen={!!selectedCard}
        onClose={() => setSelectedCardId(null)}
        maxWidth="lg"
        title={selectedCard ? (
          <div>
            <div className="font-semibold text-gray-900">{selectedCard.account.name}</div>
            <div className="text-sm text-gray-500 font-normal mt-0.5">
              Bill {selectedCard.account.billing_date_raw || '—'} · Due {selectedCard.account.due_date_raw || '—'}
              {selectedCard.all_statements.length > 0 && ` · ${selectedCard.all_statements.length} statements`}
            </div>
          </div>
        ) : ''}
      >
        {selectedCard && (
          <CardDetailPanel
            card={selectedCard}
            selectedMonth={selectedMonth}
            onClose={() => setSelectedCardId(null)}
            onRefresh={refresh}
          />
        )}
      </Modal>

      <ToastContainer />
    </PageContainer>
  );
}
