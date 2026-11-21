'use client';

import { useState, useEffect, useRef, Fragment, useCallback } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { useAuth } from '@/lib/AuthContext';
import { getCategoryIcon } from '@/lib/categoryUtils';
import { matchCategoryByKeyword } from '@/lib/expenses/categoryMatcher';
import { formatCurrency } from '@/lib/utils';
import type { Tag } from '@/types';
import { Event } from '@/types';
import { format, isValid, parseISO } from 'date-fns';
import TagSelector from './TagSelector';
import { useCategories } from '@/lib/hooks/useCategories';
import { useEvents } from '@/lib/hooks/useEvents';
import { useExpenses } from '@/lib/hooks/useExpenses';

interface QuickAddExpenseProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// Helper function to safely format dates
const formatDateSafe = (dateString: string, formatString: string, fallback: string = 'Today'): string => {
  if (!dateString) return fallback;
  try {
    const date = parseISO(dateString);
    return isValid(date) ? format(date, formatString) : fallback;
  } catch {
    return fallback;
  }
};

export default function QuickAddExpense({ isOpen, onClose, onSuccess }: QuickAddExpenseProps) {
  const { currentUser } = useAuth();
  const { categories, loading: categoriesLoading } = useCategories();
  const { events } = useEvents();
  const { createExpense } = useExpenses();
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedEvent, setSelectedEvent] = useState('');
  const [description, setDescription] = useState('');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showSuccess, setShowSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [suggestedCategory, setSuggestedCategory] = useState<string | null>(null);
  const [suggestionSource, setSuggestionSource] = useState<'keyword' | 'ai' | null>(null);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryGroup, setNewCategoryGroup] = useState('');
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [scanEnabled, setScanEnabled] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  // Push the panel above the keyboard using the visualViewport API.
  // Works on both iOS (viewport doesn't resize) and Android (viewport shrinks).
  useEffect(() => {
    if (!isOpen) {
      setKeyboardOffset(0);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // Gap between the bottom of the visual viewport and the layout viewport
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardOffset(offset);
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [isOpen]);

  // When an input is focused, scroll it into view within the form container.
  const handleInputFocus = useCallback((e: React.FocusEvent) => {
    const target = e.target as HTMLElement;
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => amountInputRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Pre-fetch on mount so data is ready before the modal opens (prevents height jump)
  useEffect(() => {
    loadFavorites();
  }, []);

  // Reset form state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setShowCategoryDropdown(false);
    }
  }, [isOpen]);

  const loadFavorites = () => {
    const saved = localStorage.getItem('favoriteCategories');
    if (saved) {
      setFavorites(JSON.parse(saved));
    }
  };

  const toggleFavorite = (categoryId: string) => {
    const newFavorites = favorites.includes(categoryId)
      ? favorites.filter(id => id !== categoryId)
      : [...favorites, categoryId].slice(0, 6); // Max 6 favorites

    setFavorites(newFavorites);
    localStorage.setItem('favoriteCategories', JSON.stringify(newFavorites));
  };

  // Instant, offline keyword suggestion. Shared with the server-side AI fallback so both
  // paths agree — see lib/expenses/categoryMatcher.ts.
  const suggestCategoryFromDescription = (desc: string) => {
    const match = matchCategoryByKeyword(desc, categories);
    setSuggestedCategory(match?.categoryId ?? null);
    setSuggestionSource(match ? 'keyword' : null);
    return match;
  };

  // Handle description change with smart suggestion
  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    if (!selectedCategory) {
      suggestCategoryFromDescription(value);
    }
  };

  // Ask the server for a better suggestion, debounced. This only ever *upgrades* the
  // instant keyword guess above — if the request fails, is slow, or no key is configured,
  // the keyword suggestion simply stands and the user sees no error.
  useEffect(() => {
    if (selectedCategory || description.trim().length < 3 || categories.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/expenses/categorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        // Only apply if the user has not since picked a category or kept typing.
        if (controller.signal.aborted || !data?.categoryId) return;
        if (data.source === 'ai') {
          setSuggestedCategory(data.categoryId);
          setSuggestionSource('ai');
        }
      } catch {
        // Aborted or offline — keep the keyword suggestion. Intentionally silent.
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [description, selectedCategory, categories.length]);

  // Ask once whether receipt scanning is available. If it is not (or the check fails),
  // the button never renders — better than showing an action that always errors.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/expenses/scan-receipt')
      .then((r) => (r.ok ? r.json() : { aiEnabled: false }))
      .then((d) => { if (!cancelled) setScanEnabled(!!d?.aiEnabled); })
      .catch(() => { if (!cancelled) setScanEnabled(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  /**
   * Prefill the form from a receipt photo. This only ever fills fields the user can then
   * edit — it never submits. Any failure leaves the form exactly as it was.
   */
  const handleReceiptSelected = async (file: File) => {
    setScanning(true);
    setScanError(null);
    try {
      const body = new FormData();
      body.append('image', file);
      const res = await fetch('/api/expenses/scan-receipt', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScanError(data?.error ?? 'Could not read that receipt');
        return;
      }
      const d = data.draft ?? {};
      if (typeof d.amount === 'number' && d.amount > 0) setAmount(String(d.amount));
      if (d.description) handleDescriptionChange(d.description);
      if (d.date) setSelectedDate(d.date);
      if (d.categoryId) {
        setSelectedCategory(d.categoryId);
        setSuggestionSource(null);
      }
    } catch {
      setScanError('Could not read that receipt');
    } finally {
      setScanning(false);
    }
  };

  const selectCategory = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setSearchQuery(''); // Clear search when category is selected
    setShowCategoryDropdown(false); // Close dropdown
  };

  // Filter categories based on search
  const filteredCategories = categories.filter(cat =>
    cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cat.group_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get favorite categories (show all if searching, otherwise show non-filtered)
  const favoriteCategories = searchQuery
    ? [] // Don't show favorites section when searching
    : categories.filter(cat => favorites.includes(cat.id));

  // Get categories to display (all filtered when searching, non-favorites when not)
  const otherCategories = searchQuery
    ? filteredCategories // Show all results when searching
    : filteredCategories.filter(cat => !favorites.includes(cat.id)); // Hide favorites when not searching

  const handleCreateCategory = async () => {
    if (!newCategoryName || !newCategoryGroup) {
      alert('Please provide both category name and group');
      return;
    }

    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCategoryName,
          group_name: newCategoryGroup,
          color: '#3b82f6', // Default blue color
        }),
      });

      if (response.ok) {
        const newCategory = await response.json();
        // Categories will auto-refresh via hook
        setSelectedCategory(newCategory.id);
        setShowNewCategoryForm(false);
        setNewCategoryName('');
        setNewCategoryGroup('');
      } else {
        alert('Failed to create category');
      }
    } catch (err) {
      console.error('Failed to create category:', err);
      alert('Failed to create category');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategory || !amount || !currentUser) return;

    setLoading(true);
    try {
      await createExpense({
        date: selectedDate,
        amount: parseFloat(amount),
        category_id: selectedCategory,
        description: description || '',
        user_id: currentUser.id,
        event_id: selectedEvent || null,
        tag_ids: selectedTags.map(tag => tag.id),
      });

      // Update recent categories
      const recent = JSON.parse(localStorage.getItem('recentCategories') || '[]');
      const updated = [selectedCategory, ...recent.filter((id: string) => id !== selectedCategory)].slice(0, 6);
      localStorage.setItem('recentCategories', JSON.stringify(updated));

      // Notify any listening page to refresh its expense list
      window.dispatchEvent(new CustomEvent('expenseAdded'));

      // Show success animation
      setShowSuccess(true);

      setTimeout(() => {
        // Reset form
        setAmount('');
        setSelectedCategory('');
        setSelectedEvent('');
        setDescription('');
        setSelectedDate(format(new Date(), 'yyyy-MM-dd'));
        setSelectedTags([]);
        setSearchQuery('');
        setSuggestedCategory(null);
        setSuggestionSource(null);
        setShowCategoryDropdown(false);
        setShowSuccess(false);

        onSuccess?.();
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Failed to add expense:', err);
      alert('Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-50" />
        </Transition.Child>

        <div className="fixed inset-0 flex flex-col items-center justify-end sm:justify-center sm:p-4">
          <div
            className="w-full sm:max-w-md"
            style={{ marginBottom: keyboardOffset, transition: keyboardOffset > 0 ? 'margin-bottom 0.15s ease-out' : 'none' }}
          >
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-full sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-full sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="w-full max-w-full transform rounded-t-3xl sm:rounded-2xl bg-white shadow-xl transition-all overflow-hidden flex flex-col"
                style={{ maxHeight: `calc(100dvh - ${keyboardOffset}px - env(safe-area-inset-top, 0px))` }}
              >
                {showSuccess ? (
                  <div className="flex flex-col items-center justify-center py-20 px-6">
                    <div className="text-6xl mb-4 animate-bounce">✅</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Expense Added!</h3>
                    <p className="text-sm text-gray-600">{formatCurrency(parseFloat(amount))}</p>
                  </div>
                ) : (
                  <>
                    {/* Header - Simplified */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700">
                      <Dialog.Title className="text-lg font-bold text-white">
                        Quick Add Expense
                      </Dialog.Title>
                      <button
                        onClick={onClose}
                        className="text-white hover:text-blue-100 text-3xl leading-none w-8 h-8 flex items-center justify-center"
                      >
                        ×
                      </button>
                    </div>

                    <form id="quick-add-form" onSubmit={handleSubmit} className="p-4 overflow-y-auto overflow-x-hidden flex-1 overscroll-contain w-full max-w-full" ref={formRef} onFocus={handleInputFocus} style={{ WebkitOverflowScrolling: 'touch' }}>
                      {/* Receipt scan — additive shortcut. Rendered only when AI is configured,
                          so it is never shown as a button that always fails. */}
                      {scanEnabled && (
                        <div className="mb-3">
                          <input
                            ref={receiptInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleReceiptSelected(f);
                              e.target.value = '';
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => receiptInputRef.current?.click()}
                            disabled={scanning}
                            className="btn btn-secondary btn-sm w-full justify-center disabled:opacity-60"
                          >
                            {scanning ? 'Reading receipt…' : '📷 Scan a receipt'}
                          </button>
                          {scanError && (
                            <p className="mt-1 text-xs text-amber-700">
                              {scanError} — enter the details manually below.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Amount Input - Ultra prominent */}
                      <div className="mb-4 bg-gray-50 rounded-xl p-4">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-4xl text-blue-600 font-bold">
                            ₹
                          </span>
                          <input
                            type="number"
                            id="quick-add-amount"
                            name="amount"
                            inputMode="decimal"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="w-full pl-14 pr-4 py-3 text-4xl font-bold text-gray-900 bg-transparent border-0 outline-none"
                            placeholder="0"
                            required
                            ref={amountInputRef}
                          />
                        </div>
                      </div>

                      {/* Description/Note - First for smart suggestion */}
                      <div className="mb-3">
                        <label className="label">
                          What did you buy? 💭
                        </label>
                        <input
                          type="text"
                          id="quick-add-description"
                          name="description"
                          value={description}
                          onChange={(e) => handleDescriptionChange(e.target.value)}
                          className="input py-3 touch-manipulation"
                          placeholder="e.g., Pizza for lunch, Petrol refill..."
                        />
                      </div>

                      {/* Smart Category Autocomplete */}
                      <div className="mb-3 relative">
                        {/* Smart Suggestion (if available and no selection) */}
                        {suggestedCategory && !selectedCategory && (
                          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-2 mb-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">
                                  {getCategoryIcon(categories.find(c => c.id === suggestedCategory)!)}
                                </span>
                                <div>
                                  <p className="text-xs text-blue-700 font-medium">
                                    {suggestionSource === 'ai' ? '✨ AI suggested:' : '💡 Suggested:'}
                                  </p>
                                  <p className="text-sm font-bold text-gray-900">
                                    {categories.find(c => c.id === suggestedCategory)?.name}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCategory(suggestedCategory);
                                  setSearchQuery('');
                                  setShowCategoryDropdown(false);
                                }}
                                className="btn btn-primary btn-sm whitespace-nowrap"
                              >
                                Use This
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Autocomplete Input */}
                        <div className="relative">
                          {selectedCategory ? (
                            // Show selected category with clear button
                            <div className="flex items-center gap-2 p-3 bg-green-50 border-2 border-green-300 rounded-lg">
                              <span className="text-xl">
                                {getCategoryIcon(categories.find(c => c.id === selectedCategory)!)}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-green-700 font-medium">Selected:</p>
                                <p className="text-sm font-bold text-gray-900 truncate">
                                  {categories.find(c => c.id === selectedCategory)?.name}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCategory('');
                                  setSearchQuery('');
                                  setShowCategoryDropdown(true);
                                }}
                                className="btn btn-link text-sm px-2"
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            // Autocomplete input when no selection
                            <>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                  🔍
                                </span>
                                <input
                                  type="text"
                                  id="quick-add-category-search"
                                  name="categorySearch"
                                  value={searchQuery}
                                  onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setShowCategoryDropdown(true);
                                  }}
                                  onFocus={() => setShowCategoryDropdown(true)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      // Select first result if available
                                      if (filteredCategories.length > 0) {
                                        selectCategory(filteredCategories[0].id);
                                        setShowCategoryDropdown(false);
                                      }
                                    } else if (e.key === 'Escape') {
                                      setShowCategoryDropdown(false);
                                    }
                                  }}
                                  className="input py-3 pl-9"
                                  placeholder="Search categories..."
                                  autoComplete="off"
                                />
                              </div>

                              {/* Dropdown Results */}
                              {showCategoryDropdown && (
                                <>
                                  {/* Backdrop to close dropdown */}
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setShowCategoryDropdown(false)}
                                  />

                                  {/* Dropdown Menu */}
                                  <div
                                    className="absolute left-0 right-0 top-full mt-1 bg-white border-2 border-gray-200 rounded-lg shadow-xl overflow-y-auto z-20"
                                    style={{
                                      maxHeight: keyboardOffset > 0 ? '40vh' : '20rem'
                                    }}
                                  >
                                    {/* Favorites Section */}
                                    {favoriteCategories.length > 0 && !searchQuery && (
                                      <div className="p-2 border-b border-gray-100">
                                        <div className="text-xs font-medium text-gray-500 mb-2 px-2">
                                          ⭐ Favorites
                                        </div>
                                        <div className="space-y-1">
                                          {favoriteCategories.map(cat => (
                                            <button
                                              key={cat.id}
                                              type="button"
                                              onClick={() => {
                                                selectCategory(cat.id);
                                                setShowCategoryDropdown(false);
                                              }}
                                              className="w-full flex items-center gap-3 p-2 hover:bg-blue-50 rounded-lg transition-colors text-left"
                                            >
                                              <span className="text-2xl">{getCategoryIcon(cat)}</span>
                                              <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-900">{cat.name}</p>
                                                <p className="text-xs text-gray-500">{cat.group_name}</p>
                                              </div>
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Search Results / All Categories */}
                                    <div className="p-2">
                                      {searchQuery && (
                                        <div className="text-xs font-medium text-gray-500 mb-2 px-2">
                                          🔍 Results ({filteredCategories.length})
                                        </div>
                                      )}
                                      {categoriesLoading ? (
                                        <div className="py-6 space-y-2 px-2 animate-pulse">
                                          {[40, 56, 48, 64, 40].map((w, i) => (
                                            <div key={i} className="flex items-center gap-3">
                                              <div className="w-8 h-8 bg-gray-200 rounded-full flex-shrink-0" />
                                              <div className="flex-1 space-y-1">
                                                <div className={`h-3 bg-gray-200 rounded w-${w}`} />
                                                <div className="h-2.5 bg-gray-100 rounded w-24" />
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (searchQuery ? filteredCategories : otherCategories).length === 0 ? (
                                        <div className="text-center py-8 text-gray-400">
                                          <p className="text-sm mb-2">
                                            {searchQuery ? 'No categories found' : 'All categories are in favourites ⭐'}
                                          </p>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setShowNewCategoryForm(true);
                                              setShowCategoryDropdown(false);
                                            }}
                                            className="text-blue-600 text-xs font-medium hover:underline"
                                          >
                                            + Create New Category
                                          </button>
                                        </div>
                                      ) : (
                                        <div
                                          className="space-y-1 overflow-y-auto"
                                          style={{
                                            maxHeight: keyboardOffset > 0 ? '25vh' : '16rem'
                                          }}
                                        >
                                          {(searchQuery ? filteredCategories : otherCategories).map(cat => (
                                            <button
                                              key={cat.id}
                                              type="button"
                                              onClick={() => {
                                                selectCategory(cat.id);
                                                setShowCategoryDropdown(false);
                                              }}
                                              className="w-full flex items-center gap-3 p-2 hover:bg-blue-50 rounded-lg transition-colors text-left"
                                            >
                                              <span className="text-2xl">{getCategoryIcon(cat)}</span>
                                              <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-900">{cat.name}</p>
                                                <p className="text-xs text-gray-500">{cat.group_name}</p>
                                              </div>
                                              {!favorites.includes(cat.id) && favorites.length < 6 && (
                                                <span
                                                  role="button"
                                                  tabIndex={0}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleFavorite(cat.id);
                                                  }}
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                      e.stopPropagation();
                                                      toggleFavorite(cat.id);
                                                    }
                                                  }}
                                                  className="text-gray-400 hover:text-yellow-500 text-sm px-1 cursor-pointer"
                                                  title="Add to favorites"
                                                >
                                                  ⭐
                                                </span>
                                              )}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    {/* Create New Category */}
                                    {!categoriesLoading && filteredCategories.length > 0 && (
                                      <div className="p-2 border-t border-gray-100">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setShowNewCategoryForm(true);
                                            setShowCategoryDropdown(false);
                                          }}
                                          className="w-full py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg font-medium transition-colors"
                                        >
                                          + Create New Category
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* New Category Form Modal */}
                      {showNewCategoryForm && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                          <div className="bg-white rounded-xl p-6 max-w-sm w-full">
                            <h3 className="text-lg font-bold text-gray-900 mb-4">Create New Category</h3>
                            <div className="space-y-3">
                              <div>
                                <label className="label">
                                  Category Name *
                                </label>
                                <input
                                  type="text"
                                  id="quick-add-new-category-name"
                                  name="newCategoryName"
                                  value={newCategoryName}
                                  onChange={(e) => setNewCategoryName(e.target.value)}
                                  className="input"
                                  placeholder="e.g., Coffee, Gym"
                                />
                              </div>
                              <div>
                                <label className="label">
                                  Group *
                                </label>
                                <input
                                  type="text"
                                  id="quick-add-new-category-group"
                                  name="newCategoryGroup"
                                  value={newCategoryGroup}
                                  onChange={(e) => setNewCategoryGroup(e.target.value)}
                                  className="input"
                                  placeholder="e.g., Food, Health"
                                />
                              </div>
                              <div className="flex gap-2 pt-2">
                                <button
                                  type="button"
                                  onClick={handleCreateCategory}
                                  className="btn btn-primary flex-1"
                                >
                                  Create
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNewCategoryForm(false);
                                    setNewCategoryName('');
                                    setNewCategoryGroup('');
                                  }}
                                  className="btn btn-secondary flex-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Labels Selection - Moved up, always visible */}
                      <div className="mb-3">
                        <label className="label mb-1.5">🔖 Labels</label>
                        <TagSelector
                          selectedTags={selectedTags}
                          onTagsChange={setSelectedTags}
                          userId={currentUser?.id}
                        />
                      </div>

                      {/* Optional Fields - Ultra Compact */}
                      <div className="mb-3 space-y-2">
                        {/* Date Picker */}
                        <details className="group bg-gray-50 rounded-lg overflow-hidden">
                          <summary className="flex items-center justify-between cursor-pointer select-none py-2.5 px-3 hover:bg-gray-100 transition-colors list-none active:bg-gray-200">
                            <span className="text-xs font-medium text-gray-600">
                              📅 {selectedDate !== format(new Date(), 'yyyy-MM-dd')
                                ? formatDateSafe(selectedDate, 'MMM dd, yyyy')
                                : 'Today'
                              }
                            </span>
                            <span className="text-gray-400 text-xs group-open:rotate-180 transition-transform">▼</span>
                          </summary>
                          <div className="p-2 bg-white">
                            <input
                              type="date"
                              id="quick-add-date"
                              name="date"
                              value={selectedDate}
                              onChange={(e) => setSelectedDate(e.target.value)}
                              className="input-sm"
                            />
                          </div>
                        </details>

                        {/* Event Selection */}
                        {events.length > 0 && (
                          <details className="group bg-gray-50 rounded-lg overflow-hidden">
                            <summary className="flex items-center justify-between cursor-pointer select-none py-2.5 px-3 hover:bg-gray-100 transition-colors list-none active:bg-gray-200">
                              <span className="text-xs font-medium text-gray-600">
                                🏷️ {selectedEvent
                                  ? events.find(e => e.id === selectedEvent)?.name
                                  : 'Event'
                                }
                              </span>
                              <span className="text-gray-400 text-xs group-open:rotate-180 transition-transform">▼</span>
                            </summary>
                            <div className="p-2 bg-white">
                              <select
                                id="quick-add-event"
                                name="event"
                                value={selectedEvent}
                                onChange={(e) => setSelectedEvent(e.target.value)}
                                className="select"
                              >
                                <option value="">No event</option>
                                {events.map(event => (
                                  <option key={event.id} value={event.id}>
                                    ● {event.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </details>
                        )}
                      </div>

                      {/* Bottom padding to ensure last field is scrollable */}
                      <div className="h-4" />
                    </form>
                    {/* Submit button pinned outside the scroll area — always visible above keyboard */}
                    <div className="px-4 pb-4 pt-3 bg-white border-t border-gray-200 shadow-lg">
                      <button
                        type="submit"
                        form="quick-add-form"
                        disabled={loading || selectedCategory === '' || amount === '' || parseFloat(amount) <= 0}
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 rounded-xl font-bold text-base hover:from-blue-700 hover:to-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl active:scale-[0.98] touch-manipulation"
                      >
                        {loading ? '⏳ Adding...' : '✓ Add Expense'}
                      </button>
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
