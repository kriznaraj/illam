'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';
import Modal from '@/components/Modal';
import { ModalRecordActions } from '@/components/ModalRecordActions';
import { Tag } from 'lucide-react';

interface AccountType {
  id: string;
  name: string;
  color: string;
  show_in_growth: boolean;
  is_equity: boolean;
}

const PRESET_COLORS = [
  '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe',
  '#10b981', '#34d399', '#6ee7b7',
  '#a855f7', '#8b5cf6', '#c4b5fd',
  '#f59e0b', '#eab308', '#fde68a',
  '#ef4444', '#f87171', '#f97316',
  '#14b8a6', '#06b6d4', '#6b7280',
];

const emptyTypeForm = { name: '', color: '#6b7280', show_in_growth: false, is_equity: false };

export default function SettingsAccountTypesPage() {
  const [types, setTypes] = useState<AccountType[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typeModal, setTypeModal] = useState<'create' | 'edit' | null>(null);
  const [selectedType, setSelectedType] = useState<AccountType | null>(null);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [typeDeleteConfirm, setTypeDeleteConfirm] = useState(false);
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeError, setTypeError] = useState('');

  const fetchTypes = async () => {
    setTypesLoading(true);
    try {
      const res = await fetch('/api/portfolio/account-types');
      const data = await res.json();
      setTypes(Array.isArray(data) ? data : []);
    } catch {
      setTypes([]);
    } finally {
      setTypesLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount
    fetchTypes();
  }, []);

  const openNewType = () => {
    setSelectedType(null);
    setTypeForm({ ...emptyTypeForm });
    setTypeDeleteConfirm(false);
    setTypeError('');
    setTypeModal('create');
  };

  const openEditType = (t: AccountType) => {
    setSelectedType(t);
    setTypeForm({ name: t.name, color: t.color, show_in_growth: t.show_in_growth, is_equity: t.is_equity });
    setTypeDeleteConfirm(false);
    setTypeError('');
    setTypeModal('edit');
  };

  const closeTypeModal = () => {
    setTypeModal(null);
    setSelectedType(null);
    setTypeDeleteConfirm(false);
    setTypeError('');
  };

  const handleSaveType = async () => {
    if (!typeForm.name.trim()) {
      setTypeError('Name is required');
      return;
    }
    setTypeSaving(true);
    setTypeError('');
    try {
      const isEdit = typeModal === 'edit' && selectedType;
      const res = await fetch('/api/portfolio/account-types', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: selectedType.id, ...typeForm } : typeForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setTypeError(data.error || 'Failed to save');
        return;
      }
      await fetchTypes();
      closeTypeModal();
    } finally {
      setTypeSaving(false);
    }
  };

  const handleDeleteType = async () => {
    if (!selectedType) return;
    setTypeSaving(true);
    try {
      const res = await fetch(
        `/api/portfolio/account-types?id=${selectedType.id}&name=${encodeURIComponent(selectedType.name)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) {
        setTypeError(data.error || 'Failed to delete');
        setTypeDeleteConfirm(false);
        return;
      }
      await fetchTypes();
      closeTypeModal();
    } finally {
      setTypeSaving(false);
    }
  };

  const typeModalFooter = typeDeleteConfirm ? (
    <div className="flex items-center gap-3 w-full">
      <span className="text-sm text-red-600 flex-1">Delete this type?</span>
      <button
        onClick={handleDeleteType}
        disabled={typeSaving}
        className="btn btn-danger"
      >
        {typeSaving ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  ) : (
    <div className="flex gap-2 w-full">
      {typeModal === 'edit' ? (
        <ModalRecordActions
          onDelete={() => setTypeDeleteConfirm(true)}
          onEdit={handleSaveType}
          editDisabled={typeSaving}
        />
      ) : (
        <button
          onClick={handleSaveType}
          disabled={typeSaving}
          className="btn btn-primary"
        >
          {typeSaving ? 'Saving…' : 'Create'}
        </button>
      )}
    </div>
  );

  return (
    <PageContainer maxWidth="2xl">
      <Link
        href="/portfolio/settings"
        className="inline-block text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        ← Settings
      </Link>
      <PageHeader
        title="Account types"
        description="Types and colors for grouping accounts (Stocks, Mutual Funds, Gold, etc.)"
      />

      {typesLoading ? (
        <LoadingSpinner message="Loading types…" />
      ) : (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={openNewType} className="btn btn-primary">
              + New Type
            </button>
          </div>

          {types.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="No account types yet"
              description="Add your first account type to get started."
              action={{ label: '+ New Type', onClick: openNewType }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {types.map((t) => (
                <div
                  key={t.id}
                  onClick={() => openEditType(t)}
                  className="card cursor-pointer hover:shadow-md transition-shadow flex items-center gap-3"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex-shrink-0"
                    style={{ backgroundColor: t.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 leading-snug break-words">{t.name}</p>
                    {(t.show_in_growth || t.is_equity) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.show_in_growth && (
                          <span className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                            Growth
                          </span>
                        )}
                        {t.is_equity && (
                          <span className="text-[11px] font-semibold text-primary-700 bg-primary-50 border border-primary-200 px-2 py-0.5 rounded-full">
                            Equity
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-300 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        isOpen={!!typeModal}
        onClose={closeTypeModal}
        title={typeModal === 'create' ? 'New Account Type' : 'Edit Type'}
        footer={typeModalFooter}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Crypto"
              value={typeForm.name}
              onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
              autoFocus
            />
          </div>

          <div>
            <label className="label">Color</label>
            <div className="flex items-center gap-3 mb-2">
              <input
                type="color"
                value={typeForm.color}
                onChange={(e) => setTypeForm({ ...typeForm, color: e.target.value })}
                className="w-10 h-10 rounded cursor-pointer border border-gray-200"
              />
              <span className="font-mono text-sm text-gray-600">{typeForm.color}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setTypeForm({ ...typeForm, color: c })}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                    typeForm.color === c ? 'ring-2 ring-offset-1 ring-gray-900 scale-110' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 py-2">
            <button
              onClick={() =>
                setTypeForm({ ...typeForm, show_in_growth: !typeForm.show_in_growth })
              }
              className={`relative w-11 h-6 rounded-full transition-colors ${
                typeForm.show_in_growth ? 'bg-green-500' : 'bg-gray-200'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  typeForm.show_in_growth ? 'translate-x-5' : ''
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-medium text-gray-700">Show in growth chart</p>
              <p className="text-xs text-gray-400">Include in growth rate & trend charts</p>
            </div>
          </div>

          <div className="flex items-center gap-3 py-2">
            <button
              onClick={() =>
                setTypeForm({ ...typeForm, is_equity: !typeForm.is_equity })
              }
              className={`relative w-11 h-6 rounded-full transition-colors ${
                typeForm.is_equity ? 'bg-primary-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  typeForm.is_equity ? 'translate-x-5' : ''
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-medium text-gray-700">Equity type</p>
              <p className="text-xs text-gray-400">Mark this type as equity (e.g. stocks, mutual funds)</p>
            </div>
          </div>

          {typeError && <p className="text-sm text-red-600">{typeError}</p>}
        </div>
      </Modal>
    </PageContainer>
  );
}
