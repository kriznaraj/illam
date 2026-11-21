import { differenceInCalendarDays } from 'date-fns';
import { parseAppDate } from '@/lib/utils/dateUtils';
import { redact, truncate } from '@/lib/inbox/text';
import type { InboxConsumed } from '@/types';

/**
 * Matching card-statement lines to expenses and alerts. Pure; the writes live in
 * StatementReconcileService.
 *
 * A statement dates a line by posting, which runs a day or two behind the spend
 * and the alert, so the window is a day wider than alert matching's.
 */
export const STATEMENT_MATCH_WINDOW_DAYS = 3;

export interface ReconcileExpense {
  id: string;
  date: string;
  amount: number;
  user_id: string;
  created_at: string;
  inbox_item_id: string | null;
  merchant: string | null;
  payment_method: string | null;
  description: string;
  source: string | null;
  needs_review: boolean;
}

export interface LineAlert {
  id: string;
  date: string;
  amount: number;
  /**
   * true: same bank and card last 4 (or a card alert printing none) · false: another bank,
   * card or account · null: same bank, no last 4, not a card alert (HDFC UPI alerts often
   * print none) — could be this card or an account, so neither preferred nor excluded.
   */
  ofThisCard: boolean | null;
  linkedExpenseId: string | null;
  consumedAction: InboxConsumed['action'] | null;
}

/**
 * "UPI/APOLLO PHARMACY/APOLLOPHARMACYTNPL@Y" → "APOLLO PHARMACY",
 * "UPI-Sample Food Court" → "Sample Food Court". Other descriptions are kept,
 * less any UPI handle or card digits.
 */
export function statementMerchant(description: string): string {
  let text = description.trim();
  const upi = text.match(/^UPI[/-](.+)$/i);
  if (upi) text = upi[1].split('/')[0];
  text = text
    .replace(/\S+@\S*/g, '')
    .replace(/[•*]{2}\d+/g, '')
    .replace(/\d{8,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(text || redact(description.trim()), 60);
}

/** The line as stored: long digit runs masked and UPI handles dropped (the table is anon-readable). */
export function statementDescription(description: string): string {
  // Handles first: masking digits inside one ("Q12341111@YBL") would leave half of it behind.
  return truncate(
    redact(description.replace(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]*/g, '[upi]'))
      .replace(/\s+/g, ' ')
      .trim(),
    120
  );
}

const daysApart = (a: string, b: string) => Math.abs(differenceInCalendarDays(parseAppDate(a), parseAppDate(b)));

/**
 * The expense a statement debit describes: same amount, within the window, not
 * already claimed by another line. An expense tied to an alert from a different
 * card or account is that other payment, never this one; one tied to this card's
 * alert is preferred, then the closest date.
 */
export function matchStatementLine(
  line: { date: string; amount: number },
  expenses: readonly ReconcileExpense[],
  options: { claimed: ReadonlySet<string>; alertOfThisCard: ReadonlyMap<string, boolean> }
): ReconcileExpense | null {
  const tiedHere = (e: ReconcileExpense) => (e.inbox_item_id ? options.alertOfThisCard.get(e.inbox_item_id) === true : false);

  const eligible = expenses
    .filter((e) => !options.claimed.has(e.id))
    .filter((e) => !e.inbox_item_id || options.alertOfThisCard.get(e.inbox_item_id) !== false)
    .filter((e) => Math.abs(Number(e.amount) - line.amount) < 0.005)
    .map((e) => ({ e, days: daysApart(e.date, line.date) }))
    .filter(({ days }) => days <= STATEMENT_MATCH_WINDOW_DAYS);

  eligible.sort(
    (a, b) =>
      Number(tiedHere(b.e)) - Number(tiedHere(a.e)) || a.days - b.days || a.e.created_at.localeCompare(b.e.created_at)
  );
  return eligible[0]?.e ?? null;
}

/** This card's alert for a line that no expense describes: same amount, within the window, unclaimed. */
export function findLineAlert(
  line: { date: string; amount: number },
  alerts: readonly LineAlert[],
  claimed: ReadonlySet<string>
): LineAlert | null {
  const eligible = alerts
    .filter((a) => a.ofThisCard === true && a.linkedExpenseId === null && !claimed.has(a.id))
    .filter((a) => Math.abs(a.amount - line.amount) < 0.005)
    .map((a) => ({ a, days: daysApart(a.date, line.date) }))
    .filter(({ days }) => days <= STATEMENT_MATCH_WINDOW_DAYS);
  eligible.sort((x, y) => x.days - y.days);
  return eligible[0]?.a ?? null;
}
