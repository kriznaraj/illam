import { useCallback, useEffect } from 'react';
import { invalidateCachePattern, useCachedFetch } from '../useClientCache';
import type { Income, IncomeWithUser } from '@/types';
import type { IncomeSummary } from '@/lib/services/IncomeService';

interface IncomePayload {
  income: IncomeWithUser[];
  summary: IncomeSummary;
}

const EMPTY: IncomeWithUser[] = [];

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === 'string' && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/** Income for one month (yyyy-MM). Mirrors useExpenses: cached, and refreshed on cacheCleared. */
export function useIncome(month: string) {
  const fetcher = useCallback(async (): Promise<IncomePayload> => {
    const response = await fetch(`/api/income?month=${month}`);
    if (!response.ok) throw new Error(await readError(response, 'Failed to load income'));
    return response.json();
  }, [month]);

  const { data, loading, refresh } = useCachedFetch<IncomePayload>(`income-${month}`, fetcher, {
    ttl: 5 * 60 * 1000,
    revalidate: true,
  });

  useEffect(() => {
    window.addEventListener('cacheCleared', refresh);
    return () => window.removeEventListener('cacheCleared', refresh);
  }, [refresh]);

  const mutate = useCallback(
    async (method: 'POST' | 'PUT' | 'DELETE', body?: Partial<Income>, id?: string) => {
      const url = method === 'DELETE' ? `/api/income?id=${id}` : '/api/income';
      const response = await fetch(url, {
        method,
        ...(method === 'DELETE' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Failed to save income'));
      // Madal shows what an alert became, so its rows go stale too.
      invalidateCachePattern('income-');
      invalidateCachePattern('inbox-');
      await refresh();
      return method === 'DELETE' ? null : ((await response.json()) as Income);
    },
    [refresh]
  );

  return {
    income: data?.income ?? EMPTY,
    summary: data?.summary ?? null,
    loading,
    refresh,
    create: (body: Partial<Income>) => mutate('POST', body),
    update: (id: string, body: Partial<Income>) => mutate('PUT', { id, ...body } as Partial<Income>),
    remove: (id: string) => mutate('DELETE', undefined, id),
  };
}
