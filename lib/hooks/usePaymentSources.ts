'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { buildCardIndex, type CardIndex, type PaymentSourceCard } from '@/lib/expenses/paymentSource';
import { useCachedFetch } from '@/lib/useClientCache';

const EMPTY: CardIndex = new Map();

/**
 * The household's cards as `last4 → { name, color }`, so an expense row can say
 * "HDFC Swiggy CC" rather than "HDFC Bank card ••1909" and every card gets its own colour.
 *
 * Cached for an hour: cards are added once or twice a year, and a stale name is a cosmetic
 * miss, not a wrong number. Everything degrades cleanly to an empty index — `parsePaymentSource`
 * then falls back to the issuer and a hashed colour, which is exactly what it did before
 * Selvam was consulted at all.
 */
export function usePaymentSources(): { cards: CardIndex; loading: boolean } {
  const fetcher = useCallback(async (): Promise<PaymentSourceCard[]> => {
    const res = await fetch('/api/expenses/payment-sources');
    if (!res.ok) throw new Error('Failed to load payment sources');
    const body = (await res.json()) as { cards?: PaymentSourceCard[] };
    return body.cards ?? [];
  }, []);

  const { data, loading } = useCachedFetch<PaymentSourceCard[]>('payment-sources', fetcher, {
    ttl: 60 * 60 * 1000,
    revalidate: false,
  });

  /*
   * Rebuilt from the server's order rather than trusting the colours it sent, so the one
   * implementation of "which card is which colour" is the pure function both sides call.
   */
  const cards = useMemo(() => (data && data.length > 0 ? buildCardIndex(data) : EMPTY), [data]);

  return { cards, loading };
}
