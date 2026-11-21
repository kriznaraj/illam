import { differenceInCalendarDays } from 'date-fns';
import { parseAppDate } from '@/lib/utils/dateUtils';

/**
 * Finding the hand-entered expense an alert describes.
 *
 * Same amount to the paisa, dated within two days either side: people log a
 * spend when they remember, and banks date an alert by settlement, so exact-day
 * matching missed a third of the pairs in the first sync. Candidates come from
 * *both* users — a spend on one member's card is often logged by the other.
 */

export const MATCH_WINDOW_DAYS = 2;

export interface ExpenseCandidate {
  id: string;
  date: string;
  amount: number;
  user_id: string;
  created_at: string;
  inbox_item_id: string | null;
}

export function findExpenseMatch(
  txn: { amount: number; txnDate: string },
  candidates: readonly ExpenseCandidate[],
  options: { preferredUserId?: string | null; claimed?: ReadonlySet<string> } = {}
): ExpenseCandidate | null {
  const txnDay = parseAppDate(txn.txnDate);

  const eligible = candidates
    .filter((c) => c.inbox_item_id === null && !options.claimed?.has(c.id))
    .filter((c) => Math.abs(Number(c.amount) - txn.amount) < 0.005)
    .map((c) => ({ c, days: Math.abs(differenceInCalendarDays(parseAppDate(c.date), txnDay)) }))
    .filter(({ days }) => days <= MATCH_WINDOW_DAYS);

  eligible.sort((a, b) => {
    const aPreferred = a.c.user_id === options.preferredUserId ? 0 : 1;
    const bPreferred = b.c.user_id === options.preferredUserId ? 0 : 1;
    return aPreferred - bPreferred || a.days - b.days || a.c.created_at.localeCompare(b.c.created_at);
  });

  return eligible[0]?.c ?? null;
}
