import { differenceInDays } from 'date-fns';
import type { InboxData } from '@/types';
import { getTodayAppDate, parseAppDate } from '@/lib/utils/dateUtils';

/**
 * Whether an inbox item needs someone to look at it. Deterministic, so the
 * inbox works with no AI key.
 *
 * Only *fresh* mail is flagged. The Apps Script backfills 90 days on first run;
 * without the freshness gate that backfill would bury the inbox under three
 * months of "large debit" flags nobody can act on. The exception is a card
 * bill: it stays flagged until its due date has been past for a week, however
 * old the email is.
 */

export const LARGE_DEBIT_THRESHOLD = 10_000;
export const FRESH_DAYS = 7;
export const OVERDUE_GRACE_DAYS = 7;

export interface AttentionResult {
  needsAttention: boolean;
  reason: string | null;
  /** Date the action is due by, when there is one (yyyy-MM-dd). */
  actionBy: string | null;
}

const NONE: AttentionResult = { needsAttention: false, reason: null, actionBy: null };

const flag = (reason: string, actionBy: string | null = null): AttentionResult => ({
  needsAttention: true,
  reason,
  actionBy,
});

export function evaluateAttention(
  data: InboxData,
  receivedDate: string,
  today: string = getTodayAppDate()
): AttentionResult {
  const ageDays = differenceInDays(parseAppDate(today), parseAppDate(receivedDate));
  const fresh = ageDays <= FRESH_DAYS;

  switch (data.kind) {
    case 'card_statement': {
      if (data.dueDate) {
        const daysPastDue = differenceInDays(parseAppDate(today), parseAppDate(data.dueDate));
        return daysPastDue <= OVERDUE_GRACE_DAYS ? flag('Card bill due', data.dueDate) : NONE;
      }
      return fresh ? flag('New card statement') : NONE;
    }

    case 'transaction': {
      if (!fresh) return NONE;
      if (data.outcome === 'declined') return flag('Transaction declined');
      if (data.international) return flag('International transaction');
      if (data.direction === 'debit' && data.currency === 'INR' && data.amount >= LARGE_DEBIT_THRESHOLD) {
        return flag('Large debit');
      }
      return NONE;
    }

    case 'investment_statement':
      return fresh ? flag('New statement to review') : NONE;

    case 'notice':
      return fresh && data.keywords.length > 0 ? flag(data.keywords.join(', ')) : NONE;

    case 'trade':
      return NONE;
  }
}
