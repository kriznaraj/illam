'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { type PortfolioInstrumentType } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ModalRecordActions } from '@/components/ModalRecordActions';

const INSTRUMENT_TYPES: { value: PortfolioInstrumentType; label: string }[] = [
  { value: 'nse_stock', label: 'NSE Stock' },
  { value: 'bse_stock', label: 'BSE Stock' },
  { value: 'mf_nav', label: 'Mutual Fund (NAV)' },
  { value: 'us_stock', label: 'US Stock' },
  { value: 'gold_etf', label: 'Gold ETF' },
  { value: 'gold_physical', label: 'Physical Gold' },
  { value: 'gold_rate', label: 'Gold (rate × qty)' },
  { value: 'sgb', label: 'SGB' },
  { value: 'bond', label: 'Bond' },
  { value: 'nps', label: 'NPS' },
  { value: 'manual', label: 'Manual' },
];

const QUANTITY_UNITS = ['shares', 'units', 'grams', 'bonds', ''];

interface Holding {
  id: string;
  name: string;
  symbol: string | null;
  identifier: string;
  instrument_type: PortfolioInstrumentType;
  quantity_unit: string | null;
  sort_order: number;
  is_active: boolean;
  account_id: string;
  account?: { id: string; name: string; type: string };
}

export default function SettingsHoldingPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params?.id as string | undefined;
  const holdingId = params?.holdingId as string | undefined;

  const isNew = holdingId === 'new';

  const [holding, setHolding] = useState<Holding | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [editing, setEditing] = useState(isNew);
  const [form, setForm] = useState({
    name: '',
    symbol: '',
    identifier: '',
    instrument_type: 'manual' as PortfolioInstrumentType,
    quantity_unit: '',
    sort_order: 0,
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (isNew || !holdingId || !accountId) return;
    setLoading(true);
    fetch(`/api/portfolio/holdings?id=${holdingId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) {
          setHolding(data);
          setForm({
            name: data.name ?? '',
            symbol: data.symbol ?? '',
            identifier: data.identifier ?? '',
            instrument_type: data.instrument_type ?? 'manual',
            quantity_unit: data.quantity_unit ?? '',
            sort_order: data.sort_order ?? 0,
            is_active: data.is_active !== false,
          });
        } else {
          setHolding(null);
        }
      })
      .catch(() => setHolding(null))
      .finally(() => setLoading(false));
  }, [holdingId, accountId, isNew]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.identifier.trim()) {
      setError('Identifier is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        account_id: accountId,
        name: form.name.trim(),
      symbol: form.symbol.trim() || null,
      identifier: form.identifier.trim() || null,
        instrument_type: form.instrument_type,
        quantity_unit: form.quantity_unit || null,
        sort_order: form.sort_order,
        is_active: form.is_active,
      };
      const res = await fetch('/api/portfolio/holdings', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? payload : { id: holdingId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save');
        return;
      }
      if (isNew) {
        router.push(`/portfolio/settings/accounts/${accountId}`);
      } else {
        setHolding(data);
        setEditing(false);
        setError('');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (!holding) return;
    setForm({
      name: holding.name ?? '',
      symbol: holding.symbol ?? '',
      identifier: holding.identifier ?? '',
      instrument_type: holding.instrument_type ?? 'manual',
      quantity_unit: holding.quantity_unit ?? '',
      sort_order: holding.sort_order ?? 0,
      is_active: holding.is_active !== false,
    });
    setError('');
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!holdingId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/portfolio/holdings?id=${holdingId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError('Failed to delete');
        setDeleteConfirm(false);
        return;
      }
      router.push(`/portfolio/settings/accounts/${accountId}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <LoadingSpinner message="Loading instrument…" />
      </PageContainer>
    );
  }

  if (!isNew && !holding) {
    return (
      <PageContainer maxWidth="2xl">
        <PageHeader title="Not found" />
        <p className="text-gray-600">Instrument not found.</p>
        <Link href={`/portfolio/settings/accounts/${accountId}`} className="text-indigo-600 hover:underline mt-2 inline-block">
          ← Back to account
        </Link>
      </PageContainer>
    );
  }

  const accountName = holding?.account?.name ?? 'Account';
  const fetchTypeLabel = INSTRUMENT_TYPES.find((f) => f.value === (holding?.instrument_type ?? form.instrument_type))?.label ?? holding?.instrument_type ?? form.instrument_type;

  return (
    <PageContainer maxWidth="2xl">
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        {/* Mobile: single back link */}
        <Link
          href={`/portfolio/settings/accounts/${accountId}`}
          className="flex items-center gap-1 hover:text-gray-700 sm:hidden"
        >
          <span aria-hidden>←</span>
          <span className="truncate max-w-[180px]">{accountName}</span>
        </Link>

        {/* Desktop: full breadcrumb trail */}
        <Link href="/portfolio/settings" className="hover:text-gray-700 hidden sm:inline">Settings</Link>
        <span aria-hidden className="hidden sm:inline">/</span>
        <Link href="/portfolio/settings/accounts" className="hover:text-gray-700 hidden sm:inline">Accounts</Link>
        <span aria-hidden className="hidden sm:inline">/</span>
        <Link href={`/portfolio/settings/accounts/${accountId}`} className="hover:text-gray-700 hidden sm:inline truncate max-w-[120px]">{accountName}</Link>
        <span aria-hidden className="hidden sm:inline">/</span>
        <span className="text-gray-900 font-medium hidden sm:inline truncate max-w-[200px]">
          {isNew ? 'New instrument' : (holding?.name ?? 'Instrument')}
        </span>
      </nav>

      <PageHeader
        title={isNew ? 'Add instrument' : (holding?.name ?? '')}
        description={isNew ? undefined : fetchTypeLabel}
        action={
          !isNew && !editing ? (
            <div className="flex items-center gap-2">
              {deleteConfirm ? (
                <>
                  <span className="text-sm text-red-600 hidden sm:inline">Delete this instrument?</span>
                  <button type="button" onClick={() => setDeleteConfirm(false)} className="btn btn-secondary text-sm">Cancel</button>
                  <button type="button" onClick={handleDelete} disabled={deleting} className="btn btn-danger text-sm">
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </button>
                </>
              ) : (
                <ModalRecordActions
                  onDelete={() => setDeleteConfirm(true)}
                  onEdit={() => setEditing(true)}
                  compact
                />
              )}
            </div>
          ) : undefined
        }
      />

      {/* Details view */}
      {!editing && holding && (
        <div className="card mb-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Name</dt>
              <dd className="font-medium text-gray-900">{holding.name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Status</dt>
              <dd>
                {holding.is_active !== false ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Inactive</span>
                )}
              </dd>
            </div>
            {holding.symbol && (
              <div>
                <dt className="text-gray-500">Symbol</dt>
                <dd className="font-medium text-gray-900">{holding.symbol}</dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">Identifier</dt>
              <dd className="font-medium text-gray-900">{holding.identifier}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Price source</dt>
              <dd className="font-medium text-gray-900">{fetchTypeLabel}</dd>
            </div>
            {holding.quantity_unit && (
              <div>
                <dt className="text-gray-500">Quantity unit</dt>
                <dd className="font-medium text-gray-900">{holding.quantity_unit}</dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">Sort order</dt>
              <dd className="font-medium text-gray-900">{holding.sort_order}</dd>
            </div>
          </dl>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <Link
              href={`/portfolio/accounts/${accountId}/holdings/${holdingId}`}
              className="text-sm text-indigo-600 hover:underline"
            >
              View snapshot history →
            </Link>
          </div>
        </div>
      )}

      {/* Edit / create form */}
      {editing && (
        <>
          <div className="card mb-6">
            <div className="space-y-4">
              <div>
                <label className="label">Name</label>
                <input
                  type="text"
                  id="holding-name"
                  name="holding-name"
                  className="input"
                  placeholder="e.g. Bajaj Auto Ltd, Axis Mid Cap Fund"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Symbol <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    id="holding-symbol"
                    name="holding-symbol"
                    className="input"
                    placeholder="e.g. BAJAJ-AUTO, 119551"
                    value={form.symbol}
                    onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Identifier</label>
                  <input
                    type="text"
                    id="holding-identifier"
                    name="holding-identifier"
                    className="input"
                    placeholder="ISIN, scheme code, CUSIP, bond code…"
                    value={form.identifier}
                    onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Price source</label>
                  <select
                    id="holding-fetch-type"
                    name="holding-fetch-type"
                    className="select"
                    value={form.instrument_type}
                    onChange={(e) => setForm({ ...form, instrument_type: e.target.value as PortfolioInstrumentType })}
                  >
                    {INSTRUMENT_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Quantity unit <span className="text-gray-400 font-normal">(optional)</span></label>
                  <select
                    id="holding-qty-unit"
                    name="holding-qty-unit"
                    className="select"
                    value={form.quantity_unit}
                    onChange={(e) => setForm({ ...form, quantity_unit: e.target.value })}
                  >
                    {QUANTITY_UNITS.map((u) => (
                      <option key={u || '_'} value={u}>{u || '—'}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Sort order</label>
                  <input
                    type="number"
                    id="holding-sort-order"
                    name="holding-sort-order"
                    className="input"
                    min={0}
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                      className="w-4 h-4 rounded text-green-600"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-700">Active</p>
                      <p className="text-xs text-gray-400">Uncheck to deactivate</p>
                    </div>
                  </label>
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary">
              {saving ? 'Saving…' : isNew ? 'Add instrument' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={isNew ? () => router.push(`/portfolio/settings/accounts/${accountId}`) : handleCancelEdit}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </PageContainer>
  );
}
