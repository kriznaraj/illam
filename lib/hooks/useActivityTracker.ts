import { useEffect, useCallback } from 'react';
import { useCachedFetch } from '../useClientCache';
import { activityTrackerApi } from '../activity-tracker/client';
import type { ActivityTrackerEvent, ActivityTrackerFormData, ActivityTrackerOccurrence } from '@/types';

const CACHE_KEY = 'activity-tracker-events';
const HISTORY_CACHE_KEY = 'activity-tracker-history';
const EMPTY_EVENTS: ActivityTrackerEvent[] = [];

export function useActivityTracker() {
  const {
    data: events,
    loading,
    refresh,
  } = useCachedFetch<ActivityTrackerEvent[]>(CACHE_KEY, activityTrackerApi.getOpenEvents);

  const {
    data: closedEvents,
    loading: loadingHistory,
    refresh: refreshHistory,
  } = useCachedFetch<ActivityTrackerEvent[]>(HISTORY_CACHE_KEY, activityTrackerApi.getHistory);

  useEffect(() => {
    const handleCacheCleared = () => {
      refresh();
      refreshHistory();
    };
    window.addEventListener('cacheCleared', handleCacheCleared);
    return () => window.removeEventListener('cacheCleared', handleCacheCleared);
  }, [refresh, refreshHistory]);

  const refreshAll = async () => {
    await refresh();
    await refreshHistory();
  };

  const createEvent = async (formData: ActivityTrackerFormData) => {
    const data = await activityTrackerApi.createEvent(formData);
    await refreshAll();
    return data;
  };

  const updateEvent = async (id: string, formData: Partial<ActivityTrackerFormData>) => {
    const data = await activityTrackerApi.updateEvent(id, formData);
    await refreshAll();
    return data;
  };

  const deleteEvent = async (id: string) => {
    await activityTrackerApi.deleteEvent(id);
    await refreshAll();
  };

  const closeEvent = async (id: string) => {
    const data = await activityTrackerApi.setEventStatus(id);
    await refreshAll();
    return data;
  };

  const reopenEvent = async (id: string) => {
    const data = await activityTrackerApi.setEventStatus(id, true);
    await refreshAll();
    return data;
  };

  const fetchOccurrences = useCallback(
    (eventId: string) => activityTrackerApi.getOccurrences(eventId),
    []
  );

  const logOccurrence = async (
    eventId: string,
    options?: { date?: string; comment?: string }
  ) => {
    await activityTrackerApi.logOccurrence(eventId, options);
    await refreshAll();
  };

  const updateOccurrence = async (
    eventId: string,
    occurrenceId: string,
    data: { date?: string; comment?: string }
  ): Promise<ActivityTrackerOccurrence> => {
    const result = await activityTrackerApi.updateOccurrence(eventId, occurrenceId, data);
    await refreshAll();
    return result;
  };

  const deleteOccurrence = async (eventId: string, occurrenceId: string) => {
    await activityTrackerApi.deleteOccurrence(eventId, occurrenceId);
    await refreshAll();
  };

  return {
    events: events ?? EMPTY_EVENTS,
    closedEvents: closedEvents ?? EMPTY_EVENTS,
    loading,
    loadingHistory,
    refresh: refreshAll,
    createEvent,
    updateEvent,
    deleteEvent,
    closeEvent,
    reopenEvent,
    fetchOccurrences,
    logOccurrence,
    updateOccurrence,
    deleteOccurrence,
  };
}
