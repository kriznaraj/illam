'use client';

import { useEffect, useState } from 'react';
import type { PortfolioAccount, PortfolioInvestment } from '@/types';
import Modal from '@/components/Modal';
import { formatCurrency } from '@/lib/utils';
import { Trash2 } from 'lucide-react';

const AUTO_RECURRING_NOTE = '__AUTO_MONTHLY__';
const AUTO_SIP_VIRTUAL_NOTE = '__AUTO_SIP_VIRTUAL__';

type Props = {
  investment: PortfolioInvestment | null;
  isOpen: boolean;
  accounts: PortfolioAccount[];
  onClose: () => void;
  onSuccess: () => void;
};

export default function InvestmentDetailModal({
  investment,
  isOpen,
  accounts,
  onClose,
  onSuccess,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    account_id: '',
    investment_date: '',
    amount: '',
    kind: 'adhoc' as 'adhoc' | 'recurring',
    note: '',
  });

  useEffect(() => {
    if (!investment || !isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the form from the investment each time the modal opens
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setError(null);
    setFormData({
      account_id: investment.account_id,
      investment_date: investment.investment_date,
      amount: String(investment.amount ?? ''),
      kind: (investment.kind === 'recurring' ? 'recurring' : 'adhoc') as 'adhoc' | 'recurring',
      note: investment.note === AUTO_RECURRING_NOTE || investment.note === AUTO_SIP_VIRTUAL_NOTE ? '' : (investment.note ?? ''),
    });
  }, [investment, isOpen]);

  if (!investment) return null;

  const isAutoRecurring = investment.kind === 'recurring' && investment.note === AUTO_RECURRING_NOTE;
  const isAutoSipVirtual = investment.note === AUTO_SIP_VIRTUAL_NOTE;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number.parseFloat(formData.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Enter a valid non-zero amount.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const endpoint = '/api/portfolio/investments';
      const method = isAutoSipVirtual ? 'POST' : 'PUT';
      const payload = isAutoSipVirtual
        ? {
            account_id: formData.account_id,
            investment_date: formData.investment_date,
            amount,
            kind: 'adhoc',
            note: formData.note.trim() || 'Adhoc override from recurring SIP entry',
          }
        : {
            id: investment.id,
            account_id: formData.account_id,
            investment_date: formData.investment_date,
            amount,
            kind: formData.kind,
            note: isAutoRecurring ? AUTO_RECURRING_NOTE : (formData.note.trim() || null),
          };
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to update investment');
      }
      onSuccess();
      if (isAutoSipVirtual) {
        onClose();
      } else {
        setIsEditing(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update investment');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/investments?id=${investment.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to delete investment');
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete investment');
    } finally {
      setSaving(false);
    }
  };

  const footer = showDeleteConfirm ? undefined : (
    isEditing ? (
      <>
        <button className="btn btn-secondary" onClick={() => setIsEditing(false)} type="button">
          Cancel
        </button>
        <button className="btn btn-primary" form="investment-edit-form" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </>
    ) : (
      <>
        <button className="btn btn-secondary" onClick={() => setIsEditing(true)} type="button">
          Edit
        </button>
        <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)} type="button" disabled={isAutoRecurring || isAutoSipVirtual}>
          Delete
        </button>
      </>
    )
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (isEditing) {
          setIsEditing(false);
          return;
        }
        onClose();
      }}
      title={isEditing ? 'Edit Investment' : 'Investment Details'}
      footer={footer}
    >
      {isEditing ? (
        <form id="investment-edit-form" onSubmit={save} className="space-y-4">
          {(isAutoRecurring || isAutoSipVirtual) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {isAutoSipVirtual
                ? 'This is a recurring SIP entry derived from account settings. Saving will create an adhoc entry for this month and will not change future recurring SIP entries.'
                : 'This is a recurring entry. Editing this month will not change future recurring months; update account recurring settings for future months.'}
            </div>
          )}
          <div>
            <label className="label">Amount</label>
            <input
              className="input text-lg font-bold"
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input
              className="input"
              type="date"
              value={formData.investment_date}
              onChange={(e) => setFormData((prev) => ({ ...prev, investment_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">Account</label>
            <select
              className="select"
              value={formData.account_id}
              onChange={(e) => setFormData((prev) => ({ ...prev, account_id: e.target.value }))}
              required
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Type</label>
            <select
              className="select"
              value={formData.kind}
              onChange={(e) => setFormData((prev) => ({ ...prev, kind: e.target.value as 'adhoc' | 'recurring' }))}
              disabled={isAutoRecurring || isAutoSipVirtual}
            >
              <option value="adhoc">Adhoc</option>
              <option value="recurring">Recurring</option>
            </select>
          </div>
          {!isAutoRecurring && (
            <div>
              <label className="label">Note</label>
              <input
                className="input"
                type="text"
                value={formData.note}
                onChange={(e) => setFormData((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Optional note"
              />
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      ) : showDeleteConfirm ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                <Trash2 size={20} aria-hidden />
              </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">Delete this investment?</h3>
          <p className="text-sm text-gray-500 mb-6">This action cannot be undone.</p>
          <div className="flex gap-3 w-full">
            <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-secondary flex-1" type="button">
              Cancel
            </button>
            <button onClick={remove} className="btn btn-danger flex-1" disabled={saving} type="button">
              {saving ? 'Deleting...' : 'Delete'}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {(isAutoRecurring || isAutoSipVirtual) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {isAutoSipVirtual
                ? 'Recurring SIP entry from account settings. Edit to create an adhoc one-time entry.'
                : 'Recurring entry. Edit affects this month only.'}
            </div>
          )}
          <div className="text-center py-4 bg-primary-50 rounded-xl">
            <p className="text-4xl font-bold text-primary-900">{formatCurrency(Number(investment.amount ?? 0))}</p>
          </div>
          <div className="text-sm text-gray-600 space-y-1">
            <p><span className="font-medium text-gray-800">Account:</span> {investment.account?.name ?? 'Account'}</p>
            <p><span className="font-medium text-gray-800">Date:</span> {investment.investment_date}</p>
            <p>
              <span className="font-medium text-gray-800">Type:</span>{' '}
              {isAutoRecurring ? 'Recurring' : investment.kind}
            </p>
            {investment.note && investment.note !== AUTO_RECURRING_NOTE && (
              <p><span className="font-medium text-gray-800">Note:</span> {investment.note}</p>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
