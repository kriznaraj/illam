'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Event } from '@/types';
import { EventService } from '@/lib/services/EventService';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { useCachedFetch, invalidateCache } from '@/lib/useClientCache';

/**
 * Custom hook for managing events with caching
 * Uses EventService for all operations
 * 30-minute cache, manual refresh via button
 */
export function useEvents() {
  const supabase = createSupabaseBrowserClient();
  const eventService = useMemo(() => new EventService(supabase), [supabase]);

  const fetcher = useCallback(async () => {
    return await eventService.getAllEvents();
  }, [eventService]);

  const { data: events, loading, refresh } = useCachedFetch<Event[]>(
    'events',
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

  const createEvent = useCallback(async (data: Partial<Event>) => {
    try {
      const newEvent = await eventService.createEvent(data);
      invalidateCache('events');
      await refresh();
      return newEvent;
    } catch (err) {
      console.error('Error creating event:', err);
      setError(err instanceof Error ? err.message : 'Failed to create event');
      throw err;
    }
  }, [eventService, refresh]);

  const updateEvent = useCallback(async (id: string, data: Partial<Event>) => {
    try {
      const updated = await eventService.updateEvent(id, data);
      invalidateCache('events');
      await refresh();
      return updated;
    } catch (err) {
      console.error('Error updating event:', err);
      setError(err instanceof Error ? err.message : 'Failed to update event');
      throw err;
    }
  }, [eventService, refresh]);

  const deleteEvent = useCallback(async (id: string) => {
    try {
      await eventService.deleteEvent(id);
      invalidateCache('events');
      await refresh();
    } catch (err) {
      console.error('Error deleting event:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete event');
      throw err;
    }
  }, [eventService, refresh]);

  return {
    events: events || [],
    loading,
    error,
    refetch: refresh,
    createEvent,
    updateEvent,
    deleteEvent,
  };
}
