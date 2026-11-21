import { INBOX_SOURCES } from './sources';
import type { InboxOwner } from '@/types';

/**
 * Statements that keep Selvam current, and when one is late. A month's CAS, HDFC
 * account statements and NPS statement can all fail to reach Madal with nothing
 * saying so — the snapshots page just stays empty. A statement that stops arriving
 * is as much a gap as an account with no source at all, so it is surfaced.
 *
 * The rhythm is learnt from history, not declared: each (owner, source) pair's
 * usual gap is the median between its past arrivals, so a weekly INDmoney statement
 * and a monthly CAS need no configuration, and a new source joins once it has a
 * history. A monthly statement keeps a day of the month rather than a gap (the CAS
 * came on the 9th, 8th and 10th — gaps of 30 and 33), so it is expected on its usual
 * day the following month. Pure.
 */

/** Sources whose statements set Selvam balances (or will, once a reader exists). */
export const SELVAM_STATEMENT_SOURCES: readonly string[] = [
  'cdsl_cas',
  'nsdl_cas',
  'nps_protean',
  'hdfc_account_statement',
  'kotak_account_statement',
  'sbi_account_statement',
  'hdfc_card_statement',
  'axis_card_statement',
  'icici_card_statement',
  'icici_cards',
  'bob_card_statement',
  'indmoney',
  'zerodha',
];

/** Bank account statements are stored as notices; everything else arrives as a statement kind. */
const ACCOUNT_STATEMENT_SOURCES: ReadonlySet<string> = new Set([
  'hdfc_account_statement',
  'kotak_account_statement',
  'sbi_account_statement',
]);

/**
 * Whether an item is one of the statements themselves — not an INDmoney deposit
 * notice or tax report, which carry PDFs too, nor an ICICI alert from the address
 * that also sends statements.
 */
export function isStatementArrival(source: string, kind: string): boolean {
  return kind === 'card_statement' || kind === 'investment_statement' || ACCOUNT_STATEMENT_SOURCES.has(source);
}

/** Days past the expected day before a statement counts as late. */
export const LATE_GRACE_DAYS = 2;
/** A usual gap in this range is a monthly statement, expected by day of month. */
const MONTHLY_GAP = { min: 25, max: 35 };
/** The next monthly statement is at least this long after the last one. */
const MIN_MONTHLY_GAP = 20;
/** Arrivals needed before a rhythm is trusted. */
const MIN_ARRIVALS = 3;

export interface StatementArrival {
  owner: InboxOwner;
  source: string;
  /** yyyy-MM-dd, app timezone */
  date: string;
}

export interface LateStatement {
  owner: InboxOwner;
  source: string;
  institution: string;
  lastReceived: string;
  /** The day it would have arrived on its usual rhythm. */
  expectedBy: string;
  usualGapDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const fromDayNumber = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function findLateStatements(arrivals: readonly StatementArrival[], today: string): LateStatement[] {
  const byPair = new Map<string, { owner: InboxOwner; source: string; days: Set<number> }>();
  for (const arrival of arrivals) {
    const key = `${arrival.owner}:${arrival.source}`;
    const entry = byPair.get(key) ?? { owner: arrival.owner, source: arrival.source, days: new Set<number>() };
    // Two cards' statements on one day are one arrival for the rhythm.
    entry.days.add(dayNumber(arrival.date));
    byPair.set(key, entry);
  }

  const todayNumber = dayNumber(today);
  const late: LateStatement[] = [];
  for (const { owner, source, days } of Array.from(byPair.values())) {
    const sorted = Array.from(days).sort((a, b) => a - b);
    if (sorted.length < MIN_ARRIVALS) continue;
    const gaps = sorted.slice(1).map((day, i) => day - sorted[i]);
    const usualGapDays = median(gaps);
    const last = sorted[sorted.length - 1];
    const monthly = usualGapDays >= MONTHLY_GAP.min && usualGapDays <= MONTHLY_GAP.max;
    const expected = monthly
      ? nextDayOfMonth(last + MIN_MONTHLY_GAP, median(sorted.map((day) => Number(fromDayNumber(day).slice(8, 10)))))
      : last + usualGapDays;
    if (todayNumber <= expected + LATE_GRACE_DAYS) continue;
    late.push({
      owner,
      source,
      institution: INBOX_SOURCES.find((s) => s.id === source)?.institution ?? source,
      lastReceived: fromDayNumber(last),
      expectedBy: fromDayNumber(expected),
      usualGapDays,
    });
  }
  return late.sort((a, b) => a.expectedBy.localeCompare(b.expectedBy));
}

/** The first date on or after `from` that falls on `day` of its month (or the month's last day). */
function nextDayOfMonth(from: number, day: number): number {
  const start = new Date(from * DAY_MS);
  for (let offset = 0; offset < 2; offset++) {
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth() + offset;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const candidate = Math.round(Date.UTC(year, month, Math.min(day, lastDay)) / DAY_MS);
    if (candidate >= from) return candidate;
  }
  return from;
}

const STATEMENT_NAMES: Readonly<Record<string, string>> = {
  cdsl_cas: 'CAS',
  nsdl_cas: 'CAS',
  nps_protean: 'NPS statement',
  hdfc_account_statement: 'account statement',
  kotak_account_statement: 'account statement',
  sbi_account_statement: 'account statement',
  zerodha: 'statement',
  indmoney: 'weekly statement',
};

/** "CDSL CAS", "HDFC Bank account statement", "Axis Bank card statement". */
export function statementLabel(late: Pick<LateStatement, 'source' | 'institution'>): string {
  const name = STATEMENT_NAMES[late.source] ?? 'card statement';
  return `${late.institution} ${name}`;
}
