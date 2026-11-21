import { useCallback, useEffect } from 'react';
import { invalidateCachePattern, useCachedFetch } from '../useClientCache';
import type { CashFlowReport, Commitment, CommitmentPayment } from '@/types';

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === 'string' && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/** The cash-flow report for [from, to] (yyyy-MM). Cached, and refreshed on cacheCleared. */
export function useCashFlow(from: string, to: string) {
  const fetcher = useCallback(async (): Promise<CashFlowReport> => {
    const response = await fetch(`/api/cash-flow?from=${from}&to=${to}`);
    if (!response.ok) throw new Error(await readError(response, 'Failed to load the cash flow'));
    return response.json();
  }, [from, to]);

  const { data, loading, refresh } = useCachedFetch<CashFlowReport>(`cash-flow-${from}-${to}`, fetcher, {
    ttl: 5 * 60 * 1000,
    revalidate: true,
  });

  useEffect(() => {
    window.addEventListener('cacheCleared', refresh);
    return () => window.removeEventListener('cacheCleared', refresh);
  }, [refresh]);

  return { report: data ?? null, loading, refresh };
}

interface CommitmentsPayload {
  commitments: Commitment[];
  payments: CommitmentPayment[];
}

/** Commitments (migration 037) and their recent payments, with the writes behind /cash-flow/commitments. */
export function useCommitments() {
  const fetcher = useCallback(async (): Promise<CommitmentsPayload> => {
    const response = await fetch('/api/commitments');
    if (!response.ok) throw new Error(await readError(response, 'Failed to load commitments'));
    return response.json();
  }, []);

  const { data, loading, refresh } = useCachedFetch<CommitmentsPayload>('commitments', fetcher, {
    ttl: 5 * 60 * 1000,
    revalidate: true,
  });

  useEffect(() => {
    window.addEventListener('cacheCleared', refresh);
    return () => window.removeEventListener('cacheCleared', refresh);
  }, [refresh]);

  const send = useCallback(
    async (url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => {
      const response = await fetch(url, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Failed to save'));
      // Every cash-flow view counts commitments.
      invalidateCachePattern('cash-flow-');
      await refresh();
    },
    [refresh]
  );

  return {
    commitments: data?.commitments ?? [],
    payments: data?.payments ?? [],
    loading,
    create: (body: Partial<Commitment>) => send('/api/commitments', 'POST', body),
    update: (id: string, body: Partial<Commitment>) => send('/api/commitments', 'PUT', { id, ...body }),
    remove: (id: string) => send(`/api/commitments?id=${id}`, 'DELETE'),
    markPaid: (body: { commitment_id: string; due_month: string; paid_date: string; amount: number; covers_through?: string | null }) =>
      send('/api/commitments/payments', 'POST', body),
    unmarkPaid: (paymentId: string) => send(`/api/commitments/payments?id=${paymentId}`, 'DELETE'),
  };
}
