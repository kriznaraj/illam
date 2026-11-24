'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PortfolioAccount, PortfolioHolding } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatCurrency } from '@/lib/utils';


const INSTRUMENT_LABEL: Record<string, string> = {
  nse_stock: 'NSE', bse_stock: 'BSE', mf_nav: 'Mutual Fund',
  us_stock: 'US Stock', gold_etf: 'Gold ETF', gold_physical: 'Gold',
  gold_rate: 'Gold', sgb: 'SGB', bond: 'Bond', nps: 'NPS', manual: 'Manual',
};

function toTitleCase(str: string) {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SettingsAccountDetailsPage() {
  const params = useParams();
  const id = params?.id as string | undefined;

  const [account, setAccount] = useState<PortfolioAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [latestSnapshot, setLatestSnapshot] = useState<{ snapshot_date: string; amount: number; units?: number | null } | null>(null);
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);

  // Credit card inline edit state
  const [ccEditing, setCcEditing]       = useState(false);
  const [ccBillingDay, setCcBillingDay] = useState('');
  const [ccDueDay, setCcDueDay]         = useState('');
  const [ccBank, setCcBank]             = useState('');
  const [ccPurpose, setCcPurpose]       = useState('');
  const [ccSaving, setCcSaving]         = useState(false);
  const [ccMsg, setCcMsg]               = useState<string | null>(null);

  // Archive toggle state
  const [archiving, setArchiving] = useState(false);

  // Show the spinner again when id changes (set during render, not in the effect).
  const [loadingFor, setLoadingFor] = useState(id);
  if (id !== loadingFor) {
    setLoadingFor(id);
    if (id) setLoading(true);
  }

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch('/api/portfolio/accounts?includeArchived=true').then((r) => r.json()),
      fetch(`/api/portfolio/snapshots?accountId=${id}&limit=1`).then((r) => r.json()),
      fetch(`/api/portfolio/holdings?accountId=${id}&includeInactive=true`).then((r) => r.json()),
    ])
      .then(([accountsData, snapshotsData, holdingsData]) => {
        const accounts = Array.isArray(accountsData) ? accountsData : [];
        const found = accounts.find((a: PortfolioAccount) => a.id === id) ?? null;
        setAccount(found);
        if (found?.type === 'Credit Card') {
          const d = (found.details ?? {}) as Record<string, string>;
          setCcBillingDay(d.billing_date ?? '');
          setCcDueDay(d.due_date ?? '');
          setCcBank(d.bank ?? '');
          setCcPurpose(d.purpose ?? '');
        }
        setLatestSnapshot(Array.isArray(snapshotsData) && snapshotsData.length > 0 ? snapshotsData[0] : null);
        setHoldings(Array.isArray(holdingsData) ? holdingsData : []);
      })
      .catch(() => { setAccount(null); setLatestSnapshot(null); setHoldings([]); })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !id) {
    return <LoadingSpinner message="Loading account…" />;
  }

  if (!account) {
    return (
      <PageContainer maxWidth="4xl">
        <PageHeader title="Account not found" />
        <div className="card text-center py-8">
          <p className="text-gray-600 mb-4">This account does not exist or was removed.</p>
          <Link href="/portfolio/settings/accounts" className="btn btn-secondary">
            ← Back to Accounts
          </Link>
        </div>
      </PageContainer>
    );
  }

  const isCreditCard = account.type === 'Credit Card';

  const saveCcSettings = async () => {
    if (!account) return;
    setCcSaving(true);
    setCcMsg(null);
    try {
      const d = (account.details ?? {}) as Record<string, unknown>;
      const res = await fetch('/api/portfolio/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: account.id,
          details: { ...d, billing_date: ccBillingDay.trim(), due_date: ccDueDay.trim(), bank: ccBank.trim(), purpose: ccPurpose.trim() },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Save failed');
      setAccount(json);
      setCcEditing(false);
      setCcMsg('Saved');
      setTimeout(() => setCcMsg(null), 2500);
    } catch (e) {
      setCcMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setCcSaving(false);
    }
  };

  const cancelCcEdit = () => {
    if (!account) return;
    const d = (account.details ?? {}) as Record<string, string>;
    setCcBillingDay(d.billing_date ?? '');
    setCcDueDay(d.due_date ?? '');
    setCcBank(d.bank ?? '');
    setCcPurpose(d.purpose ?? '');
    setCcEditing(false);
    setCcMsg(null);
  };

  const toggleArchive = async () => {
    if (!account) return;
    setArchiving(true);
    try {
      const newActive = account.is_active === false ? true : false;
      const res = await fetch('/api/portfolio/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id, is_active: newActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Failed');
      setAccount(json);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <PageContainer maxWidth="4xl">
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        {/* Mobile: single back link */}
        <Link href="/portfolio/settings/accounts" className="flex items-center gap-1 hover:text-gray-700 sm:hidden">
          <span aria-hidden>←</span> Accounts
        </Link>

        {/* Desktop: full trail */}
        <Link href="/portfolio/settings" className="hover:text-gray-700 hidden sm:inline">Settings</Link>
        <span aria-hidden className="hidden sm:inline">/</span>
        <Link href="/portfolio/settings/accounts" className="hover:text-gray-700 hidden sm:inline">Accounts</Link>
        <span aria-hidden className="hidden sm:inline">/</span>
        <span className="text-gray-900 font-medium hidden sm:inline truncate max-w-[200px]">{account.name}</span>

        <span className="flex-1" />
        <Link href={`/portfolio/accounts/${id}`} className="text-gray-500 hover:text-gray-700 text-sm hidden sm:inline">
          View account
        </Link>
        <span className="text-gray-300 hidden sm:inline">·</span>
        <Link href={`/portfolio/settings/accounts?edit=${id}`} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
          Edit
        </Link>
      </nav>

      <PageHeader
        title={account.name}
        description={`${account.type}${account.currency ? ` · ${account.currency}` : ''}`}
      />

      {/* Account metadata */}
      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Account details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Status</dt>
            <dd className="flex items-center gap-2">
              {account.is_active !== false ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Archived</span>
              )}
              <button
                onClick={toggleArchive}
                disabled={archiving}
                className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 disabled:opacity-50"
              >
                {archiving ? '…' : account.is_active !== false ? 'Archive' : 'Restore'}
              </button>
            </dd>
          </div>
          {latestSnapshot && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Last recorded</dt>
              <dd className="font-medium text-gray-900 mt-0.5">
                {account.currency === 'INR' ? '₹' : account.currency === 'USD' ? '$' : ''}
                {latestSnapshot.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                {latestSnapshot.units != null && account.unit && (
                  <span className="text-gray-500 font-normal ml-1">({latestSnapshot.units} {account.unit})</span>
                )}
                <span className="text-gray-500 font-normal ml-1">
                  on {new Date(latestSnapshot.snapshot_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Type</dt>
            <dd className="font-medium text-gray-900">{account.type}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Currency</dt>
            <dd className="font-medium text-gray-900">{account.currency ?? 'INR'}</dd>
          </div>
          {account.unit && (
            <div>
              <dt className="text-gray-500">Unit</dt>
              <dd className="font-medium text-gray-900">{account.unit}</dd>
            </div>
          )}
          {account.multiplier != null && (
            <div>
              <dt className="text-gray-500">Price per unit</dt>
              <dd className="font-medium text-gray-900">
                {account.currency === 'INR' ? '₹' : ''}{account.multiplier.toLocaleString()}
                {account.unit ? ` / ${account.unit}` : ''}
              </dd>
            </div>
          )}
          {account.notes && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Notes</dt>
              <dd className="font-medium text-gray-900 mt-0.5">{account.notes}</dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Added</dt>
            <dd className="font-medium text-gray-900">
              {new Date(account.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </dd>
          </div>
        </dl>

        {/* Type-specific extra details */}
        {isCreditCard ? (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Card Settings</h3>
              {!ccEditing && (
                <button
                  onClick={() => setCcEditing(true)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  Edit
                </button>
              )}
              {ccMsg && (
                <span className={`text-xs font-medium ml-2 ${ccMsg === 'Saved' ? 'text-green-600' : 'text-red-500'}`}>
                  {ccMsg}
                </span>
              )}
            </div>

            {ccEditing ? (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <label className="text-gray-500 block mb-1">Statement day</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. 8"
                      value={ccBillingDay}
                      onChange={(e) => setCcBillingDay(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 block mb-1">Due day</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. 28"
                      value={ccDueDay}
                      onChange={(e) => setCcDueDay(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 block mb-1">Bank / Network</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. HDFC Bank"
                      value={ccBank}
                      onChange={(e) => setCcBank(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 block mb-1">Primary use</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Amazon, fuel"
                      value={ccPurpose}
                      onChange={(e) => setCcPurpose(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <button className="btn btn-primary text-sm" onClick={saveCcSettings} disabled={ccSaving}>
                    {ccSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn btn-secondary text-sm" onClick={cancelCcEdit} disabled={ccSaving}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-500">Statement day</dt>
                  <dd className="font-medium text-gray-900">{ccBillingDay || <span className="text-gray-400 font-normal">Not set</span>}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Due day</dt>
                  <dd className="font-medium text-gray-900">{ccDueDay || <span className="text-gray-400 font-normal">Not set</span>}</dd>
                </div>
                {ccBank && (
                  <div>
                    <dt className="text-gray-500">Bank / Network</dt>
                    <dd className="font-medium text-gray-900">{ccBank}</dd>
                  </div>
                )}
                {ccPurpose && (
                  <div>
                    <dt className="text-gray-500">Primary use</dt>
                    <dd className="font-medium text-gray-900">{ccPurpose}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        ) : account.details && Object.keys(account.details as Record<string, unknown>).length > 0 ? (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Extra details</h3>
            {account.type === 'Mutual Funds' && (() => {
              const d = account.details as Record<string, unknown>;
              const funds = d.funds as { name?: string; sip_amount?: number; sip_date?: string; active: boolean; notes?: string }[] | undefined;
              if (!funds?.length) return null;
              const activeFunds = funds.filter((f) => f.active);
              const monthly = activeFunds.reduce((s, f) => s + Number(f.sip_amount ?? 0), 0);
              return (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">
                    {activeFunds.length} active SIP{activeFunds.length !== 1 ? 's' : ''}
                    {monthly > 0 && <> · ₹{monthly.toLocaleString('en-IN')}/mo total</>}
                    {' · '}
                    <Link href="/portfolio/sip" className="text-indigo-600 hover:text-indigo-800 font-medium">Edit on SIP page</Link>
                  </p>
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 overflow-hidden">
                    {funds.map((f, i) => (
                      <li key={i} className={`flex items-center justify-between gap-3 px-3 py-2.5 text-sm ${!f.active ? 'bg-gray-50 text-gray-500' : 'bg-white'}`}>
                        <div className="min-w-0 flex-1">
                          <p className={`font-medium truncate ${f.active ? 'text-gray-900' : 'text-gray-500'}`}>{f.name || `Fund ${i + 1}`}</p>
                          {f.sip_date && <p className="text-xs text-gray-500 mt-0.5">SIP date: {f.sip_date}</p>}
                          {f.notes && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{f.notes}</p>}
                        </div>
                        <div className="flex-shrink-0">
                          {f.active
                            ? <span className="font-medium text-gray-900 whitespace-nowrap">₹{Number(f.sip_amount ?? 0).toLocaleString('en-IN')}/mo</span>
                            : <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600">Stopped</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
            {account.type !== 'Credit Card' && account.type !== 'Mutual Funds' && (
              <pre className="text-xs text-gray-600 bg-gray-50 p-3 rounded overflow-x-auto">
                {JSON.stringify(account.details, null, 2)}
              </pre>
            )}
          </div>
        ) : null}
      </div>

      {/* Instruments */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Instruments</h2>
          <Link href={`/portfolio/settings/accounts/${id}/holdings/new`} className="btn btn-primary text-sm">
            + Add instrument
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading instruments…</p>
        ) : holdings.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">
            No instruments yet. Add stocks, MF schemes, gold, etc. for this account.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {holdings.map((h) => {
              const typeLabel = INSTRUMENT_LABEL[h.instrument_type] ?? h.instrument_type;
              const showSymbol = h.symbol && h.symbol !== h.name && h.symbol.length <= 20;
              return (
                <li key={h.id}>
                  <Link
                    href={`/portfolio/settings/accounts/${id}/holdings/${h.id}`}
                    className={`flex items-center justify-between py-3 px-2 rounded-lg hover:bg-gray-50 transition-colors group ${h.is_active === false ? 'opacity-50' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 truncate">
                          {toTitleCase(h.name)}
                        </p>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 flex-shrink-0">
                          {typeLabel}
                        </span>
                        {h.is_active === false && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-500 flex-shrink-0">Inactive</span>
                        )}
                      </div>
                      {showSymbol && (
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">{h.symbol}</p>
                      )}
                    </div>
                    <svg className="w-4 h-4 text-gray-400 ml-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
