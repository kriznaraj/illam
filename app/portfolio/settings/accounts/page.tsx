'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PortfolioAccount } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';
import Modal from '@/components/Modal';
import { ModalRecordActions } from '@/components/ModalRecordActions';
import { getAppMonthKey } from '@/lib/utils/dateUtils';
import { isCashAccount } from '@/lib/portfolio/cashAccounts';

interface AccountType {
  id: string;
  name: string;
  color: string;
  show_in_growth: boolean;
}

type AccountDetails = Record<string, unknown>;

function AccountGroup({
  type,
  accounts,
  color,
  onEdit,
  latestBalances,
}: {
  type: string;
  accounts: PortfolioAccount[];
  color: string;
  onEdit: (a: PortfolioAccount) => void;
  latestBalances?: Record<string, number>;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <h3 className="text-sm font-semibold text-gray-700">{type}</h3>
        <span className="text-xs text-gray-400">({accounts.length})</span>
      </div>
      <div className="divide-y divide-gray-100">
        {accounts.map((account) => {
          const balance = latestBalances?.[account.id];
          const hasBalance = balance != null && balance !== 0;
          const isArchived = account.is_active === false;
          const showWarning = isArchived && hasBalance;

          return (
            <div
              key={account.id}
              className="w-full flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded transition-colors group"
            >
              <Link href={`/portfolio/settings/accounts/${account.id}`} className="flex-1 min-w-0 text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-900">{account.name}</p>
                    {showWarning && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                        ⚠ ₹{balance!.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </div>
                  {account.notes && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{account.notes}</p>
                  )}
                  {account.unit && account.multiplier && (
                    <p className="text-xs text-blue-500 mt-0.5">
                      {account.unit} · ₹{account.multiplier.toLocaleString()}/{account.unit}
                    </p>
                  )}
                  {account.type === 'Mutual Funds' &&
                    account.details &&
                    (() => {
                      const funds = (account.details as Record<string, unknown>).funds as
                        | { active: boolean; sip_amount: number }[]
                        | undefined;
                      if (!funds?.length) return null;
                      const active = funds.filter((f) => f.active);
                      const monthly = active.reduce((s, f) => s + Number(f.sip_amount ?? 0), 0);
                      return (
                        <p className="text-xs text-indigo-500 mt-0.5">
                          {active.length} active SIP{active.length !== 1 ? 's' : ''} · ₹
                          {monthly.toLocaleString('en-IN')}/mo
                        </p>
                      );
                    })()}
                  {account.details &&
                    (() => {
                      const d = account.details as Record<string, unknown>;
                      const isCc =
                        account.type === 'Credit Card' ||
                        (account.type === 'Debt' && (d.is_credit_card === true || d.is_credit_card === 'true')) ||
                        (account.type === 'Debt' && (typeof d.billing_date === 'string' || typeof d.due_date === 'string'));
                      if (!isCc) return null;
                      const parts: string[] = [];
                      if (typeof d.bank === 'string' && d.bank) parts.push(d.bank);
                      if (typeof d.billing_date === 'string' && d.billing_date) parts.push(`Bill ${d.billing_date}`);
                      if (typeof d.due_date === 'string' && d.due_date) parts.push(`Due ${d.due_date}`);
                      return parts.length > 0 ? (
                        <p className="text-xs text-red-400 mt-0.5">{parts.join(' · ')}</p>
                      ) : null;
                    })()}
                </div>
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onEdit(account);
                }}
                className="flex-shrink-0 ml-2 p-2.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                title="Edit account"
                aria-label="Edit account"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsAccountsPage() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [latestBalances, setLatestBalances] = useState<Record<string, number>>({});
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [types, setTypes] = useState<AccountType[]>([]);
  const [accountModal, setAccountModal] = useState<'create' | 'edit' | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<PortfolioAccount | null>(null);
  const [accountForm, setAccountForm] = useState({
    name: '',
    type: '',
    notes: '',
    currency: 'INR',
    unit: '',
    multiplier: '',
    is_active: true,
    // null: decided by the account type (see lib/portfolio/cashAccounts.ts).
    is_cash: null as boolean | null,
    details: {} as AccountDetails,
  });
  const [accountDeleteConfirm, setAccountDeleteConfirm] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [recurringAmountOnOpen, setRecurringAmountOnOpen] = useState('');
  const [recurringFrom, setRecurringFrom] = useState(getAppMonthKey());
  // Set once the user picks a month themselves. Without it, saving an unrelated
  // edit would restate the rows at whatever month happened to be defaulted in.
  const [recurringMonthTouched, setRecurringMonthTouched] = useState(false);
  const [accountError, setAccountError] = useState('');

  useEffect(() => {
    fetchAccounts();
    fetchTypes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAccounts = async () => {
    setAccountsLoading(true);
    try {
      const [accountsRes, snapshotsRes] = await Promise.all([
        fetch(`/api/portfolio/accounts?includeArchived=true&_t=${Date.now()}`, { cache: 'no-store' }),
        fetch('/api/portfolio/snapshots'),
      ]);
      const accountsData = await accountsRes.json();
      const snapshotsData = await snapshotsRes.json();

      const latestDate: Record<string, string> = {};
      const latestBalance: Record<string, number> = {};
      if (Array.isArray(snapshotsData)) {
        snapshotsData.forEach(
          (s: { account_id: string; amount: number; snapshot_date: string }) => {
            if (!latestDate[s.account_id] || s.snapshot_date > latestDate[s.account_id]) {
              latestDate[s.account_id] = s.snapshot_date;
              latestBalance[s.account_id] = s.amount;
            }
          }
        );
      }
      setLatestBalances(latestBalance);
      setAccounts(Array.isArray(accountsData) ? accountsData : []);
    } catch {
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchTypes = async () => {
    try {
      const res = await fetch('/api/portfolio/account-types');
      const data = await res.json();
      setTypes(Array.isArray(data) ? data : []);
    } catch {
      setTypes([]);
    }
  };

  const openNewAccount = () => {
    setSelectedAccount(null);
    setAccountForm({
      name: '',
      type: types[0]?.name ?? '',
      notes: '',
      currency: 'INR',
      unit: '',
      multiplier: '',
      is_active: true,
      is_cash: null,
      details: {},
    });
    setAccountDeleteConfirm(false);
    setAccountError('');
    setRecurringAmountOnOpen('');
    setRecurringFrom(getAppMonthKey());
    setRecurringMonthTouched(false);
    setAccountModal('create');
  };

  const openEditAccount = useCallback((account: PortfolioAccount) => {
    setSelectedAccount(account);
    setAccountForm({
      name: account.name,
      type: account.type,
      notes: account.notes ?? '',
      currency: account.currency ?? 'INR',
      unit: account.unit ?? '',
      multiplier: account.multiplier != null ? account.multiplier.toString() : '',
      is_active: account.is_active !== false,
      is_cash: account.is_cash ?? null,
      details: (account.details as AccountDetails) ?? {},
    });
    setAccountDeleteConfirm(false);
    setAccountError('');
    // Remember what the recurring amount was, so a change can be dated rather
    // than silently restating months that already have a materialised row.
    const openedWith = (account.details as AccountDetails | null)?.recurring_monthly_amount;
    setRecurringAmountOnOpen(openedWith == null ? '' : String(Number(openedWith)));
    setRecurringFrom(getAppMonthKey());
    setRecurringMonthTouched(false);
    setAccountModal('edit');
  }, []);

  // Auto-open edit modal when ?edit=<accountId> is in the URL
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || accounts.length === 0) return;
    const target = accounts.find((a) => a.id === editId);
    if (target) openEditAccount(target);
  }, [searchParams, accounts, openEditAccount]);

  const closeAccountModal = () => {
    setAccountModal(null);
    setSelectedAccount(null);
    setAccountDeleteConfirm(false);
    setAccountError('');
  };

  const recurringAmountChanged = (): boolean => {
    const now = getRecurringAmount();
    return isRecurringEnabled() && now !== '' && now !== recurringAmountOnOpen;
  };

  const isRecurringEnabled = (): boolean => {
    const raw = (accountForm.details as AccountDetails).recurring_investments_enabled;
    return raw === true || raw === 'true';
  };

  const setRecurringEnabled = (enabled: boolean) => {
    setAccountForm((prev) => ({
      ...prev,
      details: {
        ...(prev.details as AccountDetails),
        recurring_investments_enabled: enabled,
      },
    }));
  };

  const getRecurringAmount = (): string => {
    const raw = (accountForm.details as AccountDetails).recurring_monthly_amount;
    if (raw == null) return '';
    const amount = Number(raw);
    return Number.isFinite(amount) ? String(amount) : '';
  };

  const setRecurringAmount = (amount: string) => {
    const numeric = Number(amount);
    setAccountForm((prev) => ({
      ...prev,
      details: {
        ...(prev.details as AccountDetails),
        recurring_monthly_amount: Number.isFinite(numeric) ? numeric : 0,
      },
    }));
  };

  const handleSaveAccount = async () => {
    if (!accountForm.name.trim()) {
      setAccountError('Name is required');
      return;
    }
    setAccountSaving(true);
    setAccountError('');
    try {
      const isEdit = accountModal === 'edit' && selectedAccount;
      // is_cash goes out only when it changed: the column does not exist until
      // migration 033 is applied, and sending it would fail every save before then.
      const { is_cash: isCash, ...formFields } = accountForm;
      const cashChanged = isCash !== ((isEdit ? selectedAccount.is_cash : null) ?? null);
      const payload = {
        ...formFields,
        ...(cashChanged ? { is_cash: isCash } : {}),
        multiplier:
          accountForm.multiplier !== '' ? parseFloat(accountForm.multiplier) : null,
        unit: accountForm.unit.trim() || null,
        details:
          Object.keys(accountForm.details as AccountDetails).length > 0 ? accountForm.details : null,
      };
      const res = await fetch('/api/portfolio/accounts', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: selectedAccount.id, ...payload } : payload),
      });
      if (!res.ok) {
        setAccountError('Failed to save');
        return;
      }

      // Saving the account only stores the new figure. The monthly rows are
      // materialised, and the generator only fills gaps — so months that
      // already have a row (often well into the future) need restating.
      const restateRows =
        isEdit &&
        isRecurringEnabled() &&
        Number(getRecurringAmount()) > 0 &&
        (recurringAmountChanged() || recurringMonthTouched);

      if (restateRows) {
        const sync = await fetch('/api/portfolio/investments/recurring', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: selectedAccount.id,
            amount: Number(getRecurringAmount()),
            from_month: recurringFrom,
          }),
        });
        if (!sync.ok) {
          const payload = await sync.json().catch(() => null);
          setAccountError(payload?.error || 'Saved, but monthly rows were not updated');
          await fetchAccounts();
          return;
        }
      }

      await fetchAccounts();
      closeAccountModal();
    } finally {
      setAccountSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedAccount) return;
    setAccountSaving(true);
    try {
      const res = await fetch(`/api/portfolio/accounts?id=${selectedAccount.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setAccountError('Failed to delete');
        setAccountDeleteConfirm(false);
        return;
      }
      await fetchAccounts();
      closeAccountModal();
    } finally {
      setAccountSaving(false);
    }
  };

  const typeColorMap = Object.fromEntries(types.map((t) => [t.name, t.color]));
  const activeAccounts = accounts.filter((a) => a.is_active !== false);
  const archivedAccounts = accounts.filter((a) => a.is_active === false);

  const groupByType = (accs: PortfolioAccount[]) =>
    accs.reduce((acc, a) => {
      if (!acc[a.type]) acc[a.type] = [];
      acc[a.type].push(a);
      return acc;
    }, {} as Record<string, PortfolioAccount[]>);

  const accountModalFooter = accountDeleteConfirm ? (
    <div className="flex items-center gap-3 w-full">
      <span className="text-sm text-red-600 flex-1">
        Delete account and all its snapshots?
      </span>
      <button
        onClick={handleDeleteAccount}
        disabled={accountSaving}
        className="btn btn-danger"
      >
        {accountSaving ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  ) : (
    <div className="flex gap-2 w-full">
      {accountModal === 'edit' ? (
        <ModalRecordActions
          onDelete={() => setAccountDeleteConfirm(true)}
          onEdit={handleSaveAccount}
          editDisabled={accountSaving}
        />
      ) : (
        <button
          onClick={handleSaveAccount}
          disabled={accountSaving}
          className="btn btn-primary"
        >
          {accountSaving ? 'Saving…' : 'Create'}
        </button>
      )}
    </div>
  );

  return (
    <PageContainer maxWidth="4xl">
      <Link
        href="/portfolio/settings"
        className="inline-block text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        ← Settings
      </Link>
      <PageHeader
        title="Accounts"
        description="Manage portfolio accounts. Click an account to manage instruments."
      />

      {accountsLoading ? (
        <LoadingSpinner message="Loading accounts…" />
      ) : (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={openNewAccount} className="btn btn-primary">
              + New Account
            </button>
          </div>

          {accounts.length === 0 ? (
            <EmptyState
              icon="🏦"
              title="No accounts yet"
              description="Add your first account to start tracking."
              action={{ label: '+ New Account', onClick: openNewAccount }}
            />
          ) : (
            <div className="space-y-6">
              <div className="space-y-3">
                {Object.entries(groupByType(activeAccounts)).map(([type, typeAccounts]) => (
                  <AccountGroup
                    key={type}
                    type={type}
                    accounts={typeAccounts}
                    color={typeColorMap[type] ?? '#6b7280'}
                    onEdit={openEditAccount}
                  />
                ))}
              </div>

              {archivedAccounts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Archived
                  </p>
                  <div className="space-y-3 opacity-60">
                    {Object.entries(groupByType(archivedAccounts)).map(
                      ([type, typeAccounts]) => (
                        <AccountGroup
                          key={type}
                          type={type}
                          accounts={typeAccounts}
                          color={typeColorMap[type] ?? '#6b7280'}
                          onEdit={openEditAccount}
                          latestBalances={latestBalances}
                        />
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Modal
        isOpen={!!accountModal}
        onClose={closeAccountModal}
        title={accountModal === 'create' ? 'New Account' : 'Edit Account'}
        footer={accountModalFooter}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Account Name</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. HDFC Salary Account"
              value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Type</label>
            <select
              className="select"
              value={accountForm.type}
              onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value })}
            >
              {types.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Currency</label>
              <select
                className="select"
                value={accountForm.currency}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, currency: e.target.value })
                }
              >
                {['INR', 'USD'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">
                Unit <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                className="input"
                placeholder="e.g. g, oz, shares"
                value={accountForm.unit}
                onChange={(e) => setAccountForm({ ...accountForm, unit: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">
              Price per unit{' '}
              <span className="text-gray-400 font-normal">(multiplier, optional)</span>
            </label>
            <input
              type="number"
              className="input"
              placeholder="e.g. 7500 for gold at ₹7500/g"
              value={accountForm.multiplier}
              onChange={(e) =>
                setAccountForm({ ...accountForm, multiplier: e.target.value })
              }
              min="0"
              step="any"
            />
            {accountForm.multiplier && accountForm.unit && (
              <p className="text-xs text-gray-500 mt-1">
                Snapshot input will be in <strong>{accountForm.unit}</strong>. Value ={' '}
                {accountForm.unit} × {parseFloat(accountForm.multiplier).toLocaleString()}
              </p>
            )}
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input resize-none"
              rows={2}
              placeholder="e.g. Account number, bank branch, or any other details"
              value={accountForm.notes}
              onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })}
            />
          </div>

          {accountForm.type === 'Mutual Funds' && (
            <div className="border border-indigo-100 bg-indigo-50/40 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                Mutual Fund Folio
              </p>
              <p className="text-xs text-indigo-500">
                Individual fund &amp; SIP details are managed on the <strong>SIP page</strong>.
              </p>
            </div>
          )}

          {(() => {
            const recurringEnabled = isRecurringEnabled();
            const recurringAmount = getRecurringAmount();
            return (
              <div className="border border-purple-100 bg-purple-50/40 rounded-xl p-3 space-y-3">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={recurringEnabled}
                    onChange={(e) => setRecurringEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-purple-600"
                  />
                  <span className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
                    Enable Auto Monthly Contribution
                  </span>
                </label>
                <p className="text-xs text-purple-600">
                  Generic for any account — the amount is added automatically each month.
                  Changing it applies from the month you pick; earlier months keep what they
                  already have.
                </p>
                <div>
                  <label className="label">Monthly Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    placeholder="e.g. 5000"
                    value={recurringAmount}
                    onChange={(e) => setRecurringAmount(e.target.value)}
                    disabled={!recurringEnabled}
                  />
                </div>

                {accountModal === 'edit' && recurringEnabled && (
                  <div className="rounded-lg border border-purple-200 bg-white p-3 space-y-2">
                    <label className="label text-xs mb-0">
                      Apply {recurringAmount === '' ? 'this amount' : `₹${Number(recurringAmount).toLocaleString('en-IN')}`} from
                    </label>
                    <input
                      type="month"
                      className="input input-sm w-full"
                      value={recurringFrom}
                      onChange={(e) => {
                        setRecurringFrom(e.target.value);
                        setRecurringMonthTouched(true);
                      }}
                    />
                    <p className="text-xs text-gray-500">
                      {recurringAmountChanged()
                        ? `Months before this keep ₹${Number(recurringAmountOnOpen || 0).toLocaleString('en-IN')}. Months from here on are restated — including any already generated ahead of today.`
                        : 'Change the amount, or pick a month, to restate this account from that month onwards. Earlier months are never touched.'}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {(() => {
            const d = (accountForm.details ?? {}) as Record<string, unknown>;
            const ccDetails = (accountForm.details ?? {}) as Record<string, string>;
            const isCc =
              accountForm.type === 'Credit Card' ||
              (accountForm.type === 'Debt' && (d.is_credit_card === true || d.is_credit_card === 'true')) ||
              (accountForm.type === 'Debt' && (typeof d.billing_date === 'string' || typeof d.due_date === 'string'));
            if (!isCc) return null;
            return (
            <div className="border border-red-100 bg-red-50/40 rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">
                Card Details
              </p>
              <div>
                <label className="label">Bank / Network</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. HDFC Mastercard"
                  value={ccDetails.bank ?? ''}
                  onChange={(e) =>
                    setAccountForm({
                      ...accountForm,
                      details: { ...accountForm.details, bank: e.target.value },
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Statement (Billing) Day</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. 8th"
                    value={ccDetails.billing_date ?? ''}
                    onChange={(e) =>
                      setAccountForm({
                        ...accountForm,
                        details: {
                          ...accountForm.details,
                          billing_date: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Due Date</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. 28th"
                    value={ccDetails.due_date ?? ''}
                    onChange={(e) =>
                      setAccountForm({
                        ...accountForm,
                        details: { ...accountForm.details, due_date: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="label">Primary Use</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Amazon only"
                  value={ccDetails.purpose ?? ''}
                  onChange={(e) =>
                    setAccountForm({
                      ...accountForm,
                      details: { ...accountForm.details, purpose: e.target.value },
                    })
                  }
                />
              </div>
            </div>
            );
          })()}

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={accountForm.is_cash ?? isCashAccount({ type: accountForm.type, name: accountForm.name })}
              onChange={(e) => setAccountForm({ ...accountForm, is_cash: e.target.checked })}
              className="w-4 h-4 rounded text-green-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-700">Cash account</p>
              <p className="text-xs text-gray-400">
                Outside investments — money moved from here into an investment is a contribution, not growth.
                {accountForm.is_cash === null ? ' Set by account type.' : ''}
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={accountForm.is_active}
              onChange={(e) =>
                setAccountForm({ ...accountForm, is_active: e.target.checked })
              }
              className="w-4 h-4 rounded text-green-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-700">Active</p>
              <p className="text-xs text-gray-400">
                Uncheck to archive — hides from snapshot entry
              </p>
            </div>
          </label>

          {accountError && <p className="text-sm text-red-600">{accountError}</p>}
        </div>
      </Modal>
    </PageContainer>
  );
}

export default function SettingsAccountsPageWrapper() {
  return (
    <Suspense fallback={<LoadingSpinner message="Loading..." />}>
      <SettingsAccountsPage />
    </Suspense>
  );
}
