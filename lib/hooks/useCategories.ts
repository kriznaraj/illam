'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Category } from '@/types';
import { CategoryService } from '@/lib/services/CategoryService';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { useCachedFetch, invalidateCache } from '@/lib/useClientCache';

/**
 * Custom hook for managing categories with caching
 * Uses CategoryService for all operations
 * 30-minute cache, manual refresh via button
 */
export function useCategories() {
  const supabase = createSupabaseBrowserClient();
  const categoryService = useMemo(() => new CategoryService(supabase), [supabase]);

  const fetcher = useCallback(async () => {
    return await categoryService.getAllCategories();
  }, [categoryService]);

  const { data: categories, loading, refresh } = useCachedFetch<Category[]>(
    'categories',
    fetcher,
    { ttl: 30 * 60 * 1000, revalidate: false } // 30 min, pure cache
  );

  const [error, setError] = useState<string | null>(null);

  // Listen for cache clear events
  useEffect(() => {
    const handleCacheCleared = () => {
      refresh();
    };
    window.addEventListener('cacheCleared', handleCacheCleared);
    return () => window.removeEventListener('cacheCleared', handleCacheCleared);
  }, [refresh]);

  const createCategory = useCallback(async (data: Partial<Category>) => {
    try {
      const newCategory = await categoryService.createCategory(data);
      invalidateCache('categories');
      await refresh();
      return newCategory;
    } catch (err) {
      console.error('Error creating category:', err);
      setError(err instanceof Error ? err.message : 'Failed to create category');
      throw err;
    }
  }, [categoryService, refresh]);

  const updateCategory = useCallback(async (id: string, data: Partial<Category>) => {
    try {
      const updated = await categoryService.updateCategory(id, data);
      invalidateCache('categories');
      await refresh();
      return updated;
    } catch (err) {
      console.error('Error updating category:', err);
      setError(err instanceof Error ? err.message : 'Failed to update category');
      throw err;
    }
  }, [categoryService, refresh]);

  const deleteCategory = useCallback(async (id: string) => {
    try {
      await categoryService.deleteCategory(id);
      invalidateCache('categories');
      await refresh();
    } catch (err) {
      console.error('Error deleting category:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete category');
      throw err;
    }
  }, [categoryService, refresh]);

  return {
    categories: categories || [],
    loading,
    error,
    refetch: refresh,
    createCategory,
    updateCategory,
    deleteCategory,
  };
}
