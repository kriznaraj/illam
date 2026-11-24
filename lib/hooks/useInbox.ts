import { useCallback, useEffect, useState } from 'react';
import { invalidateCachePattern, useCachedFetch } from '../useClientCache';
import { inboxApi } from '../inbox/client';
import type { InboxItem, InboxListResponse, InboxOwner, InboxStatus, InboxView } from '@/types';

const CACHE_PREFIX = 'inbox-';
const TTL = 5 * 60 * 1000;
const EMPTY_ITEMS: InboxItem[] = [];

export type InboxOwnerFilter = InboxOwner | 'both';

/** Mail keeps arriving while the page is cached, so the inbox always revalidates in the background. */
export function useInbox(view: InboxView, owner: InboxOwnerFilter) {
  const fetcher = useCallback(
    () => inboxApi.list({ view, owner: owner === 'both' ? undefined : owner }),
    [view, owner]
  );
  const { data, loading, refresh } = useCachedFetch<InboxListResponse>(
    `${CACHE_PREFIX}${view}-${owner}`,
    fetcher,
    { ttl: TTL, revalidate: true }
  );

  // Pages beyond the first are not cached; they reset whenever the filter changes.
  const [older, setOlder] = useState<InboxItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reset while rendering (not in an effect) so the old filter's pages never show with the new one.
  const filterKey = `${view}|${owner}`;
  const [pagedKey, setPagedKey] = useState(filterKey);
  if (pagedKey !== filterKey) {
    setPagedKey(filterKey);
    setOlder([]);
    setCursor(null);
  }

  useEffect(() => {
    const handleCacheCleared = () => {
      setOlder([]);
      setCursor(null);
      refresh();
    };
    window.addEventListener('cacheCleared', handleCacheCleared);
    return () => window.removeEventListener('cacheCleared', handleCacheCleared);
  }, [refresh]);

  const nextCursor = older.length > 0 ? cursor : data?.nextCursor ?? null;

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await inboxApi.list({ view, owner: owner === 'both' ? undefined : owner, before: nextCursor });
      setOlder((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const setStatus = async (id: string, status: InboxStatus) => {
    const updated = await inboxApi.setStatus(id, status);
    invalidateCachePattern(CACHE_PREFIX);
    setOlder((prev) => prev.map((item) => (item.id === id ? updated : item)));
    await refresh();
    return updated;
  };

  return {
    items: data ? [...data.items, ...older] : EMPTY_ITEMS,
    attentionCount: data?.attentionCount ?? 0,
    loading,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore,
    refresh,
    setStatus,
  };
}

const EMPTY_RESPONSE: InboxListResponse = { items: [], attentionCount: 0, nextCursor: null };

/**
 * The top few items still waiting on a person, for /home and the navigation badge.
 * `enabled: false` skips the request (Navigation also renders on /login, where it would 401).
 */
export function useInboxAttention(limit = 3, enabled = true) {
  const fetcher = useCallback(
    () => (enabled ? inboxApi.list({ view: 'todo', limit }) : Promise.resolve(EMPTY_RESPONSE)),
    [limit, enabled]
  );
  const { data, loading, refresh } = useCachedFetch<InboxListResponse>(
    `${CACHE_PREFIX}attention-summary-${limit}${enabled ? '' : '-off'}`,
    fetcher,
    { ttl: TTL, revalidate: true }
  );

  useEffect(() => {
    window.addEventListener('cacheCleared', refresh);
    return () => window.removeEventListener('cacheCleared', refresh);
  }, [refresh]);

  return {
    items: data?.items ?? EMPTY_ITEMS,
    count: data?.attentionCount ?? 0,
    loading,
  };
}
