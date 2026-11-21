import type { InboxTransactionData } from '@/types';

/**
 * Who the household's members are, and which of their accounts each statement maps to, is
 * deployment configuration: see lib/household.ts (`ILLAM_HOUSEHOLD`). This module keeps only
 * what is safe to import from client components.
 */

const INSTRUMENT_LABEL = { card: 'card', account: 'account', upi: 'UPI' } as const;

/** "HDFC Bank UPI ••1234" — how an expense records the way it was paid. */
export function paymentMethodLabel(data: Pick<InboxTransactionData, 'bank' | 'instrument' | 'last4'>): string {
  return [data.bank, data.instrument ? INSTRUMENT_LABEL[data.instrument] : null, data.last4 ? `••${data.last4}` : null]
    .filter(Boolean)
    .join(' ');
}
