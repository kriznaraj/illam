'use client';

import { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ExpenseWithCategory, Category, Event, Tag } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { ExpenseCard } from '@/components/expenses/ExpenseCard';
import ExpenseDetailModal from '@/components/ExpenseDetailModal';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import Toast from '@/components/Toast';
import TagSelector from '@/components/TagSelector';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useExpenses } from '@/lib/hooks/useExpenses';
import { usePaymentSources } from '@/lib/hooks/usePaymentSources';
import { useCategories } from '@/lib/hooks/useCategories';
import { useEvents } from '@/lib/hooks/useEvents';
import { useTags } from '@/lib/hooks/useTags';
import AutocompleteDropdown from '@/components/AutocompleteDropdown';
import type { AutocompleteOption } from '@/components/AutocompleteDropdown';
import { Receipt, Tag as TagIcon, Calendar, Trash2, ListChecks, Download } from 'lucide-react';

type DateRange = 'last-1m' | 'last-3m' | 'current-year' | 'custom';
type SortBy = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'category';

function ExpensesBrowseContent() {
  const searchParams = useSearchParams();
  const [editingExpense, setEditingExpense] = useState<ExpenseWithCategory | null>(null);
  
  // Filter states — seed from URL params when navigating from the dashboard
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    searchParams.get('startDate') ? 'custom' : 'last-1m'
  );
  const [customStartDate, setCustomStartDate] = useState(() => searchParams.get('startDate') ?? '');
  const [customEndDate, setCustomEndDate] = useState(() => searchParams.get('endDate') ?? '');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedEvent, setSelectedEvent] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date-desc');
  
  // Multi-select for bulk operations
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedExpenses, setSelectedExpenses] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showBulkLabelModal, setShowBulkLabelModal] = useState(false);
  const [showBulkEventModal, setShowBulkEventModal] = useState(false);
  const [bulkSelectedTags, setBulkSelectedTags] = useState<Tag[]>([]);
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);

  // Calculate date range
  const dateRangeParams = useMemo(() => {
    const today = new Date();

    switch (dateRange) {
      case 'last-1m': {
        const oneMonthAgo = subDays(today, 30);
        return { start: format(oneMonthAgo, 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
      }
      case 'last-3m': {
        const threeMonthsAgo = subDays(today, 90);
        return { start: format(threeMonthsAgo, 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
      }
      case 'current-year':
        return {
          start: `${today.getFullYear()}-01-01`,
          end: format(today, 'yyyy-MM-dd')
        };
      case 'custom':
        return { start: customStartDate, end: customEndDate };
      default:
        return { start: '', end: '' };
    }
  }, [dateRange, customStartDate, customEndDate]);

  // Use hooks for data fetching
  const { categories } = useCategories();
  const { events } = useEvents();
  const { tags } = useTags();
  const { expenses: fetchedExpenses, loading, refetch } = useExpenses(
    dateRangeParams.start,
    dateRangeParams.end
  );
  // Names and colours the payment-source dot from the cards under Net worth; empty until it loads.
  const { cards: paymentCards } = usePaymentSources();

  const expenses = useMemo(() => {
    return Array.isArray(fetchedExpenses) ? fetchedExpenses : [];
  }, [fetchedExpenses]);

  // Resolve category/tag ID from name once the lists are loaded
  useEffect(() => {
    const name = searchParams.get('category');
    if (name && categories.length > 0) {
      const match = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
      // eslint-disable-next-line react-hooks/set-state-in-effect -- applies the ?category= link once the async list has loaded
      if (match) setSelectedCategory(match.id);
    }
  }, [categories, searchParams]);

  useEffect(() => {
    const name = searchParams.get('tag');
    if (name && tags.length > 0) {
      const match = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      // eslint-disable-next-line react-hooks/set-state-in-effect -- applies the ?tag= link once the async list has loaded
      if (match) setSelectedTag(match.id);
    }
  }, [tags, searchParams]);

  // Convert data to AutocompleteOption format
  const categoryOptions: AutocompleteOption[] = categories.map(cat => ({
    id: cat.id,
    label: cat.name,
    sublabel: cat.group_name,
    icon: cat.icon,
  }));

  const eventOptions: AutocompleteOption[] = events.map(event => ({
    id: event.id,
    label: event.name,
    icon: '●',
    color: event.color,
  }));

  const tagOptions: AutocompleteOption[] = tags.map((tag) => ({
    id: tag.id,
    label: tag.name,
    icon: '●',
    color: tag.color,
  }));

  useEffect(() => {
    const handleExpenseAdded = () => refetch();
    window.addEventListener('expenseAdded', handleExpenseAdded);
    return () => window.removeEventListener('expenseAdded', handleExpenseAdded);
  }, [refetch]);

  // Apply filters
  let filteredExpenses = [...expenses];

  // Search filter
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filteredExpenses = filteredExpenses.filter(e =>
      e.description?.toLowerCase().includes(query) ||
      e.category?.name.toLowerCase().includes(query) ||
      e.user?.full_name.toLowerCase().includes(query)
    );
  }

  // Category filter
  if (selectedCategory) {
    filteredExpenses = filteredExpenses.filter(e =>
      e.category_id === selectedCategory
    );
  }

  // Event filter
  if (selectedEvent) {
    filteredExpenses = filteredExpenses.filter(e =>
      e.event_id === selectedEvent
    );
  }

  // Tag filter
  if (selectedTag) {
    filteredExpenses = filteredExpenses.filter(e =>
      e.tags?.some((t) => t.id === selectedTag)
    );
  }

  // Amount range filter
  if (minAmount) {
    filteredExpenses = filteredExpenses.filter(e =>
      parseFloat(e.amount.toString()) >= parseFloat(minAmount)
    );
  }
  if (maxAmount) {
    filteredExpenses = filteredExpenses.filter(e =>
      parseFloat(e.amount.toString()) <= parseFloat(maxAmount)
    );
  }

  // Sort
  filteredExpenses.sort((a, b) => {
    switch (sortBy) {
      case 'date-desc':
        return b.date.localeCompare(a.date);
      case 'date-asc':
        return a.date.localeCompare(b.date);
      case 'amount-desc':
        return parseFloat(b.amount.toString()) - parseFloat(a.amount.toString());
      case 'amount-asc':
        return parseFloat(a.amount.toString()) - parseFloat(b.amount.toString());
      case 'category':
        return (a.category?.name || '').localeCompare(b.category?.name || '');
      default:
        return 0;
    }
  });

  const totalAmount = filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0);

  // Multi-select handlers
  const toggleExpenseSelection = (expenseId: string) => {
    const newSelected = new Set(selectedExpenses);
    if (newSelected.has(expenseId)) {
      newSelected.delete(expenseId);
    } else {
      newSelected.add(expenseId);
    }
    setSelectedExpenses(newSelected);
  };

  const selectAll = () => {
    setSelectedExpenses(new Set(filteredExpenses.map(e => e.id)));
  };

  const clearSelection = () => {
    setSelectedExpenses(new Set());
    setIsMultiSelectMode(false);
  };

  const handleBulkDelete = async () => {
    const count = selectedExpenses.size;
    if (count === 0) return;

    try {
      const deletePromises = Array.from(selectedExpenses).map(id =>
        fetch(`/api/expenses?id=${id}`, { method: 'DELETE' })
      );
      
      await Promise.all(deletePromises);
      
      setToast({
        message: `Deleted ${count} expense${count !== 1 ? 's' : ''}`,
        type: 'success'
      });
      
      clearSelection();
      refetch();
    } catch (error) {
      setToast({
        message: 'Failed to delete expenses',
        type: 'error'
      });
    } finally {
      setConfirmBulkDeleteOpen(false);
    }
  };

  const handleBulkAddLabels = async () => {
    if (bulkSelectedTags.length === 0) {
      setToast({
        message: 'Please select at least one label',
        type: 'error'
      });
      return;
    }

    try {
      const tagIds = bulkSelectedTags.map(t => t.id);
      
      const updates = Array.from(selectedExpenses).map(async (expenseId) => {
        const expense = expenses.find(e => e.id === expenseId);
        if (!expense) return;

        const existingTagIds = expense.tags?.map((t) => t.id) || [];
        const mergedTagIds = [...new Set([...existingTagIds, ...tagIds])];

        return fetch('/api/expenses', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: expense.id,
            date: expense.date,
            amount: parseFloat(expense.amount.toString()),
            category_id: expense.category_id,
            description: expense.description,
            user_id: expense.user_id,
            event_id: expense.event_id || null,
            tag_ids: mergedTagIds,
          }),
        });
      });

      await Promise.all(updates.filter(Boolean));

      setToast({
        message: `Added ${bulkSelectedTags.length} label(s) to ${selectedExpenses.size} expenses`,
        type: 'success'
      });

      setShowBulkLabelModal(false);
      setBulkSelectedTags([]);
      clearSelection();
      refetch();
    } catch (error) {
      setToast({
        message: 'Failed to add labels',
        type: 'error'
      });
    }
  };

  const handleBulkSetEvent = async (eventId: string) => {
    try {
      const updates = Array.from(selectedExpenses).map(async (expenseId) => {
        const expense = expenses.find(e => e.id === expenseId);
        if (!expense) return;

        return fetch('/api/expenses', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: expense.id,
            date: expense.date,
            amount: parseFloat(expense.amount.toString()),
            category_id: expense.category_id,
            description: expense.description,
            user_id: expense.user_id,
            event_id: eventId || null,
            tag_ids: expense.tags?.map((t) => t.id) || [],
          }),
        });
      });

      await Promise.all(updates.filter(Boolean));

      setToast({
        message: `Updated event for ${selectedExpenses.size} expenses`,
        type: 'success'
      });

      setShowBulkEventModal(false);
      clearSelection();
      refetch();
    } catch (error) {
      setToast({
        message: 'Failed to update events',
        type: 'error'
      });
    }
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Description', 'Category', 'Amount', 'User', 'Event', 'Tags'];
    const rows = filteredExpenses.map(e => [
      e.date,
      e.description || '',
      e.category?.name || '',
      e.amount,
      e.user?.full_name || '',
      e.event?.name || '',
      e.tags?.map((t) => t.name).join('; ') || ''
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    
    setToast({
      message: 'Exported to CSV',
      type: 'success'
    });
  };

  const activeFilterCount = [
    searchQuery,
    selectedCategory,
    selectedEvent,
    selectedTag,
    minAmount,
    maxAmount,
    dateRange !== 'last-1m'
  ].filter(Boolean).length;

  return (
    <PageContainer>
      <PageHeader
        title="Browse expenses"
      />

      {/* Filter Panel */}
      <div className="card mb-4">
        {activeFilterCount > 0 && (
          <div className="flex justify-end mb-4">
            <button
              onClick={() => {
                setSearchQuery('');
                setDateRange('last-1m');
                setSelectedCategory('');
                setSelectedEvent('');
                setSelectedTag('');
                setMinAmount('');
                setMaxAmount('');
              }}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Clear All
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Search */}
          <div className="lg:col-span-3">
            <label className="label mb-2">
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by description, category, or user..."
              className="input"
            />
          </div>

          {/* Date Range */}
          <div>
            <label className="label mb-2">
              Date Range
            </label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
              className="select"
            >
              <option value="last-1m">Last 1 Month</option>
              <option value="last-3m">Last 3 Months</option>
              <option value="current-year">Current Year</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {/* Custom Date Range */}
          {dateRange === 'custom' && (
            <>
              <div>
                <label className="label mb-2">
                  From Date
                </label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label mb-2">
                  To Date
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="input"
                />
              </div>
            </>
          )}

          {/* Category */}
          <AutocompleteDropdown
            label="Category"
            options={categoryOptions}
            value={selectedCategory}
            onChange={(value) => setSelectedCategory(value)}
            placeholder="Filter by category..."
            filterKeys={['label', 'sublabel']}
            inputClassName="input"
          />

          {/* Event */}
          <AutocompleteDropdown
            label="Event"
            options={eventOptions}
            value={selectedEvent}
            onChange={(value) => setSelectedEvent(value)}
            placeholder="Filter by event..."
            filterKeys={['label']}
            inputClassName="input"
            renderOption={(option) => (
              <div className="flex items-center gap-2">
                {option.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span className="text-sm">{option.label}</span>
              </div>
            )}
          />

          {/* Tag */}
          <AutocompleteDropdown
            label="Label"
            options={tagOptions}
            value={selectedTag}
            onChange={(value) => setSelectedTag(value)}
            placeholder="Filter by label..."
            filterKeys={['label']}
            inputClassName="input"
            renderOption={(option) => (
              <div className="flex items-center gap-2">
                {option.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span className="text-sm font-mono">{option.label}</span>
              </div>
            )}
          />

          {/* Min Amount */}
          <div>
            <label className="label mb-2">
              Min Amount
            </label>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="0"
              className="input"
            />
          </div>

          {/* Max Amount */}
          <div>
            <label className="label mb-2">
              Max Amount
            </label>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="No limit"
              className="input"
            />
          </div>

          {/* Sort By */}
          <div>
            <label className="label mb-2">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="select"
            >
              <option value="date-desc">Date (Newest First)</option>
              <option value="date-asc">Date (Oldest First)</option>
              <option value="amount-desc">Amount (Highest First)</option>
              <option value="amount-asc">Amount (Lowest First)</option>
              <option value="category">Category (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Summary */}
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-600 mb-1">Total</p>
            <p className="text-base sm:text-xl font-bold text-primary-900 truncate">{formatCurrency(totalAmount)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-600 mb-1">Count</p>
            <p className="text-base sm:text-xl font-bold text-gray-900">{filteredExpenses.length}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-600 mb-1">Average</p>
            <p className="text-base sm:text-xl font-bold text-gray-900 truncate">
              {filteredExpenses.length > 0 
                ? formatCurrency(totalAmount / filteredExpenses.length)
                : formatCurrency(0)}
            </p>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {isMultiSelectMode ? (
            <>
              <button onClick={selectAll} className="btn btn-secondary text-sm">
                Select All
              </button>
              <button onClick={clearSelection} className="btn btn-secondary text-sm">
                Cancel ({selectedExpenses.size})
              </button>
              {selectedExpenses.size > 0 && (
                <>
                  <button onClick={() => setShowBulkLabelModal(true)} className="btn btn-primary text-sm">
                    <TagIcon size={16} aria-hidden />
                    Labels ({selectedExpenses.size})
                  </button>
                  <button onClick={() => setShowBulkEventModal(true)} className="btn btn-primary text-sm">
                    <Calendar size={16} aria-hidden />
                    Event ({selectedExpenses.size})
                  </button>
                  <button onClick={() => setConfirmBulkDeleteOpen(true)} className="btn btn-danger text-sm">
                    <Trash2 size={16} aria-hidden />
                    Delete ({selectedExpenses.size})
                  </button>
                </>
              )}
            </>
          ) : (
            <button
              onClick={() => setIsMultiSelectMode(true)}
              className="btn btn-secondary text-sm"
            >
              <ListChecks size={16} aria-hidden />
              Multi-Select
            </button>
          )}
        </div>
        
        <button onClick={handleExportCSV} className="btn btn-secondary text-sm">
          <Download size={16} aria-hidden />
          Export CSV
        </button>
      </div>

      {/* Bulk Label Modal */}
      {showBulkLabelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-lg w-full sm:max-w-md">
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Add Labels</h3>
                <button
                  onClick={() => {
                    setShowBulkLabelModal(false);
                    setBulkSelectedTags([]);
                  }}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                Add labels to {selectedExpenses.size} expense{selectedExpenses.size !== 1 ? 's' : ''}
              </p>
            </div>
            
            <div className="p-4">
              <TagSelector
                selectedTags={bulkSelectedTags}
                onTagsChange={(tags) => setBulkSelectedTags(tags)}
              />
            </div>
            
            <div className="bg-white border-t border-gray-200 p-4 flex gap-2">
              <button
                onClick={() => {
                  setShowBulkLabelModal(false);
                  setBulkSelectedTags([]);
                }}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkAddLabels}
                className="btn btn-primary flex-1"
                disabled={bulkSelectedTags.length === 0}
              >
                Add Labels
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Event Modal */}
      {showBulkEventModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-lg w-full sm:max-w-md max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Set Event</h3>
                <button
                  onClick={() => setShowBulkEventModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {selectedExpenses.size} expense{selectedExpenses.size !== 1 ? 's' : ''} selected
              </p>
            </div>
            
            <div className="p-4 space-y-2">
              <button
                onClick={() => handleBulkSetEvent('')}
                className="w-full text-left p-3 hover:bg-gray-50 rounded-lg border border-gray-200 text-sm font-medium"
              >
                No Event
              </button>
              {events.map((event) => (
                <button
                  key={event.id}
                  onClick={() => handleBulkSetEvent(event.id)}
                  className="w-full text-left p-3 hover:bg-gray-50 rounded-lg border border-gray-200 flex items-center gap-3"
                >
                  <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: event.color }} />
                  <span className="text-sm font-medium">{event.name}</span>
                </button>
              ))}
            </div>
            
            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
              <button
                onClick={() => setShowBulkEventModal(false)}
                className="btn btn-secondary w-full"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expenses List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : filteredExpenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No Expenses Found"
          description="No expenses match your current filters. Try adjusting your filters."
        />
      ) : (
        <div className="card">
          <div className="space-y-2">
            {filteredExpenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                cards={paymentCards}
                expense={expense as ExpenseWithCategory}
                onClick={!isMultiSelectMode ? () => setEditingExpense(expense as ExpenseWithCategory) : undefined}
                isSelected={selectedExpenses.has(expense.id)}
                onToggleSelect={() => toggleExpenseSelection(expense.id)}
                showCheckbox={isMultiSelectMode}
              />
            ))}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <ExpenseDetailModal
        expense={editingExpense}
        cards={paymentCards}
        isOpen={!!editingExpense}
        onClose={() => setEditingExpense(null)}
        onSuccess={() => {
          setEditingExpense(null);
          refetch();
        }}
      />

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <ConfirmDialog
        isOpen={confirmBulkDeleteOpen}
        onClose={() => setConfirmBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedExpenses.size} expense${selectedExpenses.size !== 1 ? 's' : ''}?`}
        message="This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </PageContainer>
  );
}

export default function ExpensesBrowsePage() {
  return (
    <Suspense>
      <ExpensesBrowseContent />
    </Suspense>
  );
}
