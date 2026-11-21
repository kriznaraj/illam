'use client';

import { useState, useEffect } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import Modal from '@/components/Modal';
import { ModalRecordActions } from '@/components/ModalRecordActions';

interface GoldItem {
  id: string;
  name: string;
  purchased_from: string | null;
  purchased_at: string | null;
  maturity_date: string | null;
  buy_price: number | null;
  gross_weight: number;
  gold_weight: number;
  notes: string | null;
  item_type: 'physical' | 'sgb';
}

const emptyForm = {
  name: '',
  purchased_from: '',
  purchased_at: '',
  maturity_date: '',
  buy_price: '',
  gross_weight: '',
  gold_weight: '',
  notes: '',
  item_type: 'physical' as 'physical' | 'sgb',
};

const DEFAULT_PRICE_PER_GRAM = 9500;

function fmt(n: number) {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function fmtCurrency(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}


export default function GoldRegisterPage() {
  const [items, setItems] = useState<GoldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rate22k, setRate22k] = useState(DEFAULT_PRICE_PER_GRAM);
  const [rate24k, setRate24k] = useState(Math.round(DEFAULT_PRICE_PER_GRAM * 24 / 22));
  const [editingKarat, setEditingKarat] = useState<'22k' | '24k' | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [savingRate, setSavingRate] = useState(false);

  const [viewItem, setViewItem] = useState<GoldItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRate();
    fetchItems();
  }, []);

  const fetchRate = async () => {
    try {
      const res = await fetch('/api/portfolio/gold-rate');
      if (res.ok) {
        const data = await res.json();
        if (data.rate_22k) setRate22k(data.rate_22k);
        if (data.rate_24k) setRate24k(data.rate_24k);
      }
    } catch { /* use default */ }
  };

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/gold');
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const saveRate = async () => {
    if (!editingKarat) return;
    const p = parseFloat(rateInput);
    if (isNaN(p) || p <= 0) { setEditingKarat(null); return; }
    setSavingRate(true);
    try {
      const body = editingKarat === '22k' ? { rate_22k: p } : { rate_24k: p };
      const res = await fetch('/api/portfolio/gold-rate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (editingKarat === '22k') setRate22k(p);
        else setRate24k(p);
      }
    } finally {
      setSavingRate(false);
      setEditingKarat(null);
    }
  };

  const openCreate = () => {
    setViewItem(null);
    setForm(emptyForm);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setError('');
    setIsCreating(true);
  };

  const openView = (item: GoldItem) => {
    setViewItem(item);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setError('');
    setIsCreating(false);
  };

  const startEdit = () => {
    if (!viewItem) return;
    setForm({
      name: viewItem.name,
      purchased_from: viewItem.purchased_from ?? '',
      purchased_at: viewItem.purchased_at ?? '',
      maturity_date: viewItem.maturity_date ?? '',
      buy_price: viewItem.buy_price != null ? viewItem.buy_price.toString() : '',
      gross_weight: viewItem.gross_weight.toString(),
      gold_weight: viewItem.gold_weight.toString(),
      notes: viewItem.notes ?? '',
      item_type: viewItem.item_type ?? 'physical',
    });
    setError('');
    setIsEditing(true);
  };

  const closeModal = () => {
    setViewItem(null);
    setIsCreating(false);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setError('');
  };

  const handleClose = () => {
    if (isEditing) { setIsEditing(false); return; }
    closeModal();
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.gold_weight) { setError('Gold weight is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        purchased_from: form.purchased_from.trim() || null,
        purchased_at: form.purchased_at || null,
        maturity_date: form.maturity_date || null,
        buy_price: form.buy_price ? parseFloat(form.buy_price) : null,
        gross_weight: parseFloat(form.gross_weight) || 0,
        gold_weight: parseFloat(form.gold_weight),
        notes: form.notes.trim() || null,
        item_type: form.item_type,
      };
      const res = await fetch('/api/portfolio/gold', {
        method: isEditing && viewItem ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEditing && viewItem ? { id: viewItem.id, ...payload } : payload),
      });
      if (!res.ok) { setError('Failed to save'); return; }
      await fetchItems();
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!viewItem) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/portfolio/gold?id=${viewItem.id}`, { method: 'DELETE' });
      if (!res.ok) { setError('Failed to delete'); setShowDeleteConfirm(false); return; }
      await fetchItems();
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const physicalItems = items.filter(i => i.item_type === 'physical');
  const sgbItems = items.filter(i => i.item_type === 'sgb');

  const physicalGrams = physicalItems.reduce((s, i) => s + i.gold_weight, 0);
  const physicalValue = physicalGrams * rate22k;
  const sgbGrams = sgbItems.reduce((s, i) => s + i.gold_weight, 0);
  const sgbValue = sgbGrams * rate24k;

  // Use the correct rate per item type in tables
  const rateForItem = (item: GoldItem) => item.item_type === 'physical' ? rate22k : rate24k;

  const isModalOpen = !!viewItem || isCreating;
  const modalTitle = isCreating ? 'Add Gold Item' : isEditing ? 'Edit Item' : (viewItem?.name ?? '');

  const modalFooter = isEditing || isCreating ? (
    <div className="flex gap-2 w-full">
      <button onClick={handleSave} disabled={saving} className="btn btn-primary">
        {saving ? 'Saving…' : isCreating ? 'Create' : 'Edit'}
      </button>
    </div>
  ) : showDeleteConfirm ? undefined : (
    <ModalRecordActions
      onDelete={() => setShowDeleteConfirm(true)}
      onEdit={startEdit}
    />
  );

  const RateEditor = ({ karat, rate }: { karat: '22k' | '24k'; rate: number }) => {
    const isEditing = editingKarat === karat;
    return isEditing ? (
      <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
        <span className="text-xs text-gray-400">₹</span>
        <input
          type="number" autoFocus value={rateInput}
          onChange={(e) => setRateInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveRate(); if (e.key === 'Escape') setEditingKarat(null); }}
          className="w-20 text-xs font-mono outline-none"
          placeholder="per gram"
        />
        <button onClick={saveRate} disabled={savingRate} className="text-xs text-blue-600 font-semibold">
          {savingRate ? '…' : 'Save'}
        </button>
        <button onClick={() => setEditingKarat(null)} className="text-xs text-gray-400">✕</button>
      </div>
    ) : (
      <button
        onClick={() => { setRateInput(rate.toString()); setEditingKarat(karat); }}
        className="text-xs bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200 rounded-lg px-3 py-1.5 font-medium transition-colors"
      >
        {karat} · ₹{fmt(rate)}/g ✎
      </button>
    );
  };

  const ItemTable = ({ list, rate }: { list: GoldItem[]; rate: number }) => (
    <div className="card p-0 overflow-hidden">
      <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <span>Name</span><span>From</span>
        <span className="text-right">Gross (g)</span>
        <span className="text-right">Gold (g)</span>
        <span className="text-right">Value</span>
      </div>
      <div className="divide-y divide-gray-100">
        {list.map((item) => {
          const value = item.gold_weight * rate;
          return (
            <button key={item.id} onClick={() => openView(item)} className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="sm:hidden flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                  {item.purchased_from && <p className="text-xs text-gray-400 mt-0.5 truncate">{item.purchased_from}</p>}
                  <p className="text-xs text-gray-400">
                    {item.purchased_at && new Date(item.purchased_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                    {item.maturity_date && ` → ${new Date(item.maturity_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-yellow-700">{fmtCurrency(value)}</p>
                  <p className="text-xs text-gray-500">{fmt(item.gold_weight)} g</p>
                </div>
              </div>
              <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-4 items-center">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                  <p className="text-xs text-gray-400">
                    {item.purchased_at && new Date(item.purchased_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                    {item.maturity_date && ` → ${new Date(item.maturity_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
                    {!item.maturity_date && item.buy_price != null && ` · ${fmtCurrency(item.buy_price)}`}
                  </p>
                  {item.notes && <p className="text-xs text-gray-400 truncate">{item.notes}</p>}
                </div>
                <p className="text-sm text-gray-600 truncate">{item.purchased_from ?? '—'}</p>
                <p className="text-sm text-gray-700 text-right w-16">{fmt(item.gross_weight)}</p>
                <p className="text-sm font-medium text-gray-900 text-right w-16">{fmt(item.gold_weight)}</p>
                <p className="text-sm font-semibold text-yellow-700 text-right w-24">{fmtCurrency(value)}</p>
              </div>
            </button>
          );
        })}
      </div>
      <div className="border-t-2 border-gray-200 bg-gray-50 px-4 py-3 hidden sm:grid sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:gap-4">
        <span className="text-sm font-semibold text-gray-700">Total</span>
        <span />
        <span className="text-sm text-gray-600 text-right w-16">{fmt(list.reduce((s, i) => s + i.gross_weight, 0))}</span>
        <span className="text-sm font-bold text-gray-900 text-right w-16">{fmt(list.reduce((s, i) => s + i.gold_weight, 0))}</span>
        <span className="text-sm font-bold text-yellow-700 text-right w-24">{fmtCurrency(list.reduce((s, i) => s + i.gold_weight, 0) * rate)}</span>
      </div>
    </div>
  );

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Gold Register"
        description="Track your gold holdings"
        action={<button onClick={openCreate} className="btn btn-primary">+ Add Item</button>}
      />

      {/* ── Physical Gold section ── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">Physical Gold</h2>
            <p className="text-xs text-gray-500 mt-0.5">{fmt(physicalGrams)} g · {fmtCurrency(physicalValue)}</p>
          </div>
          <RateEditor karat="22k" rate={rate22k} />
        </div>

        {loading ? <LoadingSpinner message="Loading…" /> : physicalItems.length === 0 ? (
          <EmptyState icon="🥇" title="No physical gold" description="Add jewellery, coins or bars." action={{ label: '+ Add Item', onClick: openCreate }} />
        ) : (
          <ItemTable list={physicalItems} rate={rate22k} />
        )}
      </div>

      {/* ── SGBs section ── */}
      {(sgbItems.length > 0 || !loading) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold text-gray-900">Sovereign Gold Bonds</h2>
              {sgbItems.length > 0 && (
                <p className="text-xs text-gray-500 mt-0.5">{fmt(sgbGrams)} g · {fmtCurrency(sgbValue)}</p>
              )}
            </div>
            <RateEditor karat="24k" rate={rate24k} />
          </div>
          {sgbItems.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No SGBs added yet.</p>
          ) : (
            <ItemTable list={sgbItems} rate={rate24k} />
          )}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={handleClose}
        title={modalTitle}
        footer={modalFooter}
      >
        {/* ── View mode ── */}
        {!isCreating && !isEditing && viewItem && !showDeleteConfirm && (() => {
          const item = viewItem;
          const itemRate = rateForItem(item);
          const value = item.gold_weight * itemRate;
          return (
            <div className="space-y-4">
              <div className="text-center py-5 bg-yellow-50 rounded-xl">
                <p className="text-4xl font-bold text-yellow-700">{fmtCurrency(value)}</p>
                <p className="text-sm text-yellow-600 mt-1">{fmt(item.gold_weight)} g × ₹{fmt(itemRate)}/g ({item.item_type === 'physical' ? '22k' : '24k'})</p>
              </div>

              {item.item_type === 'sgb' && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                  📄 Sovereign Gold Bond
                </span>
              )}

              <div className="space-y-2">
                {item.purchased_from && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{item.item_type === 'sgb' ? 'Broker' : 'Purchased From'}</span>
                    <span className="font-medium text-gray-900 text-right max-w-[60%]">{item.purchased_from}</span>
                  </div>
                )}
                {item.purchased_at && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{item.item_type === 'sgb' ? 'Subscription' : 'Purchase Date'}</span>
                    <span className="font-medium text-gray-900">
                      {new Date(item.purchased_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                )}
                {item.maturity_date && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Maturity</span>
                    <span className="font-medium text-gray-900">
                      {new Date(item.maturity_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                )}
                {item.buy_price != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{item.item_type === 'sgb' ? 'Issue Price' : 'Buy Price'}</span>
                    <span className="font-medium text-gray-900">{fmtCurrency(item.buy_price)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-gray-100 pt-2 mt-2">
                  <span className="text-gray-500">Gross Weight</span>
                  <span className="font-medium text-gray-900">{fmt(item.gross_weight)} g</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Gold Weight</span>
                  <span className="font-bold text-gray-900">{fmt(item.gold_weight)} g</span>
                </div>
              </div>

              {item.notes && (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{item.notes}</p>
              )}
            </div>
          );
        })()}

        {/* ── Delete confirm ── */}
        {showDeleteConfirm && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="text-4xl mb-3">🗑️</div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Delete this item?</h3>
            <p className="text-sm text-gray-500 mb-6">This action cannot be undone.</p>
            <div className="flex gap-3 w-full">
              <button onClick={handleDelete} className="btn btn-danger flex-1" disabled={saving}>
                {saving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}

        {/* ── Edit / Create form ── */}
        {(isCreating || isEditing) && (
        <div className="space-y-4">
          {/* Type toggle */}
          <div className="flex gap-2">
            {(['physical', 'sgb'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setForm({ ...form, item_type: t })}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  form.item_type === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t === 'physical' ? '🥇 Physical' : '📄 SGB'}
              </button>
            ))}
          </div>

          <div>
            <label className="label">Name</label>
            <input
              type="text" className="input" autoFocus
              placeholder={form.item_type === 'sgb' ? 'e.g. SGB 2021-22 Series VII' : 'e.g. Chain, Bangles, Coin'}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="label">{form.item_type === 'sgb' ? 'Broker / Platform' : 'Purchased From'}</label>
            <input
              type="text" className="input"
              placeholder={form.item_type === 'sgb' ? 'e.g. Zerodha Demat' : 'e.g. Lalitha, T Nagar'}
              value={form.purchased_from}
              onChange={(e) => setForm({ ...form, purchased_from: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{form.item_type === 'sgb' ? 'Subscription Date' : 'Purchase Date'}</label>
              <input
                type="date" className="input"
                value={form.purchased_at}
                onChange={(e) => setForm({ ...form, purchased_at: e.target.value })}
              />
            </div>
            {form.item_type === 'sgb' ? (
              <div>
                <label className="label">Maturity Date</label>
                <input
                  type="date" className="input"
                  value={form.maturity_date}
                  onChange={(e) => setForm({ ...form, maturity_date: e.target.value })}
                />
              </div>
            ) : (
              <div>
                <label className="label">Buy Price <span className="text-gray-400 font-normal">(optional)</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                  <input
                    type="number" className="input pl-7" min="0" step="any"
                    placeholder="0.00"
                    value={form.buy_price}
                    onChange={(e) => setForm({ ...form, buy_price: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          {form.item_type === 'sgb' && (
            <div>
              <label className="label">Issue Price (total) <span className="text-gray-400 font-normal">(optional)</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                <input
                  type="number" className="input pl-7" min="0" step="any"
                  placeholder="0.00"
                  value={form.buy_price}
                  onChange={(e) => setForm({ ...form, buy_price: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Gross Weight (g)</label>
              <input
                type="number" className="input" min="0" step="any"
                placeholder="0"
                value={form.gross_weight}
                onChange={(e) => setForm({ ...form, gross_weight: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Gold Weight (g)</label>
              <input
                type="number" className="input" min="0" step="any"
                placeholder="0"
                value={form.gold_weight}
                onChange={(e) => setForm({ ...form, gold_weight: e.target.value })}
              />
            </div>
          </div>

          {form.gold_weight && (
            <div className="bg-yellow-50 rounded-lg px-3 py-2 text-sm text-yellow-800">
              Current value: <strong>{fmtCurrency(parseFloat(form.gold_weight) * (form.item_type === 'physical' ? rate22k : rate24k))}</strong>
              <span className="text-yellow-600 text-xs ml-1">@ ₹{fmt(form.item_type === 'physical' ? rate22k : rate24k)}/g ({form.item_type === 'physical' ? '22k' : '24k'})</span>
            </div>
          )}

          <div>
            <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              className="input resize-none" rows={2}
              placeholder="Any additional details"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        )}
      </Modal>
    </PageContainer>
  );
}
