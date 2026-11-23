import type { InboxItem, InboxTransactionData } from '@/types';

/**
 * Banks sometimes send one alert twice, as two Gmail messages seconds apart (ICICI and
 * HDFC both do). Acting on both adds the spend twice.
 */
export const DUPLICATE_ALERT_WINDOW_MS = 120_000;

/**
 * The earlier copy of this alert, if it is a copy: same owner, sender, amount,
 * direction, outcome, card and merchant, within two minutes. Ties go to the lower
 * Gmail id, so exactly one of a pair is acted on.
 */
export function findTwinAlert(item: InboxItem, alerts: readonly InboxItem[]): InboxItem | null {
  const data = item.data as InboxTransactionData;
  const at = Date.parse(item.received_at);

  return (
    alerts.find((other) => {
      if (other.id === item.id || other.owner !== item.owner || other.source !== item.source) return false;
      const o = other.data as InboxTransactionData;
      if (o.kind !== 'transaction' || o.amount !== data.amount || o.direction !== data.direction) return false;
      if (o.outcome !== data.outcome || (o.last4 ?? null) !== (data.last4 ?? null)) return false;
      if ((o.merchant ?? null) !== (data.merchant ?? null)) return false;
      const otherAt = Date.parse(other.received_at);
      if (Math.abs(otherAt - at) > DUPLICATE_ALERT_WINDOW_MS) return false;
      return otherAt < at || (otherAt === at && other.gmail_message_id < item.gmail_message_id);
    }) ?? null
  );
}
