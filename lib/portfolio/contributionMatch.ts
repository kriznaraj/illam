import { differenceInCalendarDays } from 'date-fns';
import { parseAppDate } from '@/lib/utils/dateUtils';
import { findSipInstalments, type SipScheduledFund } from './sipMatch';

/**
 * What a bank debit into an investment account may already be on record as — so confirming it
 * links that record instead of adding a second one.
 *
 * Three shapes of existing record:
 * - a contribution typed in by hand. Amounts drift (24,990 entered for 24,900) and dates follow
 *   the platform's credit, not the bank debit, so the match is ±5 days and ₹100 or 1%;
 * - an auto-monthly row (`note = '__AUTO_MONTHLY__'`, materialised one per month);
 * - a virtual SIP instalment, which is never stored: it is claimed on the transfer instead.
 * Pure: the service loads rows, funds and claims; everything decided here is tested.
 */

export const AUTO_MONTHLY_NOTE = '__AUTO_MONTHLY__';
export const MANUAL_MATCH_DAYS = 5;

/** ₹100 or 1%, whichever is larger. */
export const amountTolerance = (amount: number) => Math.max(100, Math.abs(amount) * 0.01);

export interface ContributionRow {
  id: string;
  investment_date: string;
  amount: number;
  note: string | null;
  /** Set once a transfer created or claimed the row (migration 034, or transfers.portfolio_investment_id). */
  transfer_id: string | null;
}

export type SipFund = SipScheduledFund;

export type ContributionCandidate =
  | { kind: 'manual'; rowId: string; date: string; amount: number; note: string | null; daysApart: number }
  | { kind: 'auto_monthly'; rowId: string; date: string; amount: number }
  | { kind: 'sip'; fund: string; month: string; amount: number };

/** What a person picks on the review sheet, sent with the confirm. */
export type ContributionLink =
  | { kind: 'manual' | 'auto_monthly'; row_id: string }
  | { kind: 'sip'; fund: string; month: string };

export const sipClaimKey = (fund: string, month: string) => `${fund}|${month}`;

const daysBetween = (a: string, b: string) => Math.abs(differenceInCalendarDays(parseAppDate(a), parseAppDate(b)));

export function shiftAppDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthEndDate(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

export function findContributionCandidates(params: {
  /** The transfer's date and amount (negative for a redemption). */
  date: string;
  amount: number;
  /** Contributions on the chosen account around the date. */
  rows: readonly ContributionRow[];
  funds: readonly SipFund[];
  /** `fund|month` keys other transfers already claimed. */
  claimedSips: ReadonlySet<string>;
}): ContributionCandidate[] {
  const { date, amount, rows, funds, claimedSips } = params;
  const month = date.slice(0, 7);
  const tolerance = amountTolerance(amount);

  const manual: ContributionCandidate[] = rows
    .filter(
      (row) =>
        row.note !== AUTO_MONTHLY_NOTE &&
        !row.transfer_id &&
        Math.sign(row.amount) === Math.sign(amount) &&
        Math.abs(row.amount - amount) <= tolerance &&
        daysBetween(row.investment_date, date) <= MANUAL_MATCH_DAYS
    )
    .map((row) => ({
      kind: 'manual' as const,
      rowId: row.id,
      date: row.investment_date,
      amount: row.amount,
      note: row.note,
      daysApart: daysBetween(row.investment_date, date),
    }))
    .sort((a, b) => a.daysApart - b.daysApart);

  // Auto-monthly rows and SIPs are money going in; a redemption only ever matches a hand entry.
  const autoMonthly: ContributionCandidate[] =
    amount > 0
      ? rows
          .filter((row) => row.note === AUTO_MONTHLY_NOTE && !row.transfer_id && row.investment_date.slice(0, 7) === month && Math.abs(row.amount - amount) <= 1)
          .map((row) => ({ kind: 'auto_monthly' as const, rowId: row.id, date: row.investment_date, amount: row.amount }))
      : [];

  /*
   * Read off the schedule's own due dates rather than the month the bank stamped on the
   * debit — `findSipInstalments` looks at the neighbouring months too, because a mandate
   * due on the 30th posts on the 2nd. The caller must widen `claimedSips` to the same
   * months, or an instalment already taken could be offered twice.
   */
  const sips: ContributionCandidate[] = findSipInstalments({ date, amount, funds, claimedSips }).map((hit) => ({
    kind: 'sip' as const,
    fund: hit.fund,
    month: hit.month,
    amount: hit.amount,
  }));

  return [...manual, ...autoMonthly, ...sips];
}

/** Preselected on the sheet only when unambiguous; two candidates wait for a person. */
export function preselectCandidate(candidates: readonly ContributionCandidate[]): ContributionCandidate | null {
  return candidates.length === 1 ? candidates[0] : null;
}

export function candidateMatchesLink(candidate: ContributionCandidate, link: ContributionLink): boolean {
  if (candidate.kind === 'sip' || link.kind === 'sip') {
    return candidate.kind === 'sip' && link.kind === 'sip' && candidate.fund === link.fund && candidate.month === link.month;
  }
  return candidate.kind === link.kind && candidate.rowId === link.row_id;
}

/**
 * The confirmed investment transfer a hand entry would duplicate — the reverse direction: a
 * deposit already recorded from its bank debit, then typed in again on /portfolio/investments.
 */
export function findMatchingTransfer<T extends { date: string; amount: number }>(date: string, amount: number, transfers: readonly T[]): T | null {
  const tolerance = amountTolerance(amount);
  return (
    transfers
      .filter((t) => Math.sign(t.amount) === Math.sign(amount) && Math.abs(Math.abs(t.amount) - Math.abs(amount)) <= tolerance && daysBetween(t.date, date) <= MANUAL_MATCH_DAYS)
      .sort((a, b) => daysBetween(a.date, date) - daysBetween(b.date, date))[0] ?? null
  );
}
