'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import Modal from '@/components/Modal';
import { PortfolioAccount } from '@/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  applySipAmountChange,
  applySipAmountCorrection,
  describeAmountHistory,
  getSipStartMonth,
  resolveSipAmount,
  setSipStartMonth,
  type SipAmountChange,
} from '@/lib/portfolio/sipSchedule';
import { getAppMonthKey } from '@/lib/utils/dateUtils';
import { TrendingUp } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SipFund {
  name: string;
  sip_amount: number;
  sip_date: string;
  active: boolean;
  notes?: string;
  /** Where the fund is held (e.g. "Groww", "ET Money"), for accounts that combine platforms. */
  platform?: string;
  /** When each amount took effect. Absent = a flat amount for every month. */
  amount_history?: SipAmountChange[];
}

/**
 * Raising a SIP is not the same as fixing a typo. "change" keeps past months at
 * the old figure and applies the new one from a chosen month; "correct"
 * rewrites every month, which is what the form used to do unconditionally.
 */
type AmountMode = 'change' | 'correct';

const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
};

interface MfAccount extends PortfolioAccount {
  details: { funds?: SipFund[] } & Record<string, unknown>;
}

const emptyFund: SipFund = { name: '', sip_amount: 0, sip_date: '', active: true, notes: '', platform: '' };

/** A small label for where a fund is held, in accounts that combine platforms. */
function PlatformTag({ platform }: { platform: string }) {
  return (
    <span className="ml-2 inline-block rounded bg-gray-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-gray-600">
      {platform}
    </span>
  );
}

function activeSip(account: MfAccount, currentMonth: string) {
  return (account.details?.funds ?? [])
    .filter((f) => f.active)
    .reduce((s, f) => s + resolveSipAmount(f, currentMonth), 0);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SipPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<MfAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Fund management modal
  const [selectedAccount, setSelectedAccount] = useState<MfAccount | null>(null);
  const [funds, setFunds] = useState<SipFund[]>([]);
  const [editingFund, setEditingFund] = useState<{ idx: number; fund: SipFund } | null>(null);
  const [addingFund, setAddingFund] = useState(false);
  const [newFund, setNewFund] = useState<SipFund>(emptyFund);
  const [saving, setSaving] = useState(false);

  // "Today" in the app timezone — the default month for a change, and the month
  // whose amount `sip_amount` mirrors.
  const currentMonth = useMemo(() => getAppMonthKey(), []);
  const [amountMode, setAmountMode] = useState<AmountMode>('change');
  const [effectiveFrom, setEffectiveFrom] = useState(currentMonth);
  // Blank means "no start recorded" — the fund is treated as always running.
  const [startMonth, setStartMonth] = useState('');
  const [newFundStart, setNewFundStart] = useState(currentMonth);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/accounts?includeArchived=true');
      const data: PortfolioAccount[] = await res.json();
      const mf = (Array.isArray(data) ? data : []).filter(
        (a) => a.type === 'Mutual Funds'
      ) as MfAccount[];
      // Sort: active accounts first, then by name
      mf.sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setAccounts(mf);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount
  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalMonthly = accounts.reduce((s, a) => s + activeSip(a, currentMonth), 0);
  const totalFunds = accounts.flatMap((a) => a.details?.funds ?? []);
  const activeFundsCount = totalFunds.filter((f) => f.active).length;

  // ── Fund modal helpers ────────────────────────────────────────────────────
  const openAccount = (account: MfAccount) => {
    setSelectedAccount(account);
    setFunds(JSON.parse(JSON.stringify(account.details?.funds ?? [])));
    setEditingFund(null);
    setAddingFund(false);
    setNewFund(emptyFund);
    setAmountMode('change');
    setEffectiveFrom(currentMonth);
    setNewFundStart(currentMonth);
  };

  const startEditingFund = (idx: number, fund: SipFund) => {
    setEditingFund({ idx, fund: { ...fund } });
    setAmountMode('change');
    setEffectiveFrom(currentMonth);
    setStartMonth(getSipStartMonth(fund) ?? '');
  };

  const closeModal = () => {
    setSelectedAccount(null);
    setEditingFund(null);
    setAddingFund(false);
  };

  const saveFunds = async (updatedFunds: SipFund[]) => {
    if (!selectedAccount) return;
    setSaving(true);
    try {
      const res = await fetch('/api/portfolio/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedAccount.id,
          details: { ...selectedAccount.details, funds: updatedFunds },
        }),
      });
      if (res.ok) {
        await fetchAccounts();
        setFunds(updatedFunds);
        setEditingFund(null);
        setAddingFund(false);
        setNewFund(emptyFund);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEditedFund = async () => {
    if (!editingFund) return;

    const original = funds[editingFund.idx];
    const draft = editingFund.fund;
    const nextAmount = Number(draft.sip_amount);

    // Name/date/notes edit in place; only the amount is effective-dated.
    let merged: SipFund = {
      ...original,
      name: draft.name,
      sip_date: draft.sip_date,
      notes: draft.notes,
      platform: draft.platform?.trim() || undefined,
    };

    if (amountMode === 'correct') {
      merged = applySipAmountCorrection(merged, nextAmount) as SipFund;
    } else if (nextAmount !== resolveSipAmount(original, currentMonth)) {
      merged = applySipAmountChange(merged, {
        amount: nextAmount,
        fromMonth: effectiveFrom,
        currentMonth,
      }) as SipFund;
    }

    // Applied after the amount change so the change's own effective month is
    // already in the timeline and can be preserved.
    if (startMonth && startMonth !== getSipStartMonth(merged)) {
      merged = setSipStartMonth(merged, { startMonth, currentMonth }) as SipFund;
    }

    await saveFunds(funds.map((f, i) => (i === editingFund.idx ? merged : f)));
  };

  const saveNewFund = async () => {
    if (!newFund.name.trim()) return;
    // Stamp the start month so the fund does not back-fill months it never ran in.
    const fund = applySipAmountChange(
      { ...newFund, sip_amount: 0 },
      { amount: Number(newFund.sip_amount), fromMonth: newFundStart, currentMonth }
    ) as SipFund;
    await saveFunds([...funds, fund]);
  };

  const deleteFund = async (idx: number) => {
    await saveFunds(funds.filter((_, i) => i !== idx));
  };

  const toggleFundActive = async (idx: number) => {
    const updated = funds.map((f, i) => (i === idx ? { ...f, active: !f.active } : f));
    await saveFunds(updated);
  };

  if (loading) return <LoadingSpinner message="Loading SIP schedule…" />;

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="SIP schedule"
        description="Active systematic investment plans"
        action={
          <Link href="/portfolio/settings" className="btn btn-secondary text-sm">
            Manage Accounts
          </Link>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="card p-3 sm:p-4">
          <p className="text-xs text-gray-500">Accounts</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5">{accounts.filter(a => a.is_active !== false).length}</p>
        </div>
        <div className="card p-3 sm:p-4">
          <p className="text-xs text-gray-500">Active SIPs</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5">{activeFundsCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">{totalFunds.length} total funds</p>
        </div>
        <div className="card p-3 sm:p-4">
          <p className="text-xs text-gray-500">Monthly Total</p>
          <p className="text-xl sm:text-2xl font-bold text-indigo-600 mt-0.5">
            ₹{totalMonthly.toLocaleString('en-IN')}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">per month</p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No MF accounts yet"
          description="Add Mutual Fund accounts in Settings."
          action={{ label: 'Go to Settings', onClick: () => router.push('/portfolio/settings') }}
        />
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => {
            const accountFunds = account.details?.funds ?? [];
            const active = accountFunds.filter((f) => f.active);
            const stopped = accountFunds.filter((f) => !f.active);
            const monthly = activeSip(account, currentMonth);

            return (
              <div key={account.id} className="card p-0 overflow-hidden">
                {/* Account header */}
                <button
                  onClick={() => openAccount(account)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-indigo-50 hover:bg-indigo-100 transition-colors border-b border-indigo-100 text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-indigo-900">{account.name}</p>
                    {account.notes && (
                      <p className="text-xs text-indigo-500 mt-0.5">{account.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold text-indigo-700">
                        ₹{monthly.toLocaleString('en-IN')}<span className="text-indigo-400 font-normal text-xs">/mo</span>
                      </p>
                      <p className="text-xs text-indigo-400">{active.length} active SIP{active.length !== 1 ? 's' : ''}</p>
                    </div>
                    <svg className="w-4 h-4 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>

                {/* Active fund rows */}
                {active.length > 0 && (
                  <div className="divide-y divide-gray-50">
                    {active.map((fund, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 truncate">
                            {fund.name}
                            {fund.platform && <PlatformTag platform={fund.platform} />}
                          </p>
                          {fund.notes && <p className="text-xs text-gray-400">{fund.notes}</p>}
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-sm font-semibold text-gray-900">
                            ₹{Number(fund.sip_amount).toLocaleString('en-IN')}
                          </p>
                          <p className="text-xs text-gray-400">{fund.sip_date} of month</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Stopped funds (collapsed summary) */}
                {stopped.length > 0 && (
                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                    <p className="text-xs text-gray-400">
                      {stopped.length} stopped: {stopped.map((f) => f.name).join(', ')}
                    </p>
                  </div>
                )}

                {/* Subtotal */}
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between text-xs text-gray-500">
                  <span>{active.length} active fund{active.length !== 1 ? 's' : ''}</span>
                  <span className="font-semibold text-gray-700">
                    ₹{monthly.toLocaleString('en-IN')} / mo
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Fund management modal ─────────────────────────────────────────── */}
      <Modal
        isOpen={!!selectedAccount}
        onClose={closeModal}
        maxWidth="md"
        title={
          <span className="text-lg font-bold text-gray-900">{selectedAccount?.name}</span>
        }
      >
        {selectedAccount && (
          <div>
            {/* Fund list */}
            <div className="divide-y divide-gray-100 -mx-4 sm:-mx-6 mb-4">
              {funds.map((fund, idx) => (
                <div key={idx}>
                  {editingFund?.idx === idx ? (
                    /* Inline edit row */
                    <div className="px-4 sm:px-6 py-3 bg-primary-50 space-y-2">
                      <input
                        type="text" className="input text-sm" placeholder="Fund name"
                        value={editingFund.fund.name}
                        onChange={(e) => setEditingFund({ idx, fund: { ...editingFund.fund, name: e.target.value } })}
                        autoFocus
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label text-xs">SIP Amount (₹)</label>
                          <input
                            type="number" className="input text-sm" min="0"
                            value={editingFund.fund.sip_amount}
                            onChange={(e) => setEditingFund({ idx, fund: { ...editingFund.fund, sip_amount: Number(e.target.value) } })}
                          />
                        </div>
                        <div>
                          <label className="label text-xs">SIP Date</label>
                          <input
                            type="text" className="input text-sm" placeholder="e.g. 20th"
                            value={editingFund.fund.sip_date}
                            onChange={(e) => setEditingFund({ idx, fund: { ...editingFund.fund, sip_date: e.target.value } })}
                          />
                        </div>
                      </div>
                      <input
                        type="text" className="input text-sm" placeholder="Notes (optional)"
                        value={editingFund.fund.notes ?? ''}
                        onChange={(e) => setEditingFund({ idx, fund: { ...editingFund.fund, notes: e.target.value } })}
                      />
                      <input
                        type="text" className="input text-sm" placeholder="Platform (optional, e.g. Groww)"
                        value={editingFund.fund.platform ?? ''}
                        onChange={(e) => setEditingFund({ idx, fund: { ...editingFund.fund, platform: e.target.value } })}
                      />

                      <div>
                        <label className="label text-xs">Running since</label>
                        <input
                          type="month"
                          className="input input-sm w-full"
                          value={startMonth}
                          onChange={(e) => setStartMonth(e.target.value)}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          {startMonth
                            ? `Months before ${monthLabel(startMonth)} show nothing for this fund.`
                            : 'Not set — the fund counts in every month. Set it if it started later.'}
                        </p>
                      </div>

                      {/* How the new amount should apply. Only shown once the
                          amount actually differs from what is running today. */}
                      {Number(editingFund.fund.sip_amount) !== resolveSipAmount(fund, currentMonth) && (
                        <div className="rounded-lg border border-indigo-200 bg-white p-3 space-y-2">
                          <p className="text-xs font-medium text-gray-700">
                            Apply ₹{Number(editingFund.fund.sip_amount).toLocaleString('en-IN')} …
                          </p>

                          <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
                            <input
                              type="radio" className="mt-0.5"
                              checked={amountMode === 'change'}
                              onChange={() => setAmountMode('change')}
                            />
                            <span>
                              <span className="font-medium text-gray-800">From a month onwards</span>
                              <span className="block text-gray-400">
                                Earlier months keep ₹{resolveSipAmount(fund, currentMonth).toLocaleString('en-IN')}
                              </span>
                            </span>
                          </label>

                          {amountMode === 'change' && (
                            <input
                              type="month"
                              className="input input-sm w-full"
                              value={effectiveFrom}
                              onChange={(e) => setEffectiveFrom(e.target.value)}
                            />
                          )}

                          <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
                            <input
                              type="radio" className="mt-0.5"
                              checked={amountMode === 'correct'}
                              onChange={() => setAmountMode('correct')}
                            />
                            <span>
                              <span className="font-medium text-gray-800">To every month</span>
                              <span className="block text-gray-400">
                                Corrects a wrong figure — rewrites past months too
                              </span>
                            </span>
                          </label>
                        </div>
                      )}

                      {describeAmountHistory(fund).length > 0 && (
                        <div className="text-xs text-gray-500 bg-white rounded-lg border border-gray-200 p-2.5">
                          <p className="font-medium text-gray-600 mb-1">Amount history</p>
                          {describeAmountHistory(fund).map((entry) => (
                            <p key={entry.from_month} className="flex justify-between">
                              <span>from {monthLabel(entry.from_month)}</span>
                              <span className="font-medium text-gray-700">
                                ₹{entry.amount.toLocaleString('en-IN')}
                              </span>
                            </p>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2 justify-end pt-1">
                        <button onClick={() => setEditingFund(null)} className="btn btn-secondary btn-sm">Cancel</button>
                        <button onClick={saveEditedFund} disabled={saving} className="btn btn-primary btn-sm">
                          {saving ? 'Saving…' : 'Edit'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Read row */
                    <div className={`flex items-center gap-3 px-4 sm:px-6 py-2.5 ${!fund.active ? 'opacity-50' : ''}`}>
                      <button
                        onClick={() => toggleFundActive(idx)}
                        className={`w-4 h-4 rounded flex-shrink-0 border-2 transition-colors ${fund.active ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300'}`}
                        title={fund.active ? 'Mark stopped' : 'Mark active'}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">
                          {fund.name}
                          {fund.platform && <PlatformTag platform={fund.platform} />}
                        </p>
                        {fund.notes && <p className="text-xs text-gray-400">{fund.notes}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-medium text-gray-900">
                          {fund.active ? `₹${resolveSipAmount(fund, currentMonth).toLocaleString('en-IN')}` : '—'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {describeAmountHistory(fund).length > 1 ? '↑ changed · ' : ''}
                          {fund.sip_date}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0 ml-1">
                        <button
                          onClick={() => startEditingFund(idx, fund)}
                          className="p-1 text-gray-400 hover:text-gray-700 transition-colors"
                          title="Edit"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteFund(idx)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                          title="Remove"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add fund form */}
            {addingFund ? (
              <div className="border border-indigo-200 rounded-xl p-3 bg-indigo-50 space-y-2">
                <p className="text-xs font-semibold text-indigo-700">New Fund</p>
                <input
                  type="text" className="input text-sm" placeholder="Fund name" autoFocus
                  value={newFund.name}
                  onChange={(e) => setNewFund({ ...newFund, name: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-xs">SIP Amount (₹)</label>
                    <input
                      type="number" className="input text-sm" min="0"
                      value={newFund.sip_amount}
                      onChange={(e) => setNewFund({ ...newFund, sip_amount: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">SIP Date</label>
                    <input
                      type="text" className="input text-sm" placeholder="e.g. 5th"
                      value={newFund.sip_date}
                      onChange={(e) => setNewFund({ ...newFund, sip_date: e.target.value })}
                    />
                  </div>
                </div>
                <input
                  type="text" className="input text-sm" placeholder="Notes (optional)"
                  value={newFund.notes ?? ''}
                  onChange={(e) => setNewFund({ ...newFund, notes: e.target.value })}
                />
                <input
                  type="text" className="input text-sm" placeholder="Platform (optional, e.g. Groww)"
                  value={newFund.platform ?? ''}
                  onChange={(e) => setNewFund({ ...newFund, platform: e.target.value })}
                />
                <div>
                  <label className="label text-xs">Running since</label>
                  <input
                    type="month"
                    className="input input-sm w-full"
                    value={newFundStart}
                    onChange={(e) => setNewFundStart(e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Months before this show nothing for the fund.
                  </p>
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button onClick={() => setAddingFund(false)} className="btn btn-secondary text-xs py-1 px-3">Cancel</button>
                  <button onClick={saveNewFund} disabled={saving || !newFund.name.trim()} className="btn btn-primary text-xs py-1 px-3">
                    {saving ? 'Adding…' : 'Add Fund'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setAddingFund(true); setEditingFund(null); setNewFundStart(currentMonth); }}
                className="w-full py-2 border-2 border-dashed border-gray-200 hover:border-indigo-300 hover:text-indigo-600 rounded-xl text-sm text-gray-400 transition-colors"
              >
                + Add Fund
              </button>
            )}

            {/* Account total */}
            <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center">
              <span className="text-sm text-gray-500">
                {funds.filter((f) => f.active).length} active · {funds.filter((f) => !f.active).length} stopped
              </span>
              <span className="text-sm font-bold text-indigo-700">
                ₹{funds.filter((f) => f.active).reduce((s, f) => s + Number(f.sip_amount), 0).toLocaleString('en-IN')} / mo
              </span>
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
