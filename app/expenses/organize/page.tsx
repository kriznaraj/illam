'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import Toast from '@/components/Toast';
import { getCategoryIcon } from '@/lib/categoryUtils';
import AutocompleteDropdown from '@/components/AutocompleteDropdown';
import type { AutocompleteOption } from '@/components/AutocompleteDropdown';
import ConfirmDialog from '@/components/ConfirmDialog';
import EmojiPicker from '@/components/EmojiPicker';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ListItemRow } from '@/components/ListItemRow';
import { ModalRecordActions } from '@/components/ModalRecordActions';
import { Trash2, Link2, FolderOpen, Wallet, Hash, Calendar, Check, X } from 'lucide-react';

interface Event {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  color: string;
  is_active: boolean;
  created_at: string;
}

interface Tag {
  id: string;
  name: string;
  color: string;
  is_shared: boolean;
  user_id: string | null;
  created_at: string;
}

interface ItemWithCount {
  id: string;
  name: string;
  color: string;
  is_active?: boolean;
  is_shared?: boolean;
  usage_count: number;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  budget?: number | null;
}

interface Expense {
  id: string;
  date: string;
  amount: number;
  description: string;
  category_id: string;
  event_id: string | null;
  category?: { id: string; name: string; color: string; icon: string; group_name: string };
  user?: { id: string; full_name: string };
  event?: Event;
  tags?: Tag[];
}

interface ItemReport {
  item: Event | Tag | { id: string; name: string; color: string };
  expenses: Expense[];
  recentExpenses?: Expense[];
  totalSpent: number;
  expenseCount: number;
  byCategory: { [key: string]: { name: string; amount: number; color: string; count: number } };
  byUser: { [key: string]: { name: string; amount: number; count: number } };
}

type TabType = 'events' | 'labels' | 'categories';
const CATEGORY_GROUP_ORDER = ['Need', 'Want', 'One-time', 'Unplanned'] as const;

export default function OrganizePage() {
  const [activeTab, setActiveTab] = useState<TabType>('events');
  const [events, setEvents] = useState<ItemWithCount[]>([]);
  const [tags, setTags] = useState<ItemWithCount[]>([]);
  const [categories, setCategories] = useState<ItemWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#3b82f6');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formIsShared, setFormIsShared] = useState(false);
  const [formDescription, setFormDescription] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formIcon, setFormIcon] = useState('');
  const [formGroupName, setFormGroupName] = useState('');
  const [formSortOrder, setFormSortOrder] = useState('0');
  const [formActivityTrackerEventId, setFormActivityTrackerEventId] = useState('');
  const [activityTrackerEvents, setActivityTrackerEvents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Report states
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [itemReport, setItemReport] = useState<ItemReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemWithCount | null>(null);
  const [detailReport, setDetailReport] = useState<ItemReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isEditingInModal, setIsEditingInModal] = useState(false);

  // Confirm Dialog State
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmDialogConfig, setConfirmDialogConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    variant?: 'danger' | 'warning' | 'info' | 'success';
  }>({
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const parseApiError = async (response: Response, fallback: string): Promise<string> => {
    try {
      const payload = await response.json();
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const error = (payload as { error?: unknown }).error;
        if (typeof error === 'string' && error.trim()) {
          return error;
        }
      }
      return fallback;
    } catch {
      return fallback;
    }
  };

  const fetchExpensesForUsage = useCallback(async (): Promise<Expense[]> => {
    const response = await fetch('/api/expenses?limit=10000', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      const message = await parseApiError(response, 'Failed to load expenses for usage counts');
      throw new Error(message);
    }

    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const [eventsRes, expensesRes] = await Promise.all([
        fetch('/api/events', { credentials: 'include', cache: 'no-store' }),
        fetchExpensesForUsage()
      ]);
      if (!eventsRes.ok) {
        const message = await parseApiError(eventsRes, 'Failed to load events');
        throw new Error(message);
      }

      const eventsData = await eventsRes.json();
      const expenses = expensesRes;

      // Count usage
      const usageMap = new Map<string, number>();
      expenses.forEach((expense: Expense) => {
        if (expense.event_id) {
          usageMap.set(expense.event_id, (usageMap.get(expense.event_id) || 0) + 1);
        }
      });

      const eventsWithCount = Array.isArray(eventsData)
        ? eventsData.map((event: Event) => ({
            ...event,
            usage_count: usageMap.get(event.id) || 0,
          }))
        : [];

      setEvents(eventsWithCount.sort((a, b) => b.usage_count - a.usage_count));
    } catch (error) {
      console.error('Error fetching events:', error);
      setToast({ message: error instanceof Error ? error.message : 'Failed to fetch events', type: 'error' });
    }
  }, [fetchExpensesForUsage]);

  const fetchTags = useCallback(async () => {
    try {
      const [tagsRes, expensesRes] = await Promise.all([
        fetch('/api/tags?all=true', { credentials: 'include', cache: 'no-store' }),
        fetchExpensesForUsage()
      ]);
      if (!tagsRes.ok) {
        const message = await parseApiError(tagsRes, 'Failed to load labels');
        throw new Error(message);
      }

      const tagsData = await tagsRes.json();
      const expenses = expensesRes;

      // Count usage
      const usageMap = new Map<string, number>();
      expenses.forEach((expense: Expense) => {
        if (expense.tags && Array.isArray(expense.tags)) {
          expense.tags.forEach((tag: Tag) => {
            usageMap.set(tag.id, (usageMap.get(tag.id) || 0) + 1);
          });
        }
      });

      const tagsWithCount = Array.isArray(tagsData)
        ? tagsData.map((tag: Tag) => ({
            ...tag,
            usage_count: usageMap.get(tag.id) || 0,
          }))
        : [];

      setTags(tagsWithCount.sort((a, b) => b.usage_count - a.usage_count));
    } catch (error) {
      console.error('Error fetching tags:', error);
      setToast({ message: error instanceof Error ? error.message : 'Failed to fetch labels', type: 'error' });
    }
  }, [fetchExpensesForUsage]);

  const fetchCategories = useCallback(async () => {
    try {
      const [categoriesRes, expensesRes] = await Promise.all([
        fetch('/api/categories', { credentials: 'include', cache: 'no-store' }),
        fetchExpensesForUsage()
      ]);
      if (!categoriesRes.ok) {
        const message = await parseApiError(categoriesRes, 'Failed to load categories');
        throw new Error(message);
      }

      const categoriesData = await categoriesRes.json();
      const expenses = expensesRes;

      // Count usage - check both category_id and nested category.id
      const usageMap = new Map<string, number>();
      expenses.forEach((expense: Expense) => {
        const categoryId = expense.category_id || expense.category?.id;
        if (categoryId) {
          usageMap.set(categoryId, (usageMap.get(categoryId) || 0) + 1);
        }
      });

      const categoriesWithCount = Array.isArray(categoriesData)
        ? categoriesData.map((category: { id: string; name: string; icon: string; group_name: string; color: string }) => ({
            ...category,
            usage_count: usageMap.get(category.id) || 0,
          }))
        : [];

      setCategories(categoriesWithCount.sort((a, b) => b.usage_count - a.usage_count));
    } catch (error) {
      console.error('Error fetching categories:', error);
      setToast({ message: error instanceof Error ? error.message : 'Failed to fetch categories', type: 'error' });
    }
  }, [fetchExpensesForUsage]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'events') {
        await fetchEvents();
      } else if (activeTab === 'labels') {
        await fetchTags();
      } else {
        await fetchCategories();
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, fetchEvents, fetchTags, fetchCategories]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch open one-time ActivityTracker events for expense linking
  useEffect(() => {
    const fetchActivityTrackerEvents = async () => {
      try {
        const res = await fetch(
          '/api/activity-tracker?type=one_time&status=open',
          { credentials: 'include' }
        );
        const data = res.ok ? await res.json() : [];
        setActivityTrackerEvents(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error fetching activity tracker events:', error);
      }
    };

    if (activeTab === 'events') {
      fetchActivityTrackerEvents();
    }
  }, [activeTab]);

  const activityTrackerEventOptions: AutocompleteOption[] = activityTrackerEvents.map(event => ({
    id: event.id,
    label: event.title,
    sublabel: event.event_date,
  }));

  // Lock body scroll when modal is open
  useEffect(() => {
    if (showDetailModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showDetailModal]);


  const handleCreate = () => {
    setEditingItem(null);
    setFormName('');
    setFormColor(activeTab === 'events' ? '#3b82f6' : '#6b7280');
    setFormIsActive(true);
    setFormIsShared(true); // Default to shared for all users
    setFormIcon('');
    setFormGroupName('');
    setFormBudget('');
    setFormSortOrder('0');
    setFormActivityTrackerEventId('');
    setShowForm(true);
  };

  const handleEdit = (item: ItemWithCount) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormColor(item.color);
    setFormIsActive(item.is_active ?? true);
    setFormIsShared(item.is_shared ?? false);
    setFormIcon((item as any).icon || '');
    setFormGroupName((item as any).group_name || '');
    setFormBudget((item as any).budget ? String((item as any).budget) : '');
    setFormSortOrder((item as any).sort_order !== undefined ? String((item as any).sort_order) : '0');
    setFormActivityTrackerEventId((item as any).family_tracker_event_id || '');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setToast({ message: 'Name is required', type: 'error' });
      return;
    }

    if (activeTab === 'categories' && !formGroupName.trim()) {
      setToast({ message: 'Group name is required for categories', type: 'error' });
      return;
    }

    try {
      const endpoint = activeTab === 'events' ? '/api/events' : activeTab === 'labels' ? '/api/tags' : '/api/categories';
      const method = editingItem ? 'PUT' : 'POST';

      type Payload =
        | { id?: string; name: string; color: string; is_active: boolean; description: null; budget: null; start_date: null; end_date: null; family_tracker_event_id: string | null }
        | { id?: string; name: string; color: string; is_shared: boolean }
        | { id?: string; name: string; icon: string; color: string; group_name: string; budget: number | null };

      let payload: Payload;

      if (activeTab === 'events') {
        payload = {
          ...(editingItem && { id: editingItem.id }),
          name: formName,
          color: formColor,
          is_active: formIsActive,
          description: null,
          budget: null,
          start_date: null,
          end_date: null,
          family_tracker_event_id: formActivityTrackerEventId || null,
        };
      } else if (activeTab === 'labels') {
        payload = {
          ...(editingItem && { id: editingItem.id }),
          name: formName,
          color: formColor,
          is_shared: formIsShared,
        };
      } else {
        // categories
        payload = {
          ...(editingItem && { id: editingItem.id }),
          name: formName,
          group_name: formGroupName,
          icon: formIcon || null,
          color: formColor,
          budget: formBudget ? parseFloat(formBudget) : null,
          sort_order: parseInt(formSortOrder) || 0,
        };
      }

      const res = await fetch(endpoint, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const itemType = activeTab === 'events' ? 'Event' : activeTab === 'labels' ? 'Label' : 'Category';
        setToast({
          message: `${itemType} ${editingItem ? 'updated' : 'created'} successfully`,
          type: 'success'
        });
        setShowForm(false);
        setEditingItem(null);
        fetchData();
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error('Error saving:', error);
      setToast({ message: 'Failed to save', type: 'error' });
    }
  };

  const handleDelete = (item: ItemWithCount) => {
    const type = activeTab === 'events' ? 'event' : activeTab === 'labels' ? 'label' : 'category';
    const title = item.usage_count > 0 ? `Delete ${type} in use?` : `Delete ${type}?`;
    const message = item.usage_count > 0
      ? `This ${type} is used by ${item.usage_count} expense(s). Delete anyway?`
      : `Delete ${type} "${item.name}"?\n\nThis action cannot be undone.`;

    setConfirmDialogConfig({
      title,
      message,
      variant: 'danger',
      onConfirm: async () => {
        try {
          const endpoint = activeTab === 'events' ? `/api/events?id=${item.id}` : activeTab === 'labels' ? `/api/tags?id=${item.id}` : `/api/categories?id=${item.id}`;
          const res = await fetch(endpoint, { method: 'DELETE', credentials: 'include' });

          if (res.ok) {
            setToast({ message: `${type} deleted successfully`, type: 'success' });
            fetchData();
          } else {
            throw new Error('Failed to delete');
          }
        } catch (error) {
          console.error('Error deleting:', error);
          setToast({ message: 'Failed to delete', type: 'error' });
        }
      },
    });
    setConfirmDialogOpen(true);
  };

  const handleDeleteUnused = () => {
    const unusedItems = items.filter(i => i.usage_count === 0);
    const type = activeTab === 'events' ? 'events' : activeTab === 'labels' ? 'labels' : 'categories';

    if (unusedItems.length === 0) {
      setToast({ message: `No unused ${type} to delete`, type: 'error' });
      return;
    }

    setConfirmDialogConfig({
      title: `Delete ${unusedItems.length} unused ${type}?`,
      message: unusedItems.map(i => i.name).join(', '),
      variant: 'danger',
      onConfirm: async () => {
        try {
          const endpoint = activeTab === 'events' ? '/api/events' : activeTab === 'labels' ? '/api/tags' : '/api/categories';
          const deletePromises = unusedItems.map(item =>
            fetch(`${endpoint}?id=${item.id}`, { method: 'DELETE', credentials: 'include' }),
          );

          await Promise.all(deletePromises);

          setToast({ message: `Deleted ${unusedItems.length} unused ${type}`, type: 'success' });
          fetchData();
        } catch (error) {
          console.error('Error deleting unused items:', error);
          setToast({ message: 'Failed to delete unused items', type: 'error' });
        }
      },
    });
    setConfirmDialogOpen(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingItem(null);
  };

  const handleItemClick = async (item: ItemWithCount) => {
    setSelectedItem(item);
    setShowDetailModal(true);
    setIsEditingInModal(false);
    setDetailLoading(true);
    setDetailReport(null);

    try {
      const endpoint = activeTab === 'events'
        ? `/api/reports/by-event?eventId=${item.id}`
        : activeTab === 'labels'
        ? `/api/reports/by-tag?tagId=${item.id}`
        : `/api/reports/by-category?categoryId=${item.id}`;

      const res = await fetch(endpoint, { credentials: 'include' });
      const data = await res.json();
      setDetailReport(data);
    } catch (error) {
      console.error('Error fetching detail report:', error);
      setToast({ message: 'Failed to load details', type: 'error' });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleEditFromModal = () => {
    if (selectedItem) {
      setFormName(selectedItem.name);
      setFormColor(selectedItem.color);
      setFormIsActive(selectedItem.is_active ?? true);
      setFormIsShared(selectedItem.is_shared ?? false);
      setFormDescription(selectedItem.description || '');
      setFormStartDate(selectedItem.start_date || '');
      setFormEndDate(selectedItem.end_date || '');
      setFormBudget(selectedItem.budget ? selectedItem.budget.toString() : '');
      setFormIcon((selectedItem as any).icon || '');
      setFormGroupName((selectedItem as any).group_name || '');
      setFormSortOrder((selectedItem as any).sort_order !== undefined ? String((selectedItem as any).sort_order) : '0');
      setFormActivityTrackerEventId((selectedItem as any).family_tracker_event_id || '');
      setIsEditingInModal(true);
    }
  };

  const handleSaveFromModal = async () => {
    if (!formName.trim()) {
      setToast({ message: 'Name is required', type: 'error' });
      return;
    }

    if (activeTab === 'categories' && !formGroupName.trim()) {
      setToast({ message: 'Group name is required for categories', type: 'error' });
      return;
    }

    if (!selectedItem) return;

    try {
      const endpoint = activeTab === 'events' ? '/api/events' : activeTab === 'labels' ? '/api/tags' : '/api/categories';

      type ModalPayload = Record<string, unknown>;

      const body: ModalPayload = {
        id: selectedItem.id,
        name: formName,
        color: formColor,
      };

      // Add type-specific fields
      if (activeTab === 'events') {
        body.is_active = formIsActive;
        body.description = formDescription || null;
        body.start_date = formStartDate || null;
        body.end_date = formEndDate || null;
        body.budget = formBudget ? parseFloat(formBudget) : null;
        body.family_tracker_event_id = formActivityTrackerEventId || null;
      } else if (activeTab === 'labels') {
        body.is_shared = formIsShared;
      } else {
        // categories
        body.group_name = formGroupName;
        body.icon = formIcon || null;
        body.budget = formBudget ? parseFloat(formBudget) : null;
        body.sort_order = parseInt(formSortOrder) || 0;
      }

      const response = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const itemType = activeTab === 'events' ? 'Event' : activeTab === 'labels' ? 'Label' : 'Category';
        setToast({ message: `${itemType} updated successfully`, type: 'success' });
        setShowDetailModal(false);
        setIsEditingInModal(false);
        await fetchData();
      } else {
        const itemType = activeTab === 'events' ? 'event' : activeTab === 'labels' ? 'label' : 'category';
        setToast({ message: `Failed to update ${itemType}`, type: 'error' });
      }
    } catch (error) {
      console.error('Error updating item:', error);
      const itemType = activeTab === 'events' ? 'event' : activeTab === 'labels' ? 'label' : 'category';
      setToast({ message: `Failed to update ${itemType}`, type: 'error' });
    }
  };

  const handleDeleteFromModal = async () => {
    if (selectedItem) {
      setShowDetailModal(false);
      await handleDelete(selectedItem);
      setSelectedItem(null);
    }
  };


  const handleToggleReport = async (itemId: string) => {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      setItemReport(null);
      return;
    }

    setExpandedItemId(itemId);
    setReportLoading(true);

    try {
      const endpoint = activeTab === 'events'
        ? `/api/reports/by-event?eventId=${itemId}`
        : `/api/reports/by-tag?tagId=${itemId}`;

      const res = await fetch(endpoint, { credentials: 'include' });
      const data = await res.json();
      setItemReport(data);
    } catch (error) {
      console.error('Error fetching report:', error);
      setToast({ message: 'Failed to load report', type: 'error' });
    } finally {
      setReportLoading(false);
    }
  };

  const items = activeTab === 'events' ? events : activeTab === 'labels' ? tags : categories;
  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const groupedCategoryItems = useMemo(() => {
    if (activeTab !== 'categories') return [];
    const grouped = new Map<string, ItemWithCount[]>();
    filteredItems.forEach((item) => {
      const groupName = (item as any).group_name || 'Other';
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName)!.push(item);
    });

    const orderedGroupNames = [
      ...CATEGORY_GROUP_ORDER.filter((name) => grouped.has(name)),
      ...Array.from(grouped.keys())
        .filter((name) => !CATEGORY_GROUP_ORDER.includes(name as (typeof CATEGORY_GROUP_ORDER)[number]))
        .sort((a, b) => a.localeCompare(b)),
    ];

    return orderedGroupNames.map((groupName) => ({
      groupName,
      items: (grouped.get(groupName) || []).sort((a, b) => b.usage_count - a.usage_count),
    }));
  }, [activeTab, filteredItems]);

  const totalCount = items.length;
  const inUseCount = items.filter(i => i.usage_count > 0).length;
  const unusedCount = items.filter(i => i.usage_count === 0).length;

  return (
    <PageContainer>
      <PageHeader 
        title="Organize" 
        description="Manage events and labels for your expenses"
      />

      {/* Tabs */}
      <div className="mb-4">
        <SegmentedControl
          value={activeTab}
          ariaLabel="Organize tab"
          className="w-fit"
          onChange={(tab) => {
            setActiveTab(tab);
            setShowForm(false);
            setSearchQuery('');
          }}
          options={[
            { value: 'events', label: 'Events' },
            { value: 'labels', label: 'Labels' },
            { value: 'categories', label: 'Categories' },
          ]}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="mb-4 flex gap-3 items-center">
            <label htmlFor="organize-search-input" className="sr-only">
              Search items
            </label>
            <input
              id="organize-search-input"
              name="search"
              aria-label={`Search ${activeTab}`}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="flex-1 input"
            />
            <button onClick={handleCreate} className="btn btn-primary whitespace-nowrap">
              + New
            </button>
          </div>

          {/* Stats */}
          <div className="flex gap-3 mb-4 text-sm text-gray-600 items-center">
            <span><strong className="text-gray-900">{totalCount}</strong> total</span>
            <span>•</span>
            <span><strong className="text-green-600">{inUseCount}</strong> in use</span>
            <span>•</span>
            <span><strong className="text-gray-400">{unusedCount}</strong> unused</span>
            {unusedCount > 0 && (
              <>
                <span>•</span>
                <button 
                  onClick={handleDeleteUnused} 
                  className="icon-button-sm text-red-600 hover:text-red-700 text-xs"
                  title={`Delete ${unusedCount} unused ${activeTab}`}
                  aria-label={`Delete ${unusedCount} unused ${activeTab}`}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </>
            )}
          </div>

          {/* Create/Edit Form */}
          {showForm && (
            <div className="bg-white rounded-xl shadow-sm p-4 mb-4 border border-primary-200">
              <h3 className="text-base font-bold text-gray-900 mb-3">
                {editingItem ? 'Edit' : 'Create'} {activeTab === 'events' ? 'Event' : activeTab === 'labels' ? 'Label' : 'Category'}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="label">
                    Name {activeTab === 'categories' && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={activeTab === 'events' ? 'e.g., Vacation 2024' : activeTab === 'labels' ? 'e.g., tax_deductible' : 'e.g., Groceries'}
                    className="w-full input"
                  />
                </div>
                {activeTab === 'categories' && (
                  <>
                    <div>
                      <label className="label">
                        Group Name <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formGroupName}
                        onChange={(e) => setFormGroupName(e.target.value)}
                        className="select"
                      >
                        <option value="">Select group</option>
                        {CATEGORY_GROUP_ORDER.map((group) => (
                          <option key={group} value={group}>
                            {group}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">
                        Icon (emoji or text)
                      </label>
                      <input
                        type="text"
                        value={formIcon}
                        onChange={(e) => setFormIcon(e.target.value)}
                        placeholder="e.g., 🛒 or $"
                        className="w-full input"
                      />
                    </div>
                    <div>
                      <label className="label">
                        Budget (optional)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={formBudget}
                        onChange={(e) => setFormBudget(e.target.value)}
                        placeholder="e.g., 5000"
                        className="w-full input"
                      />
                    </div>
                    <div>
                      <label className="label">
                        Sort Order
                      </label>
                      <input
                        type="number"
                        value={formSortOrder}
                        onChange={(e) => setFormSortOrder(e.target.value)}
                        placeholder="0"
                        className="w-full input"
                      />
                    </div>
                  </>
                )}
                {activeTab === 'events' && (
                  <AutocompleteDropdown
                    label="Link to Activity Tracker Event (optional)"
                    options={activityTrackerEventOptions}
                    value={formActivityTrackerEventId}
                    onChange={(value) => setFormActivityTrackerEventId(value)}
                    placeholder="Type to search or leave empty for no link"
                    filterKeys={['label', 'sublabel']}
                    emptyMessage="No matching events"
                    allowClear={true}
                    inputClassName="input"
                  />
                )}
                <div>
                  <label className="label">Color</label>
                  <div className="flex gap-2">
                    {['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'].map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormColor(color)}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          formColor === color ? 'border-gray-900 scale-110' : 'border-gray-300'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                {activeTab === 'events' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formIsActive}
                      onChange={(e) => setFormIsActive(e.target.checked)}
                      className="w-4 h-4 text-primary-600 rounded"
                    />
                    <span className="text-gray-700">Active</span>
                  </label>
                ) : activeTab === 'labels' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formIsShared}
                      onChange={(e) => setFormIsShared(e.target.checked)}
                      className="w-4 h-4 text-primary-600 rounded"
                    />
                    <span className="text-gray-700">Shared with all users</span>
                  </label>
                ) : null}
                <div className="flex gap-2">
                  <button onClick={handleSave} className="btn btn-primary">
                    {editingItem ? 'Edit' : 'Create'}
                  </button>
                  <button onClick={handleCancel} className="btn btn-ghost">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Items List */}
          {filteredItems.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-4 text-center py-12">
              <p className="text-gray-500 mb-2">
                No {activeTab} found
              </p>
              <p className="text-sm text-gray-400">
                {searchQuery
                  ? 'Try a different search query'
                  : `Create your first ${activeTab === 'events' ? 'event' : 'label'} to get started`}
              </p>
            </div>
          ) : activeTab === 'categories' ? (
            <div className="space-y-3">
              {groupedCategoryItems.map(({ groupName, items }) => (
                <div key={groupName} className="space-y-2">
                  <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {groupName}
                  </div>
                  {items.map((item) => (
                    <div key={item.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                      <ListItemRow
                        title={
                          <span className="flex items-center gap-2 flex-wrap">
                            {(item as any).icon ? <span className="text-lg">{(item as any).icon}</span> : null}
                            <span>{item.name}</span>
                          </span>
                        }
                        subtitle={
                          <span>
                            {item.usage_count} expense{item.usage_count !== 1 ? 's' : ''}
                            {(item as any).budget ? (
                              <span className="ml-2">• Budget: {formatCurrency((item as any).budget)}</span>
                            ) : null}
                          </span>
                        }
                        onClick={() => handleItemClick(item)}
                        className="p-3"
                        leading={(
                          <span
                            className="w-5 h-5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                        )}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => (
                <div key={item.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <ListItemRow
                    title={
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className={activeTab === 'labels' ? 'font-mono text-sm' : ''}>{item.name}</span>
                        {activeTab === 'events' && !item.is_active ? (
                          <span className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-600 rounded">
                            inactive
                          </span>
                        ) : null}
                        {activeTab === 'labels' && item.is_shared ? (
                          <span className="px-1.5 py-0.5 text-xs bg-primary-100 text-primary-700 rounded">
                            shared
                          </span>
                        ) : null}
                      </span>
                    }
                    subtitle={`${item.usage_count} expense${item.usage_count !== 1 ? 's' : ''}`}
                    onClick={() => handleItemClick(item)}
                    className="p-3"
                    leading={(
                      <span
                        className="w-5 h-5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                    )}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedItem && (
        <div
          className="fixed inset-0 bg-black bg-opacity-25 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDetailModal(false);
            }
          }}
        >
          <div
            className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {!isEditingInModal ? (
              // View Mode
              <>
                {/* Header */}
                <div className="bg-primary-50 px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {activeTab === 'events' ? 'Event' : activeTab === 'labels' ? 'Label' : 'Category'} Details
                    </h3>
                    <button
                      onClick={() => setShowDetailModal(false)}
                      className="text-gray-400 hover:text-gray-600 text-2xl"
                    >
                      ×
                    </button>
                  </div>
                </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Name with color indicator */}
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: selectedItem.color }}
                />
                <p className="text-lg font-medium text-gray-900">{selectedItem.name}</p>
              </div>

              {/* Description (for events) */}
              {activeTab === 'events' && selectedItem.description && (
                <p className="text-sm text-gray-600">{selectedItem.description}</p>
              )}

              {/* Linked Activity Tracker Event (for events) */}
              {activeTab === 'events' && (selectedItem as any).family_tracker_event_id && (
                <div className="flex items-center gap-2 p-3 bg-primary-50 border border-primary-200 rounded-lg">
                  <Link2 size={18} className="flex-shrink-0 text-primary-600" aria-hidden />
                  <div className="flex-1">
                    <p className="text-xs text-primary-600 font-medium">Linked to Activity Tracker</p>
                    <p className="text-sm text-gray-900">
                      {activityTrackerEvents.find(e => e.id === (selectedItem as any).family_tracker_event_id)?.title || 'Loading...'}
                    </p>
                  </div>
                </div>
              )}

              {/* Category-specific details */}
              {activeTab === 'categories' && (
                <div className="space-y-2 text-sm">
                  {(selectedItem as any).icon && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <span>Icon:</span>
                      <span className="text-lg">{(selectedItem as any).icon}</span>
                    </div>
                  )}
                  {(selectedItem as any).group_name && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <FolderOpen size={14} className="flex-shrink-0" aria-hidden />
                      <span>Group: {(selectedItem as any).group_name}</span>
                    </div>
                  )}
                  {(selectedItem as any).budget && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Wallet size={14} className="flex-shrink-0" aria-hidden />
                      <span>Budget: {formatCurrency((selectedItem as any).budget)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-gray-600">
                    <Hash size={14} className="flex-shrink-0" aria-hidden />
                    <span>Sort Order: {(selectedItem as any).sort_order || 0}</span>
                  </div>
                </div>
              )}

              {/* Usage count and status */}
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span>{selectedItem.usage_count} expense{selectedItem.usage_count !== 1 ? 's' : ''}</span>
                {activeTab === 'events' && !selectedItem.is_active && (
                  <>
                    <span>•</span>
                    <span className="text-gray-400">Inactive</span>
                  </>
                )}
                {activeTab === 'labels' && !selectedItem.is_shared && (
                  <>
                    <span>•</span>
                    <span className="text-purple-600">Private</span>
                  </>
                )}
              </div>

              {/* Event-specific details */}
              {activeTab === 'events' && (
                <div className="space-y-2 text-sm">
                  {(selectedItem.start_date || selectedItem.end_date) && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Calendar size={14} className="flex-shrink-0" aria-hidden />
                      <span>
                        {selectedItem.start_date && format(new Date(selectedItem.start_date), 'MMM d, yyyy')}
                        {selectedItem.start_date && selectedItem.end_date && ' - '}
                        {selectedItem.end_date && format(new Date(selectedItem.end_date), 'MMM d, yyyy')}
                      </span>
                    </div>
                  )}
                  {selectedItem.budget && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Wallet size={14} className="flex-shrink-0" aria-hidden />
                      <span>Budget: {formatCurrency(selectedItem.budget)}</span>
                    </div>
                  )}
                  {/* Status based on is_active and dates */}
                  <div className="flex items-center gap-2">
                    {selectedItem.is_active ? (
                      <>
                        {!selectedItem.end_date || new Date(selectedItem.end_date) >= new Date() ? (
                          <div className="flex items-center gap-2 text-green-600">
                            <Check size={14} className="flex-shrink-0" aria-hidden />
                            <span>Active • Can be added to expenses</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-primary-600">
                            <Check size={14} className="flex-shrink-0" aria-hidden />
                            <span>Active • Completed</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-400">
                        <X size={14} className="flex-shrink-0" aria-hidden />
                        <span>Inactive • Cannot be added to expenses</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Summary Stats */}
              {detailLoading ? (
                <div className="flex justify-center py-6">
                  <LoadingSpinner />
                </div>
              ) : detailReport && selectedItem.usage_count > 0 ? (
                <>
                  {/* Total and Average */}
                  <div className="flex gap-4 text-sm text-gray-600 pt-2">
                    <div>
                      <span>Total: </span>
                      <span className="font-bold text-gray-900">{formatCurrency(detailReport.totalSpent)}</span>
                    </div>
                    <span>•</span>
                    <div>
                      <span>Avg: </span>
                      <span className="font-bold text-gray-900">
                        {formatCurrency(detailReport.expenseCount > 0 ? detailReport.totalSpent / detailReport.expenseCount : 0)}
                      </span>
                    </div>
                  </div>

                  {/* By Category */}
                  {Object.keys(detailReport.byCategory).length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-700 mb-2 text-sm">Top Categories</h4>
                      <div className="space-y-2">
                        {Object.values(detailReport.byCategory)
                          .sort((a, b) => b.amount - a.amount)
                          .slice(0, 3)
                          .map((cat) => (
                            <div key={cat.name} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: cat.color }}
                                />
                                <span className="text-gray-700">{cat.name}</span>
                                <span className="text-gray-400 text-xs">({cat.count})</span>
                              </div>
                              <span className="font-medium text-gray-900">
                                {formatCurrency(cat.amount)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Recent Expenses */}
                  {detailReport.recentExpenses && detailReport.recentExpenses.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-700 mb-2 text-sm">Recent Expenses</h4>
                      <div className="space-y-2">
                        {detailReport.recentExpenses.slice(0, 5).map((expense) => (
                          <div key={expense.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-100 last:border-0">
                            <div className="flex-1 min-w-0">
                              <div className="text-gray-900 truncate">{expense.description}</div>
                              <div className="text-xs text-gray-500">
                                {format(new Date(expense.date), 'MMM d, yyyy')}
                              </div>
                            </div>
                            <div className="font-medium text-gray-900 ml-2">
                              {formatCurrency(expense.amount)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>

                {/* Actions */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
                  <ModalRecordActions
                    onDelete={handleDeleteFromModal}
                    onEdit={handleEditFromModal}
                  />
                </div>
              </>
            ) : (
              // Edit Mode
              <>
                {/* Header */}
                <div className="bg-primary-50 px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Edit {activeTab === 'events' ? 'Event' : activeTab === 'labels' ? 'Label' : 'Category'}
                    </h3>
                    <button
                      onClick={() => setIsEditingInModal(false)}
                      className="text-gray-400 hover:text-gray-600 text-2xl"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Edit Form */}
                <div className="p-6 space-y-4">
                  {/* Name */}
                  <div>
                    <label className="label mb-2">
                      Name
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="input"
                      autoFocus
                    />
                  </div>

                  {/* Description (Events only) */}
                  {activeTab === 'events' && (
                    <div>
                      <label className="label mb-2">
                        Description
                      </label>
                      <input
                        type="text"
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        className="input"
                        placeholder="Optional description"
                      />
                    </div>
                  )}

                  {/* Link to Activity Tracker Event (Events only) */}
                  {activeTab === 'events' && (
                    <AutocompleteDropdown
                      label="Link to Activity Tracker Event"
                      options={activityTrackerEventOptions}
                      value={formActivityTrackerEventId}
                      onChange={(value) => setFormActivityTrackerEventId(value)}
                      placeholder="Type to search or leave empty for no link"
                      filterKeys={['label', 'sublabel']}
                      emptyMessage="No matching events"
                      allowClear={true}
                      inputClassName="input"
                    />
                  )}

                  {/* Category-specific fields */}
                  {activeTab === 'categories' && (
                    <>
                      <div>
                        <label className="label mb-2">
                          Group Name <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={formGroupName}
                          onChange={(e) => setFormGroupName(e.target.value)}
                          className="select"
                        >
                          <option value="">Select group</option>
                          {CATEGORY_GROUP_ORDER.map((group) => (
                            <option key={group} value={group}>
                              {group}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label mb-2">
                          Icon (emoji)
                        </label>
                        <EmojiPicker
                          value={formIcon}
                          onChange={(emoji) => setFormIcon(emoji)}
                          placeholder="e.g., 🛒 or $"
                        />
                        <p className="text-xs text-gray-500 mt-1">Use an emoji to represent this category</p>
                      </div>
                      <div>
                        <label className="label mb-2">
                          Sort Order
                        </label>
                        <input
                          type="number"
                          value={formSortOrder}
                          onChange={(e) => setFormSortOrder(e.target.value)}
                          className="input"
                        />
                      </div>
                    </>
                  )}

                  {/* Color */}
                  <div>
                    <label className="label mb-2">
                      Color
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={formColor}
                        onChange={(e) => setFormColor(e.target.value)}
                        className="w-12 h-10 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formColor}
                        onChange={(e) => setFormColor(e.target.value)}
                        className="input flex-1 font-mono"
                        placeholder="#000000"
                      />
                    </div>
                  </div>

                  {/* Date Range (Events only) */}
                  {activeTab === 'events' && (
                    <>
                      <div>
                        <label className="label mb-2">
                          Start Date
                        </label>
                        <input
                          type="date"
                          value={formStartDate}
                          onChange={(e) => setFormStartDate(e.target.value)}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label mb-2">
                          End Date
                        </label>
                        <input
                          type="date"
                          value={formEndDate}
                          onChange={(e) => setFormEndDate(e.target.value)}
                          className="input"
                        />
                      </div>
                    </>
                  )}

                  {/* Budget (Events and Categories) */}
                  {(activeTab === 'events' || activeTab === 'categories') && (
                    <div>
                      <label className="label mb-2">
                        Budget
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={formBudget}
                        onChange={(e) => setFormBudget(e.target.value)}
                        className="input"
                        placeholder="Optional budget"
                      />
                    </div>
                  )}

                  {/* Active Status (Events only) */}
                  {activeTab === 'events' && (
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formIsActive}
                          onChange={(e) => setFormIsActive(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-sm text-gray-700">Active (available for expenses)</span>
                      </label>
                    </div>
                  )}

                  {/* Shared Status (Labels only) */}
                  {activeTab === 'labels' && (
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formIsShared}
                          onChange={(e) => setFormIsShared(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-sm text-gray-700">Shared (visible to all users)</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3">
                  <button
                    onClick={() => setIsEditingInModal(false)}
                    className="btn btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveFromModal}
                    className="btn btn-primary flex-1"
                  >
                    Save Changes
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialogOpen}
        onClose={() => setConfirmDialogOpen(false)}
        onConfirm={confirmDialogConfig.onConfirm}
        title={confirmDialogConfig.title}
        message={confirmDialogConfig.message}
        variant={confirmDialogConfig.variant}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </PageContainer>
  );
}
