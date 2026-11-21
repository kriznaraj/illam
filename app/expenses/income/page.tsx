'use client';

import { useMemo, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { MonthNavigator } from '@/components/MonthNavigator';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { ListItemRow } from '@/components/ListItemRow';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/lib/useToast';
import { useIncome } from '@/lib/hooks/useIncome';
import { useUsers } from '@/lib/hooks/useUsers';
import { INCOME_KIND_LABEL, INCOME_KINDS } from '@/lib/services/IncomeService';
import { formatMoney } from '@/lib/inbox/display';
import { formatters, getTodayAppDate, monthKeys } from '@/lib/utils/dateUtils';
import { getUserIcon } from '@/lib/userUtils';
import type { IncomeKind, IncomeWithUser } from '@/types';

const KIND_ICON: Record<IncomeKind, string> = {
  salary: '💼',
  dividend: '📈',
  interest: '🏦',
  refund: '↩️',
  reimbursement: '🧾',
  rent: '🏠',
  gift: '🎁',
  other: '💰',
};

interface FormState {
  id: string | null;
  date: string;
  amount: string;
  kind: IncomeKind;
  source_name: string;
  user_id: string;
  note: string;
}

const blankForm = (userId: string): FormState => ({
  id: null,
  date: getTodayAppDate(),
  amount: '',
  kind: 'salary',
  source_name: '',
  user_id: userId,
  note: '',
});

/**
 * Selavu · Income (migration 035).
 *
 * Totals are shown per currency and never added together: the dividends Madal records arrive
 * in USD inside the INDmoney wallet, and this app holds no exchange rate to turn them into
 * rupees with — a converted figure here would be invented.
 */
export default function IncomePage() {
  const [month, setMonth] = useState(monthKeys.current());
  const { income, summary, loading, create, update, remove } = useIncome(month);
  const { users } = useUsers();
  const { showToast, ToastContainer } = useToast();

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<IncomeWithUser | null>(null);

  const totals = useMemo(() => Object.entries(summary?.totals ?? { INR: 0 }), [summary]);
  const defaultUserId = users[0]?.id ?? '';

  const openAdd = () => setForm(blankForm(defaultUserId));
  const openEdit = (row: IncomeWithUser) =>
    setForm({
      id: row.id,
      date: row.date,
      amount: String(row.amount),
      kind: row.kind,
      source_name: row.source_name ?? '',
      user_id: row.user_id,
      note: row.note ?? '',
    });

  const save = async () => {
    if (!form) return;
    const amount = Number.parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast({ message: 'Enter an amount greater than zero', type: 'error' });
      return;
    }
    if (!form.user_id) {
      showToast({ message: 'Choose who received it', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const body = {
        date: form.date,
        amount,
        kind: form.kind,
        source_name: form.source_name.trim() || null,
        user_id: form.user_id,
        note: form.note.trim() || null,
      };
      if (form.id) await update(form.id, body);
      else await create(body);
      setForm(null);
      showToast({ message: form.id ? 'Income updated' : 'Income recorded', type: 'success' });
    } catch (error: unknown) {
      showToast({ message: error instanceof Error ? error.message : 'Could not save', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting.id);
      showToast({ message: 'Income deleted', type: 'success' });
    } catch (error: unknown) {
      showToast({ message: error instanceof Error ? error.message : 'Could not delete', type: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <PageContainer maxWidth="4xl">
      <PageHeader
        title="Income"
        description="Money that came in — salary, dividends, refunds and the rest"
        action={
          <button type="button" onClick={openAdd} className="btn btn-primary">
            Add income
          </button>
        }
      />

      <div className="mb-6">
        <MonthNavigator value={month} onChange={setMonth} ariaLabel="Income month" showPicker />
      </div>

      <div className="card p-4 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Received this month</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {totals.map(([currency, amount]) => (
            <p key={currency} className="text-3xl font-bold text-green-700">
              {formatMoney(amount, currency)}
            </p>
          ))}
        </div>
        {summary && summary.byKind.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.byKind.map((row) => (
              <span
                key={`${row.kind}-${row.currency}`}
                className="px-2 py-1 rounded-full bg-green-50 text-green-800 text-xs font-medium"
              >
                {KIND_ICON[row.kind]} {INCOME_KIND_LABEL[row.kind]} · {formatMoney(row.amount, row.currency)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <LoadingSpinner message="Loading income..." />
      ) : income.length === 0 ? (
        <EmptyState
          icon="💰"
          title="Nothing recorded this month"
          description="Income you add here, and credits you classify in Madal, both land in this list."
          action={{ label: 'Add income', onClick: openAdd }}
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          {income.map((row, index) => (
            <ListItemRow
              key={row.id}
              onClick={() => openEdit(row)}
              isLast={index === income.length - 1}
              leading={
                <span className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-lg flex-shrink-0" aria-hidden>
                  {KIND_ICON[row.kind]}
                </span>
              }
              title={row.source_name || INCOME_KIND_LABEL[row.kind]}
              subtitle={`${formatters.toFullDate(row.date)} · ${INCOME_KIND_LABEL[row.kind]}${
                row.source === 'inbox' ? ' · from Madal' : ''
              }`}
              meta={
                row.user ? (
                  <span className="text-[11px] text-gray-500">
                    {getUserIcon(row.user)} {row.user.full_name}
                  </span>
                ) : null
              }
              trailing={
                <span className="text-sm font-semibold text-green-700 whitespace-nowrap">
                  +{formatMoney(Number(row.amount), row.currency)}
                </span>
              }
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit income' : 'Add income'}
        footer={
          form ? (
            <>
              {form.id ? (
                <button
                  key="delete"
                  type="button"
                  className="btn btn-danger mr-auto"
                  onClick={() => {
                    const row = income.find((candidate) => candidate.id === form.id);
                    setForm(null);
                    if (row) setDeleting(row);
                  }}
                >
                  Delete
                </button>
              ) : null}
              <button key="cancel" type="button" className="btn btn-secondary" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button key="save" type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : null
        }
      >
        {form ? (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="income-amount">
                Amount
              </label>
              <input
                id="income-amount"
                type="number"
                step="0.01"
                className="input text-lg font-bold"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                autoFocus
              />
            </div>

            <div>
              <label className="label" htmlFor="income-kind">
                Kind
              </label>
              <select
                id="income-kind"
                className="select"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as IncomeKind })}
              >
                {INCOME_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {INCOME_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="income-source">
                Who paid it
              </label>
              <input
                id="income-source"
                className="input"
                value={form.source_name}
                onChange={(e) => setForm({ ...form, source_name: e.target.value })}
                placeholder="Employer, company, person…"
              />
            </div>

            <div>
              <label className="label" htmlFor="income-date">
                Date
              </label>
              <input
                id="income-date"
                type="date"
                className="input"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div>
              <label className="label" htmlFor="income-user">
                Received by
              </label>
              <select
                id="income-user"
                className="select"
                value={form.user_id}
                onChange={(e) => setForm({ ...form, user_id: e.target.value })}
              >
                <option value="">Choose</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="income-note">
                Note (optional)
              </label>
              <input
                id="income-note"
                className="input"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete this income?"
        message="This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />

      <ToastContainer />
    </PageContainer>
  );
}
