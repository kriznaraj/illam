import type { InboxTransactionData } from '@/types';
import { APP_TIMEZONE, toAppTimezoneDate } from '@/lib/utils/dateUtils';

export type SpendTime = { spent_time: string; spent_time_approx: boolean };

/** HH:mm:ss of an instant, in Asia/Kolkata. */
function appTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/**
 * When a spend happened, for the expense row.
 *
 * The time the bank printed, when it printed one (card alerts do). Otherwise the alert's arrival,
 * marked approximate: UPI alerts print no time but arrive within seconds of the debit. Only
 * when the alert arrived on the spend's own date — a re-sent or delayed alert says nothing about
 * the time of day, and a wrong time is worse than none.
 */
export function spendTime(data: Pick<InboxTransactionData, 'txnDate' | 'txnTime'>, receivedAt: string): SpendTime | null {
  if (data.txnTime) return { spent_time: data.txnTime, spent_time_approx: false };
  const arrived = new Date(receivedAt);
  if (Number.isNaN(arrived.getTime())) return null;
  if (data.txnDate && toAppTimezoneDate(arrived) !== data.txnDate) return null;
  return { spent_time: appTime(arrived), spent_time_approx: true };
}
