'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { User } from '@/types';
import { UserService } from '@/lib/services/UserService';
import { createSupabaseBrowserClient } from '@/lib/api/browser';
import { useCachedFetch, invalidateCache } from '@/lib/useClientCache';

/**
 * Custom hook for managing users with caching
 * Uses UserService for all operations
 * 30-minute cache, manual refresh via button
 */
export function useUsers() {
  const supabase = createSupabaseBrowserClient();
  const userService = useMemo(() => new UserService(supabase), [supabase]);

  const fetcher = useCallback(async () => {
    return await userService.getAllUsers();
  }, [userService]);

  const { data: users, loading, refresh } = useCachedFetch<User[]>(
    'users',
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

  const updateUser = useCallback(async (id: string, data: Partial<User>) => {
    try {
      const updated = await userService.updateUser(id, data);
      invalidateCache('users');
      await refresh();
      return updated;
    } catch (err) {
      console.error('Error updating user:', err);
      setError(err instanceof Error ? err.message : 'Failed to update user');
      throw err;
    }
  }, [userService, refresh]);

  return {
    users: users || [],
    loading,
    error,
    refetch: refresh,
    updateUser,
  };
}
