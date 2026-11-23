'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface CacheEntry<T> {
  value: T;
  ts: number;
}

interface CacheOptions {
  ttl?: number;        // Time to live in milliseconds (default: 30 minutes)
  revalidate?: boolean; // Whether to fetch in background (default: false for pure cache mode)
}

const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

// Prefix all cache keys to avoid conflicts with Supabase auth tokens
const CACHE_PREFIX = 'app-cache-';

function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.ts > ttlMs) return null;
    return entry.value;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  try {
    const entry: CacheEntry<T> = { value, ts: Date.now() };
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // sessionStorage unavailable (private mode etc.) — silently ignore
  }
}

/**
 * Cached fetch hook backed by sessionStorage.
 * - Returns cached data instantly on revisit (no loading flash)
 * - Optionally fetches fresh data in background (revalidate: true)
 * - Default: Pure cache mode (30 min TTL, no background fetch)
 * - `loading` is only true when there is NO cached data yet
 */
export function useCachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions | number = {}
): { data: T | null; loading: boolean; refresh: () => Promise<void> } {
  // Support legacy number parameter for TTL
  const opts: CacheOptions = typeof options === 'number'
    ? { ttl: options, revalidate: true }
    : options;

  const ttlMs = opts.ttl ?? DEFAULT_TTL;
  const shouldRevalidate = opts.revalidate ?? false;

  // Always start null so server and client initial renders match (avoids hydration mismatch).
  // Cache is read client-side in useEffect, appearing near-instant after hydration.
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  const doFetch = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      writeCache(key, result);
      setData(result);
    } catch (err) {
      console.error(`useCachedFetch[${key}]:`, err);
    } finally {
      setLoading(false);
    }
  }, [key]);

  // Separate effect to handle key changes
  useEffect(() => {
    // When key changes, reset state to show loading
    setLoading(true);
    setData(null);
  }, [key]);

  useEffect(() => {
    // Populate from cache immediately (client-only, runs after hydration)
    const cached = readCache<T>(key, ttlMs);
    if (cached !== null) {
      setData(cached);
      setLoading(false);
      // Only revalidate in background if enabled
      if (shouldRevalidate) {
        doFetch();
      }
    } else {
      // No valid cache — fetch immediately
      doFetch();
    }
  }, [doFetch, key, ttlMs, shouldRevalidate]);

  return { data, loading, refresh: doFetch };
}

export function invalidateCache(key: string): void {
  try {
    sessionStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // ignore
  }
}

export function clearAllCache(): void {
  try {
    // Clear only app cache entries, preserve Supabase auth session
    const keys = Object.keys(sessionStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    });

    // Dispatch only cache clear events (not mutation events like 'expenseAdded')
    // Mutation events trigger toasts, which we don't want on refresh
    window.dispatchEvent(new CustomEvent('cacheCleared'));

    console.log('Cache cleared (auth session preserved)');
  } catch {
    // ignore
  }
}

export function invalidateCachePattern(pattern: string): void {
  try {
    const keys = Object.keys(sessionStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX) && key.includes(pattern)) {
        sessionStorage.removeItem(key);
      }
    });
  } catch {
    // ignore
  }
}
