import { differenceInDays } from 'date-fns';
import type { InboxItem, InboxKind, InboxOwner } from '@/types';
import { describePaymentSource, parsePaymentSource, type CardIndex } from '@/lib/expenses/paymentSource';
import { paymentMethodLabel } from '@/lib/inbox/automation/owners';
import { cleanPayee } from '@/lib/inbox/payee';
import { formatters, getTodayAppDate, parseAppDate, toAppTimezoneDate } from '@/lib/utils/dateUtils';

export const KIND_META: Record<InboxKind, { icon: string; label: string }> = {
  transaction: { icon: '💳', label: 'Transaction' },
  card_statement: { icon: '🧾', label: 'Card statement' },
  investment_statement: { icon: '📈', label: 'Investment statement' },
  trade: { icon: '🔁', label: 'Trade' },
  notice: { icon: '📣', label: 'Notice' },
};

/** A member's slug as a label: "alice" → "Alice". The full name comes from `/api/household`. */
export const ownerLabel = (owner: InboxOwner): string =>
  owner ? owner.charAt(0).toUpperCase() + owner.slice(1).replace(/_/g, ' ') : '';

export type UrgencyTone = 'danger' | 'warning' | 'info';

/** "Overdue by 2 days" / "Due today" / "Due in 3 days" — computed at read time, never stored. */
export function describeActionBy(
  actionBy: string | null,
  today: string = getTodayAppDate()
): { label: string; tone: UrgencyTone } | null {
  if (!actionBy) return null;
  const days = differenceInDays(parseAppDate(actionBy), parseAppDate(today));
  if (days < 0) {
    const overdue = -days;
    return { label: `Overdue by ${overdue} day${overdue === 1 ? '' : 's'}`, tone: 'danger' };
  }
  if (days === 0) return { label: 'Due today', tone: 'danger' };
  if (days <= 3) return { label: `Due in ${days} day${days === 1 ? '' : 's'}`, tone: 'warning' };
  return { label: `Due ${formatters.toFullDate(actionBy)}`, tone: 'info' };
}

/**
 * How a row names itself.
 *
 * The stored `title` of a transaction is its payee, and a large share of transaction alerts
 * have none — they read "Payment" or "Money received", which is a column of identical
 * rows told apart only by the amount. The item knows more than that: which bank, which
 * instrument, which card. A card such as `••1515` (an HDFC RuPay card) may be the most-used
 * method in the data, and naming it is more use than naming nothing.
 *
 * So the headline falls through payee → card → nothing, and the method line is dropped
 * when the headline has already said it. The payee goes through `cleanPayee` rather than
 * being trusted, because rows written before extractor v5 stored a footer sentence there
 * and no re-read has happened.
 */
export interface ItemIdentity {
  /** The row's headline: the payee, else how it was paid, else a plain fallback. */
  headline: string;
  /** How it was paid, when the headline is not already saying it. */
  method: string | null;
  /** The card's colour, for the row's leading tile. Null when no card is involved. */
  color: string | null;
  /** True when nothing names this item but the way it was paid. */
  anonymous: boolean;
}

export function itemIdentity(item: InboxItem, cards?: CardIndex): ItemIdentity {
  const { data } = item;

  if (data.kind === 'transaction') {
    const source = parsePaymentSource(paymentMethodLabel(data), cards);
    const payee = cleanPayee(data.merchant);

    /*
     * Beside a payee, `describePaymentSource` is right to drop the instrument — "HDFC Swiggy
     * CC ••1909" is the card, and how it was tapped is noise. Standing *as* the headline it
     * is not: 56 HDFC UPI debits carry neither payee nor digits, and "HDFC" alone names a
     * bank the household holds seven cards and two accounts at. "HDFC UPI" at least says
     * which rail the money left by.
     */
    const asHeadline = source
      ? [
          source.cardName ?? source.issuer.replace(/\s+bank$/i, ''),
          source.cardName ? null : source.instrument,
          source.last4 ? `••${source.last4}` : null,
        ]
          .filter(Boolean)
          .join(' ')
      : null;

    return {
      headline: payee ?? asHeadline ?? (data.direction === 'credit' ? 'Money received' : 'Payment'),
      method: payee && source ? describePaymentSource(source) : null,
      color: source?.color ?? null,
      anonymous: payee === null,
    };
  }

  // A card statement names its card; every other kind's title is a real subject line.
  const last4 = data.kind === 'card_statement' ? data.last4 : null;
  const card = last4 ? cards?.get(last4) : undefined;
  return {
    headline: item.title,
    method: card ? `${card.name} \u2022\u2022${last4}` : null,
    color: card?.color ?? null,
    anonymous: false,
  };
}

/**
 * Whether a row is still waiting on a person, and what to call the state.
 *
 * `open` is the whole point of the view: automation acts on an alert once, so anything it
 * could not finish sits here until someone answers it. `settled` says what was done and
 * needs no emphasis; `muted` is an alert deliberately left out of the books.
 */
export type StateTone = 'open' | 'settled' | 'muted';

export function itemState(item: InboxItem, hasPendingTransfer: boolean): { label: string; tone: StateTone } | null {
  switch (item.consumed?.action) {
    case 'linked':
      return { label: 'Linked to expense', tone: 'settled' };
    case 'created':
      return { label: 'Added to Selavu', tone: 'settled' };
    case 'card_bill':
      return { label: 'Card bill paid', tone: 'settled' };
    case 'transfer':
      return hasPendingTransfer
        ? { label: 'Needs classifying', tone: 'open' }
        : { label: 'Transfer logged', tone: 'settled' };
    case 'income':
      return { label: 'Recorded as income', tone: 'settled' };
    case 'statement_recorded':
      return { label: item.kind === 'investment_statement' ? 'Updated in Selvam' : 'Recorded in Cards', tone: 'settled' };
    case 'statement_unread':
      return { label: 'Statement not read', tone: 'open' };
    case 'history_unmatched':
      return { label: 'Before the cut-off', tone: 'muted' };
    case 'ignored':
      return { label: 'Set aside', tone: 'muted' };
    default:
      return null;
  }
}

/**
 * Which decision an item is waiting on, for grouping the To-do view.
 *
 * The queue is grouped by the question being asked, not by the day the mail arrived: a
 * large tax debit from months ago and a small decline from this morning are different jobs,
 * and sorting them together by date buries the first one behind months of the second.
 */
export type TodoGroup = 'transfer' | 'bill' | 'statement' | 'alert';

export const TODO_GROUP_LABEL: Record<TodoGroup, string> = {
  transfer: 'Transfers to classify',
  bill: 'Card bills',
  statement: 'Statements',
  alert: 'Alerts to look at',
};

/** The order the queue is worked in: money decisions first, then bills, then reading. */
export const TODO_GROUP_ORDER: readonly TodoGroup[] = ['transfer', 'bill', 'statement', 'alert'];

export function todoGroup(item: InboxItem, hasPendingTransfer: boolean): TodoGroup {
  if (hasPendingTransfer) return 'transfer';
  if (item.kind === 'card_statement') return 'bill';
  if (item.kind === 'investment_statement' || item.consumed?.action === 'statement_unread') return 'statement';
  return 'alert';
}

/** The headline amount for a row, if the item has one. */
export function itemAmount(item: InboxItem): { amount: number; currency: string; tone: 'debit' | 'credit' | 'neutral' } | null {
  const { data } = item;
  switch (data.kind) {
    case 'transaction':
      return { amount: data.amount, currency: data.currency, tone: data.direction };
    case 'card_statement':
      return data.totalDue !== null ? { amount: data.totalDue, currency: 'INR', tone: 'neutral' } : null;
    case 'investment_statement':
    case 'notice':
      return data.amount !== null ? { amount: data.amount, currency: 'INR', tone: 'neutral' } : null;
    case 'trade': {
      const value = data.amount ?? (data.price !== null && data.quantity !== null ? data.price * data.quantity : null);
      return value !== null ? { amount: value, currency: data.currency, tone: 'neutral' } : null;
    }
  }
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-IN')}`;
  }
}

/**
 * Opens the original message in the right Gmail account.
 *
 * The account goes in `?authuser=`, not the `/mail/u/<account>/` path: encoding
 * the address for a path turns `@` into `%40`, which Gmail reads as an unknown
 * signed-in account and answers with "Temporary Error (404) — your account is
 * temporarily unavailable". In a query string that encoding is correct.
 */
export function gmailLink(mailbox: string, messageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${encodeURIComponent(messageId)}`;
}

/** "Today" / "Yesterday" / "12 Sep 2026", in the app timezone. */
export function dayGroupLabel(receivedAt: string, today: string = getTodayAppDate()): string {
  const day = toAppTimezoneDate(new Date(receivedAt));
  const diff = differenceInDays(parseAppDate(today), parseAppDate(day));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return formatters.toFullDate(day);
}
