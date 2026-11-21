'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Expense } from '@/types';
import { ExpenseService } from '@/lib/services/ExpenseService';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { useCachedFetch, invalidateCache } from '@/lib/useClientCache';

/**
 * Custom hook for managing expenses with caching
 * Uses ExpenseService for all operations
 * 30-minute cache, manual refresh via button
 */
export function useExpenses(startDate?: string, endDate?: string) {
  const supabase = createSupabaseBrowserClient();
  const expenseService = useMemo(() => new ExpenseService(supabase), [supabase]);

  // Create unique cache key based on parameters
  const cacheKey = startDate && endDate
    ? `expenses-${startDate}-${endDate}`
    : 'expenses-all';

  const fetcher = useCallback(async () => {
    if (startDate && endDate) {
      return await expenseService.getExpensesByDateRange(startDate, endDate);
    } else {
      return await expenseService.getAllExpenses();
    }
  }, [expenseService, startDate, endDate]);

  const { data: expenses, loading, refresh } = useCachedFetch<Expense[]>(
    cacheKey,
    fetcher,
    { ttl: 30 * 60 * 1000, revalidate: false } // 30 min, pure cache
  );

  const [error, setError] = useState<string | null>(null);

  const parseApiError = useCallback(async (response: Response, fallback: string) => {
    try {
      const payload = await response.json();
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const apiError = (payload as { error?: unknown }).error;
        if (typeof apiError === 'string' && apiError.trim()) {
          return apiError;
        }
      }
      return fallback;
    } catch {
      return fallback;
    }
  }, []);

  // Listen for cache clear events
  useEffect(() => {
    const handleCacheCleared = () => {
      refresh();
    };
    window.addEventListener('cacheCleared', handleCacheCleared);
    return () => window.removeEventListener('cacheCleared', handleCacheCleared);
  }, [refresh]);

  const createExpense = useCallback(async (data: Partial<Expense>) => {
    try {
      const response = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to create expense'));
      }

      const newExpense = await response.json();
      // Invalidate all expense caches
      invalidateCache(cacheKey);
      invalidateCache('expenses-all');
      invalidateCache('home-stats');
      // Trigger refetch
      await refresh();
      return newExpense;
    } catch (err) {
      console.error('Error creating expense:', err);
      setError(err instanceof Error ? err.message : 'Failed to create expense');
      throw err;
    }
  }, [cacheKey, parseApiError, refresh]);

  const updateExpense = useCallback(async (id: string, data: Partial<Expense>) => {
    try {
      const response = await fetch('/api/expenses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...data }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to update expense'));
      }

      const updated = await response.json();
      // Invalidate all expense caches
      invalidateCache(cacheKey);
      invalidateCache('expenses-all');
      invalidateCache('home-stats');
      // Trigger refetch
      await refresh();
      return updated;
    } catch (err) {
      console.error('Error updating expense:', err);
      setError(err instanceof Error ? err.message : 'Failed to update expense');
      throw err;
    }
  }, [cacheKey, parseApiError, refresh]);

  const deleteExpense = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/expenses?id=${id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to delete expense'));
      }
      // Invalidate all expense caches
      invalidateCache(cacheKey);
      invalidateCache('expenses-all');
      invalidateCache('home-stats');
      // Trigger refetch
      await refresh();
    } catch (err) {
      console.error('Error deleting expense:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete expense');
      throw err;
    }
  }, [cacheKey, parseApiError, refresh]);

  const deleteExpenses = useCallback(async (ids: string[]) => {
    try {
      const deleteResponses = await Promise.all(
        ids.map((id) => fetch(`/api/expenses?id=${id}`, { method: 'DELETE' }))
      );
      const failedResponse = deleteResponses.find((response) => !response.ok);
      if (failedResponse) {
        throw new Error(await parseApiError(failedResponse, 'Failed to delete expenses'));
      }
      // Invalidate all expense caches
      invalidateCache(cacheKey);
      invalidateCache('expenses-all');
      invalidateCache('home-stats');
      // Trigger refetch
      await refresh();
    } catch (err) {
      console.error('Error deleting expenses:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete expenses');
      throw err;
    }
  }, [cacheKey, parseApiError, refresh]);

  return {
    expenses: expenses || [],
    loading,
    error,
    refetch: refresh,
    createExpense,
    updateExpense,
    deleteExpense,
    deleteExpenses,
  };
}
