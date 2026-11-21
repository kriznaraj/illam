'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tag } from '@/types';
import { TagService } from '@/lib/services/TagService';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { useCachedFetch, invalidateCache } from '@/lib/useClientCache';

/**
 * Custom hook for managing tags with caching
 * Uses TagService for all operations
 * 30-minute cache, manual refresh via button
 */
export function useTags(userId?: string) {
  const supabase = createSupabaseBrowserClient();
  const tagService = useMemo(() => new TagService(supabase), [supabase]);

  const cacheKey = userId ? `tags-${userId}` : 'tags-all';

  const fetcher = useCallback(async () => {
    return userId
      ? await tagService.getTagsForUser(userId)
      : await tagService.getAllTags();
  }, [tagService, userId]);

  const { data: tags, loading, refresh } = useCachedFetch<Tag[]>(
    cacheKey,
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

  const createTag = useCallback(async (data: Partial<Tag>) => {
    try {
      const newTag = await tagService.createTag(data);
      invalidateCache(cacheKey);
      invalidateCache('tags-all');
      await refresh();
      return newTag;
    } catch (err) {
      console.error('Error creating tag:', err);
      setError(err instanceof Error ? err.message : 'Failed to create tag');
      throw err;
    }
  }, [tagService, cacheKey, refresh]);

  const findOrCreateTag = useCallback(async (name: string, userId?: string) => {
    try {
      const tag = await tagService.findOrCreateTag(name, userId);
      invalidateCache(cacheKey);
      invalidateCache('tags-all');
      await refresh();
      return tag;
    } catch (err) {
      console.error('Error finding or creating tag:', err);
      setError(err instanceof Error ? err.message : 'Failed to find/create tag');
      throw err;
    }
  }, [tagService, cacheKey, refresh]);

  const updateTag = useCallback(async (id: string, data: Partial<Tag>) => {
    try {
      const updated = await tagService.updateTag(id, data);
      invalidateCache(cacheKey);
      invalidateCache('tags-all');
      await refresh();
      return updated;
    } catch (err) {
      console.error('Error updating tag:', err);
      setError(err instanceof Error ? err.message : 'Failed to update tag');
      throw err;
    }
  }, [tagService, cacheKey, refresh]);

  const deleteTag = useCallback(async (id: string) => {
    try {
      await tagService.deleteTag(id);
      invalidateCache(cacheKey);
      invalidateCache('tags-all');
      await refresh();
    } catch (err) {
      console.error('Error deleting tag:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete tag');
      throw err;
    }
  }, [tagService, cacheKey, refresh]);

  return {
    tags: tags || [],
    loading,
    error,
    refetch: refresh,
    createTag,
    findOrCreateTag,
    updateTag,
    deleteTag,
  };
}
