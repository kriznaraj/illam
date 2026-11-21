/**
 * Which investment account a transfer most likely went to, from the ones already confirmed.
 * A suggestion only — it prefills the review sheet and is never applied on its own.
 *
 * 1. The last confirmed investment to the same payee: if a transfer to "ALICE" went to a
 *    US-stocks account before, the next one probably does too.
 * 2. Otherwise one paid the same way for a similar amount (within 1%), but only when every such
 *    transfer went to the same account — if ₹20,000 has gone to both a chit fund and a
 *    brokerage wallet, a guess between them is worse than a blank.
 */

export interface InvestmentTransferRef {
  id: string;
  date: string;
  amount: number;
  counterparty: string | null;
  payment_method: string | null;
  account_id: string | null;
}

export interface AccountSuggestion {
  accountId: string;
  reason: string;
}

const inr = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

export function suggestAccount(
  target: Pick<InvestmentTransferRef, 'id' | 'amount' | 'counterparty' | 'payment_method'>,
  confirmed: readonly InvestmentTransferRef[]
): AccountSuggestion | null {
  const history = confirmed
    .filter((t) => t.id !== target.id && t.account_id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const payee = target.counterparty?.trim().toLowerCase();
  if (payee) {
    const samePayee = history.find((t) => t.counterparty?.trim().toLowerCase() === payee);
    if (samePayee) {
      return { accountId: samePayee.account_id as string, reason: `the last payment to ${target.counterparty} (${samePayee.date}) went there` };
    }
  }

  if (target.payment_method) {
    const similar = history.filter(
      (t) => t.payment_method === target.payment_method && Math.abs(t.amount - target.amount) <= Math.abs(target.amount) * 0.01
    );
    if (similar.length > 0 && new Set(similar.map((t) => t.account_id)).size === 1) {
      return { accountId: similar[0].account_id as string, reason: `like ${inr(similar[0].amount)} on ${similar[0].date}` };
    }
  }
  return null;
}
