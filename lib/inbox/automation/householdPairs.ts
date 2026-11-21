import type { Transfer, TransferKind } from '@/types';

/**
 * Money that left one of the household's accounts and arrived in the other person's, seen
 * from both ends. Neither alert names the other side — HDFC and Kotak NEFT alerts carry no
 * payee — but a debit from one owner and a credit to the other, for the same amount within
 * a day, is the same money (for example, ₹40,000 out of one member's HDFC account and
 * ₹40,000 into the other's Kotak account). Both halves are a household transfer; neither
 * is spending or earning.
 *
 * Only kinds that are still a question pair up — a debit already read as an investment or a
 * card bill is not a household transfer just because a same-sized credit appeared. Each
 * transfer pairs at most once, nearest date first, so two identical debits and one credit
 * leave one debit waiting. Pure.
 */

/** How far apart the two halves may be dated: an evening NEFT credits the next morning. */
export const PAIR_MAX_DAYS = 1;

const PAIRABLE_KINDS: ReadonlySet<TransferKind> = new Set(['other', 'own_account', 'family']);

export interface HouseholdPair {
  debit: Transfer;
  credit: Transfer;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
const pairable = (t: Transfer) => t.status === 'needs_review' && PAIRABLE_KINDS.has(t.kind);

export function findHouseholdPairs(transfers: readonly Transfer[]): HouseholdPair[] {
  const debits = transfers.filter((t) => pairable(t) && t.direction === 'debit');
  const credits = transfers.filter((t) => pairable(t) && t.direction === 'credit');

  const options = debits
    .flatMap((debit) =>
      credits
        .filter((credit) => credit.owner !== debit.owner && Math.round(Number(credit.amount) * 100) === Math.round(Number(debit.amount) * 100))
        .map((credit) => ({ debit, credit, days: daysApart(debit.date, credit.date) }))
        .filter((option) => option.days <= PAIR_MAX_DAYS)
    )
    .sort((a, b) => a.days - b.days || a.debit.created_at.localeCompare(b.debit.created_at));

  const used = new Set<string>();
  const pairs: HouseholdPair[] = [];
  for (const option of options) {
    if (used.has(option.debit.id) || used.has(option.credit.id)) continue;
    used.add(option.debit.id);
    used.add(option.credit.id);
    pairs.push({ debit: option.debit, credit: option.credit });
  }
  return pairs;
}
