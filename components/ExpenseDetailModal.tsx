'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExpenseWithCategory, Category, Event, Tag } from '@/types';
import { getCategoryIcon } from '@/lib/categoryUtils';
import { formatCurrency, formatDate } from '@/lib/utils';
import { UserIcon } from '@/components/UserIcon';
import { formatters } from '@/lib/utils/dateUtils';
import { displayTags, isAutoExpense } from '@/lib/expenses/autoTag';
import { describePaymentSource, parsePaymentSource, type CardIndex } from '@/lib/expenses/paymentSource';
import { startOfMonth, endOfMonth, parseISO, format } from 'date-fns';
import TagSelector from './TagSelector';
import Modal from './Modal';
import Toast from './Toast';
import { Trash2, Search } from 'lucide-react';

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

/** Where this payee usually belongs (GET /api/expenses/suggest-category). */
interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  /** Confirmed expenses from this payee that agreed; 0 when the guess came from keywords. */
  count: number;
  source: 'history' | 'keyword';
}

/** An expense a review expense may repeat (GET /api/expenses/review). */
interface ReviewCandidate {
  id: string;
  date: string;
  amount: number;
  description: string;
  payment_method: string | null;
  needs_review: boolean;
}

const showError = (message: string, setToast: (toast: ToastState) => void) => {
  setToast({ message, type: 'error' });
};

// Helper: Parse error from API response
const parseErrorResponse = async (res: Response, defaultMessage: string): Promise<string> => {
  try {
    const errorData = await res.json();
    return errorData.error || defaultMessage;
  } catch {
    return defaultMessage;
  }
};

/** One labelled line in the facts block: label left, value right, wrapping on a phone. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-gray-500 flex-shrink-0 pt-0.5">{label}</span>
      <div className="text-sm text-gray-900 text-right min-w-0">{children}</div>
    </div>
  );
}

interface ExpenseDetailModalProps {
  expense: ExpenseWithCategory | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onCategoryFilterClick?: (categoryName: string) => void;
  onLabelFilterClick?: (labelName: string) => void;
  /** last4 → the card's name and colour (usePaymentSources). */
  cards?: CardIndex;
}

export default function ExpenseDetailModal({
  expense,
  isOpen,
  onClose,
  onSuccess,
  onCategoryFilterClick,
  onLabelFilterClick,
  cards,
}: ExpenseDetailModalProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  // null: still looking; []: looked and found none.
  const [duplicates, setDuplicates] = useState<ReviewCandidate[] | null>(null);
  const [suggestion, setSuggestion] = useState<CategorySuggestion | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [formData, setFormData] = useState({
    amount: '',
    category_id: '',
    event_id: '',
    description: '',
    date: '',
  });

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');

      if (!res.ok) {
        setToast({ message: 'Could not load categories', type: 'error' });
        return;
      }

      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      setToast({ message: 'Error loading categories: ' + String(err), type: 'error' });
    }
  };

  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/events');

      if (!res.ok) {
        // Events are optional, just log it
        return;
      }

      const data = await res.json();
      const activeEvents = Array.isArray(data) ? data.filter((e: Event) => e.is_active) : [];
      setEvents(activeEvents);
    } catch {
      // Events are optional, silently fail
    }
  };

  useEffect(() => {
    if (isOpen && expense) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load the form from the expense each time the modal opens
      setFormData({
        amount: expense.amount.toString(),
        category_id: expense.category_id,
        event_id: expense.event_id || '',
        description: expense.description || '',
        date: expense.date,
      });
      setSelectedTags(expense.tags || []);
      setIsEditing(false);
      setShowDeleteConfirm(false);
      setCategorySearch('');
      setShowCategoryDropdown(false);
      setShowAllCategories(false);
      fetchCategories();
      fetchEvents();
    }
  }, [isOpen, expense]);

  /*
   * An auto-added spend is filed by payee, and anything unrecognised lands in Miscellaneous.
   * Offering the answer here is what makes a review one tap instead of six: open, Edit,
   * Change, search, pick, Save. Only ever a suggestion — it is applied when tapped, never
   * silently.
   */
  useEffect(() => {
    if (!isOpen || !expense?.needs_review || !expense.merchant) return;
    let cancelled = false;
    fetch(`/api/expenses/suggest-category?merchant=${encodeURIComponent(expense.merchant)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setSuggestion(body.suggestion ?? null);
      })
      // A suggestion is a convenience; without it the modal is exactly as it was.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      // Cleared on the way out, so the next expense never shows this one's suggestion.
      setSuggestion(null);
    };
  }, [isOpen, expense?.id, expense?.needs_review, expense?.merchant]);

  /*
   * Look for the expense this one repeats as the modal opens, not when a button is pressed.
   * Merging used to cost three taps and a wait — "Duplicate of…", read the list, "Merge" —
   * and the first two told the user nothing they wanted to know. Loading it up front makes
   * the common case one tap, and the uncommon case (no candidate) shows nothing at all
   * rather than a button that leads to an empty panel.
   */
  useEffect(() => {
    if (!isOpen || !expense?.needs_review) return;
    let cancelled = false;
    fetch(`/api/expenses/review?id=${expense.id}`)
      .then((res) => (res.ok ? res.json() : { candidates: [] }))
      .then((body) => {
        if (!cancelled) setDuplicates(body.candidates ?? []);
      })
      // Best-effort: a failed lookup hides the merge offer, it does not break the modal.
      .catch(() => {
        if (!cancelled) setDuplicates([]);
      });
    return () => {
      cancelled = true;
      setDuplicates(null);
    };
  }, [isOpen, expense?.id, expense?.needs_review]);

  /**
   * Move the expense to a category, which also confirms it — any edit does (the PUT clears
   * `needs_review`), so this one tap is the whole review and the modal closes. From the
   * suggestion chip, or from any chip in the category row. Editing is still there for
   * everything else about the row.
   */
  const applyCategory = useCallback(
    async (categoryId: string, categoryName: string) => {
      if (!expense) return;
      setLoading(true);
      try {
        const res = await fetch('/api/expenses', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: expense.id,
            date: expense.date,
            amount: expense.amount,
            category_id: categoryId,
            description: expense.description,
            user_id: expense.user_id,
            event_id: expense.event_id,
          }),
        });
        if (!res.ok) {
          showError(await parseErrorResponse(res, 'Failed to change the category'), setToast);
          return;
        }
        setToast({ message: `Filed under ${categoryName}`, type: 'success' });
        onSuccess?.();
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Network error', setToast);
      } finally {
        setLoading(false);
      }
    },
    [expense, onSuccess]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expense) return;
    const parsedAmount = Number.parseFloat(formData.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showError('Please enter a valid amount greater than zero', setToast);
      return;
    }
    if (!formData.category_id) {
      showError('Please select a category', setToast);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        id: expense.id,
        date: formData.date,
        amount: parsedAmount,
        category_id: formData.category_id,
        description: formData.description,
        user_id: expense.user_id,
        event_id: formData.event_id || null,
        tag_ids: selectedTags.map((t) => t.id),
      };

      const res = await fetch('/api/expenses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorMessage = await parseErrorResponse(res, 'Failed to update expense');
        showError(errorMessage, setToast);
        return;
      }

      setToast({ message: 'Expense updated!', type: 'success' });
      onSuccess?.();
      setIsEditing(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error';
      showError(errorMessage, setToast);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!expense) return;

    setLoading(true);

    try {
      const res = await fetch(`/api/expenses?id=${expense.id}`, { method: 'DELETE' });

      if (!res.ok) {
        const errorMessage = await parseErrorResponse(res, 'Failed to delete expense');
        showError(errorMessage, setToast);
        return;
      }

      setToast({ message: 'Expense deleted!', type: 'success' });
      onSuccess?.();
      setTimeout(onClose, 500);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error';
      showError(errorMessage, setToast);
    } finally {
      setLoading(false);
    }
  };

  // Merge into an expense it repeats, or remove it as not an expense; either way its alert is settled.
  const resolveReview = async (payload: { action: 'merge'; into: string } | { action: 'dismiss' }, done: string) => {
    if (!expense) return;
    setLoading(true);
    try {
      const res = await fetch('/api/expenses/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: expense.id, ...payload }),
      });
      if (!res.ok) {
        showError(await parseErrorResponse(res, 'Failed to update the expense'), setToast);
        return;
      }
      setToast({ message: done, type: 'success' });
      onSuccess?.();
      setTimeout(onClose, 500);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Network error', setToast);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (isEditing) {
      // Go back to view instead of closing entirely
      setIsEditing(false);
      return;
    }
    onClose();
  };

  const currentCategoryId = expense?.category_id;

  /**
   * The chips offered for a one-tap refile: the suggested category first (it is the
   * household's own past answer about this payee), then every other category. All of them,
   * not a guessed shortlist — there are around two dozen, the row scrolls, and a chip that
   * is not there sends the user back into the six-tap Edit path the chips exist to avoid.
   */
  const categoryChips = useMemo(() => {
    const others = categories.filter((cat) => cat.id !== currentCategoryId && cat.id !== suggestion?.categoryId);
    const suggested = suggestion ? categories.find((cat) => cat.id === suggestion.categoryId) : undefined;
    return suggested ? [suggested, ...others] : others;
  }, [categories, currentCategoryId, suggestion]);

  if (!expense) return null;

  const paymentSource = parsePaymentSource(expense.payment_method, cards);
  const visibleTags = displayTags(expense.tags);
  const isAuto = isAutoExpense(expense);
  const shownCategory = { name: expense.category?.name, color: expense.category?.color };
  // The payee and what was bought are different facts; an auto row starts with them equal.
  const descriptionIsMerchant =
    Boolean(expense.merchant) && expense.description?.trim().toLowerCase() === expense.merchant?.trim().toLowerCase();

  const browseTo = (extra: Record<string, string>) => {
    const expDate = parseISO(expense.date);
    const params = new URLSearchParams({
      startDate: format(startOfMonth(expDate), 'yyyy-MM-dd'),
      endDate: format(endOfMonth(expDate), 'yyyy-MM-dd'),
      ...extra,
    });
    onClose();
    router.push(`/expenses/browse?${params.toString()}`);
  };

  const modalTitle = isEditing ? 'Edit Expense' : 'Expense Details';
  const filteredCategories = categories.filter((cat) => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return true;
    return (
      cat.name.toLowerCase().includes(q) ||
      cat.group_name.toLowerCase().includes(q)
    );
  });
  const selectedCategory = categories.find((cat) => cat.id === formData.category_id);

  // The keys matter. Without them React reused each footer slot's DOM node when the footer
  // swapped from view to edit mode, so the node tapped as "Edit" had already been turned into
  // the edit form's submit button by the time the browser ran that same click's default
  // action — which then submitted the form. One tap on Edit saved the expense and closed the
  // modal, and the category could never be changed. Distinct keys make React drop the tapped
  // node instead of morphing it, and every non-submitting button says type="button" as well.
  const modalFooter = showDeleteConfirm ? undefined : isEditing ? (
    <>
      <button key="cancel" type="button" onClick={() => setIsEditing(false)} className="btn btn-secondary">
        Cancel
      </button>
      <button
        key="save"
        type="submit"
        form="expense-edit-form"
        className="btn btn-primary"
        disabled={loading}
      >
        {loading ? 'Saving...' : 'Save Changes'}
      </button>
    </>
  ) : (
    <>
      <button key="delete" type="button" onClick={() => setShowDeleteConfirm(true)} className="btn btn-danger">
        Delete
      </button>
      <button
        key="edit"
        type="button"
        onClick={() => setIsEditing(true)}
        className="btn btn-secondary"
      >
        Edit
      </button>
    </>
  );

  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={modalTitle}
        footer={modalFooter}
      >
      {isEditing ? (
        <form id="expense-edit-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Amount</label>
            <input
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              className="input text-lg font-bold"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label">Category</label>
            <div className="relative">
              {selectedCategory ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <span className="text-lg">{getCategoryIcon(selectedCategory)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{selectedCategory.name}</p>
                    <p className="text-xs text-gray-500 truncate">{selectedCategory.group_name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, category_id: '' });
                      setCategorySearch('');
                      setShowCategoryDropdown(true);
                    }}
                    className="btn btn-link text-sm"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
                    <input
                      type="text"
                      value={categorySearch}
                      onChange={(e) => {
                        setCategorySearch(e.target.value);
                        setShowCategoryDropdown(true);
                      }}
                      onFocus={() => setShowCategoryDropdown(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (filteredCategories.length > 0) {
                            setFormData({ ...formData, category_id: filteredCategories[0].id });
                            setCategorySearch('');
                            setShowCategoryDropdown(false);
                          }
                        } else if (e.key === 'Escape') {
                          setShowCategoryDropdown(false);
                        }
                      }}
                      className="input pl-9"
                      placeholder="Search categories..."
                    />
                  </div>
                  {showCategoryDropdown && (
                    <div className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                      {filteredCategories.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-gray-500 text-center">No categories found</div>
                      ) : (
                        filteredCategories.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, category_id: cat.id });
                              setCategorySearch('');
                              setShowCategoryDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-primary-50 transition-colors flex items-center gap-2"
                          >
                            <span className="text-lg">{getCategoryIcon(cat)}</span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{cat.name}</p>
                              <p className="text-xs text-gray-500 truncate">{cat.group_name}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div>
            <label className="label">What was bought</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input"
              placeholder="Rice flour, haircut, auto fare…"
            />
            {expense.merchant && (
              <p className="mt-1 text-xs text-gray-500">Paid to {expense.merchant}, from the bank alert.</p>
            )}
          </div>

          <div>
            <label className="label">Date</label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="input"
              required
            />
          </div>

          <div>
            <label className="label">Event</label>
            <select
              value={formData.event_id}
              onChange={(e) => setFormData({ ...formData, event_id: e.target.value })}
              className="select"
            >
              <option value="">No event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full max-w-full overflow-hidden">
            <label className="label">Labels</label>
            <TagSelector
              selectedTags={selectedTags}
              onTagsChange={setSelectedTags}
              userId={expense.user_id}
              dropdownMode="inline"
            />
          </div>
        </form>
      ) : showDeleteConfirm ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                <Trash2 size={20} aria-hidden />
              </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">Delete this expense?</h3>
          <p className="text-sm text-gray-500 mb-6">This action cannot be undone.</p>
          <div className="flex gap-3 w-full">
            <button type="button" onClick={() => setShowDeleteConfirm(false)} className="btn btn-secondary flex-1">
              Cancel
            </button>
            <button type="button" onClick={handleDelete} className="btn btn-danger flex-1" disabled={loading}>
              {loading ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Amount hero */}
          <div className="text-center py-4 bg-primary-50 rounded-xl">
            <p className="text-4xl font-bold text-primary-900">
              {formatCurrency(parseFloat(expense.amount.toString()))}
            </p>
          </div>

          {/* Who it went to, and what for — the two facts the list has room for only in brief. */}
          <div className="space-y-1">
            {expense.merchant ? (
              <>
                <p className="text-lg font-semibold text-gray-900 break-words">{expense.merchant}</p>
                {expense.description && !descriptionIsMerchant && (
                  <p className="text-sm text-gray-600 break-words">{expense.description}</p>
                )}
                {descriptionIsMerchant && (
                  <p className="text-sm text-gray-400 italic">
                    No note yet — Edit to say what was bought.
                  </p>
                )}
              </>
            ) : (
              <p className="text-lg font-semibold text-gray-900 break-words">
                {expense.description || 'No description'}
              </p>
            )}
          </div>

          <button
            type="button"
            className="flex items-center gap-2 group hover:opacity-80 transition-opacity text-left"
            title={onCategoryFilterClick ? 'Filter this category' : 'Browse this category'}
            onClick={() => {
              const name = shownCategory.name ?? '';
              if (!name) return;
              if (onCategoryFilterClick) {
                onClose();
                onCategoryFilterClick(name);
                return;
              }
              browseTo({ category: name });
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
              style={{ backgroundColor: (shownCategory.color ?? '#e5e7eb') + '20' }}
            >
              {getCategoryIcon(expense.category)}
            </div>
            <span className="text-sm text-gray-700 group-hover:text-primary-600 group-hover:underline transition-colors">
              {shownCategory.name}
            </span>
          </button>

          {/* ---- Everything below is the review queue; a settled expense shows none of it. ---- */}

          {expense.needs_review && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs text-amber-800">
                Added automatically from {paymentSource ? `a ${paymentSource.issuer} alert` : 'a bank alert'} and
                already counted. Nothing to do if it looks right — changing anything confirms it.
              </p>
            </div>
          )}

          {expense.needs_review && suggestion && suggestion.categoryId !== currentCategoryId && (
            <button
              type="button"
              onClick={() => applyCategory(suggestion.categoryId, suggestion.categoryName)}
              disabled={loading}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-left hover:bg-primary-100 disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-primary-900">File under {suggestion.categoryName}</span>
                <span className="block text-xs text-primary-700">
                  {suggestion.source === 'history'
                    ? `You filed ${expense.merchant} there ${suggestion.count === 1 ? 'once' : `${suggestion.count} times`} before.`
                    : 'Suggested from the payee.'}
                </span>
              </span>
              <span className="text-xs font-medium text-primary-700 whitespace-nowrap">Use it</span>
            </button>
          )}

          {/*
            One tap to refile. The row scrolls sideways rather than wrapping so it costs one
            line whatever the category count, and "All" swaps it for a wrapped grid when the
            category wanted is further along than a thumb wants to swipe.
          */}
          {expense.needs_review && categoryChips.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600">Move to</span>
                <button
                  type="button"
                  onClick={() => setShowAllCategories((open) => !open)}
                  className="text-xs font-medium text-primary-600 hover:underline"
                >
                  {showAllCategories ? 'Less' : 'All'}
                </button>
              </div>
              <div className={showAllCategories ? 'flex flex-wrap gap-1.5' : 'flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1'}>
                {(showAllCategories ? categoryChips : categoryChips.slice(0, 12)).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => applyCategory(cat.id, cat.name)}
                    disabled={loading}
                    className={`flex-shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                      cat.id === suggestion?.categoryId
                        ? 'border-primary-300 bg-primary-50 text-primary-800 hover:bg-primary-100'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span>{getCategoryIcon(cat)}</span>
                    <span className="whitespace-nowrap">{cat.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/*
            Loaded when the modal opened, so merging is one tap. Nothing renders while the
            lookup is in flight or when it found nothing — an empty panel is worse than none.
          */}
          {expense.needs_review && duplicates !== null && duplicates.length > 0 && (
            <div className="rounded-lg border border-gray-200">
              <p className="px-3 py-2 text-xs font-semibold text-gray-600">
                Already logged? Merge into it
              </p>
              {duplicates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => resolveReview({ action: 'merge', into: candidate.id }, 'Merged into the existing expense')}
                  disabled={loading}
                  className="flex w-full items-center justify-between gap-3 border-t border-gray-100 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-gray-900">{candidate.description}</span>
                    <span className="block text-xs text-gray-500">
                      {formatDate(candidate.date)}
                      {candidate.payment_method ? ` · ${candidate.payment_method}` : ''}
                      {candidate.needs_review ? ' · also to review' : ''}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-primary-600 whitespace-nowrap">Merge</span>
                </button>
              ))}
            </div>
          )}

          {expense.needs_review && (
            <button
              type="button"
              onClick={() => resolveReview({ action: 'dismiss' }, 'Removed — not an expense')}
              className="btn btn-secondary btn-sm"
              disabled={loading}
            >
              Not an expense
            </button>
          )}

          {/* ---- The facts. Room here for what the list only hints at. ---- */}

          <div className="rounded-lg bg-gray-50 px-3 py-1.5 divide-y divide-gray-200">
            <DetailRow label="Date">
              {formatDate(expense.date)}
              {expense.spent_time ? `, ${formatters.toClock(expense.spent_time, expense.spent_time_approx)}` : ''}
            </DetailRow>

            <DetailRow label="Paid by">
              <UserIcon user={expense.user} /> {expense.user?.full_name}
            </DetailRow>

            {paymentSource && (
              <DetailRow label="Paid with">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: paymentSource.color }}
                  />
                  <span>{describePaymentSource(paymentSource)}</span>
                </span>
                {/* What the bank actually wrote, kept when the card's own name replaced it. */}
                {paymentSource.cardName && (
                  <p className="text-xs text-gray-400">{paymentSource.label}</p>
                )}
              </DetailRow>
            )}

            {expense.event && (
              <DetailRow label="Event">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: expense.event.color }}
                  />
                  <span>{expense.event.name}</span>
                </span>
              </DetailRow>
            )}

            {isAuto && (
              <DetailRow label="Source">
                <span className="text-gray-500">
                  {expense.source === 'statement' ? 'Card statement' : 'Bank alert (inbox)'}
                </span>
              </DetailRow>
            )}

            {visibleTags.length > 0 && (
              <DetailRow label="Labels">
                <div className="flex flex-wrap justify-end gap-1.5">
                  {visibleTags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      title={onLabelFilterClick ? 'Filter this label' : 'Browse this label'}
                      onClick={() => {
                        const name = tag?.name ?? '';
                        if (!name) return;
                        if (onLabelFilterClick) {
                          onClose();
                          onLabelFilterClick(name);
                          return;
                        }
                        browseTo({ tag: name });
                      }}
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium hover:opacity-75 transition-opacity"
                      style={{
                        backgroundColor: tag.color + '15',
                        color: tag.color,
                        border: `1px solid ${tag.color}30`,
                      }}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </DetailRow>
            )}
          </div>
        </div>
      )}
      </Modal>
    </>
  );
}
