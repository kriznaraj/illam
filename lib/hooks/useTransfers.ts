import { useCallback, useEffect } from 'react';
import { invalidateCachePattern, useCachedFetch } from '../useClientCache';
import { transfersApi } from '../inbox/client';
import type { Transfer, TransferStatus } from '@/types';
import type { TransferDecision } from '@/lib/services/TransferService';

const EMPTY: Transfer[] = [];

/** Transfers logged from bank alerts. Defaults to the ones waiting to be classified. */
export function useTransfers(status: TransferStatus = 'needs_review') {
  const fetcher = useCallback(() => transfersApi.list(status), [status]);
  // Shares the inbox- prefix so a status change in Madal invalidates both.
  const { data, loading, refresh } = useCachedFetch<Transfer[]>(`inbox-transfers-${status}`, fetcher, {
    ttl: 5 * 60 * 1000,
    revalidate: true,
  });

  useEffect(() => {
    window.addEventListener('cacheCleared', refresh);
    return () => window.removeEventListener('cacheCleared', refresh);
  }, [refresh]);

  const confirm = async (id: string, decision: TransferDecision) => {
    const result = await transfersApi.confirm(id, decision);
    invalidateCachePattern('inbox-');
    await refresh();
    return result;
  };

  return { transfers: data ?? EMPTY, loading, refresh, confirm };
}
