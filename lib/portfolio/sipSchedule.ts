import { INVESTMENT_START_MONTH } from './constants';

/**
 * Effective-dated SIP amounts.
 *
 * A SIP row on /portfolio/investments is virtual — it is synthesised for the
 * month being viewed rather than stored. Built from the fund's single
 * `sip_amount` alone, raising a SIP from ₹3,000 to ₹5,000 would rewrite every
 * past month too.
 *
 * `amount_history` records when each amount took effect. It is optional: a fund
 * without one has a flat `sip_amount` across all months.
 *
 * Invariants when `amount_history` is present:
 *   - it is a complete timeline: the first entry covers everything from the
 *     start of the fund, so no month resolves to "unknown"
 *   - it is sorted ascending by `from_month`, with one entry per month
 *   - `sip_amount` mirrors the amount in effect *today*, so existing "current
 *     monthly SIP" totals keep working without knowing about the history
 */
export interface SipAmountChange {
  /** Month the amount took effect, `YYYY-MM`, inclusive. */
  from_month: string;
  amount: number;
}

export interface SipFundSchedule {
  sip_amount?: number;
  amount_history?: SipAmountChange[];
}

/** Month `YYYY-MM` strings sort lexicographically, so plain compares work. */
const isMonthKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const toAmount = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The history entries that are usable: well-formed month, positive amount,
 * sorted ascending, one per month (a later duplicate wins).
 */
export function normalizeAmountHistory(history: unknown): SipAmountChange[] {
  if (!Array.isArray(history)) return [];

  const byMonth = new Map<string, number>();
  for (const row of history) {
    if (!row || typeof row !== 'object') continue;
    const { from_month, amount } = row as Partial<SipAmountChange>;
    if (!isMonthKey(from_month)) continue;
    const value = toAmount(amount);
    if (value <= 0) continue;
    byMonth.set(from_month, value);
  }

  return Array.from(byMonth.entries())
    .map(([from_month, amount]) => ({ from_month, amount }))
    .sort((a, b) => a.from_month.localeCompare(b.from_month));
}

/**
 * What this fund contributed in `month`.
 *
 * With no history this is just `sip_amount` — the pre-existing behaviour. With
 * a history it is the amount from the most recent change at or before `month`,
 * and **zero before the first entry**: the first entry marks when the fund
 * started running, so a SIP added today does not back-fill months it never ran
 * in. `applySipAmountChange` seeds that first entry at INVESTMENT_START_MONTH
 * for a fund that was already running, so existing history is preserved.
 */
export function resolveSipAmount(fund: SipFundSchedule | null | undefined, month: string): number {
  if (!fund) return 0;

  const history = normalizeAmountHistory(fund.amount_history);
  if (history.length === 0) return toAmount(fund.sip_amount);
  if (!isMonthKey(month)) return toAmount(fund.sip_amount);

  let applicable: SipAmountChange | null = null;
  for (const entry of history) {
    if (entry.from_month <= month) applicable = entry;
    else break;
  }

  return applicable ? applicable.amount : 0;
}

/**
 * Change the amount from `fromMonth` onwards, leaving earlier months alone.
 *
 * If the fund has no history yet, the amount it has been running at is first
 * pinned from `INVESTMENT_START_MONTH` so past months keep their value; the new
 * amount is then layered on top.
 */
export function applySipAmountChange<T extends SipFundSchedule>(
  fund: T,
  change: { amount: number; fromMonth: string; currentMonth: string }
): T & SipFundSchedule {
  const { amount, fromMonth, currentMonth } = change;
  const nextAmount = toAmount(amount);
  if (nextAmount <= 0 || !isMonthKey(fromMonth)) return fund;

  const existing = normalizeAmountHistory(fund.amount_history);
  const previousAmount = toAmount(fund.sip_amount);

  const seeded =
    existing.length > 0
      ? existing
      : previousAmount > 0
        ? [{ from_month: INVESTMENT_START_MONTH, amount: previousAmount }]
        : [];

  // A change effective before the seeded start would leave the seed stranded
  // ahead of it, so drop any entry at or after the new effective month.
  const kept = seeded.filter((entry) => entry.from_month < fromMonth);
  const history = normalizeAmountHistory([...kept, { from_month: fromMonth, amount: nextAmount }]);

  const next = { ...fund, amount_history: history } as T & SipFundSchedule;
  next.sip_amount = resolveSipAmount(next, currentMonth);
  return next;
}

/**
 * Treat the amount as a correction rather than a change: apply it to every
 * month and discard the history. This is the old behaviour, kept deliberately
 * for fixing a figure that was simply entered wrong.
 */
export function applySipAmountCorrection<T extends SipFundSchedule>(
  fund: T,
  amount: number
): T & SipFundSchedule {
  const next = { ...fund } as T & SipFundSchedule;
  next.sip_amount = toAmount(amount);
  delete next.amount_history;
  return next;
}

/**
 * The month this fund started running — the first entry in its timeline, since
 * `resolveSipAmount` returns 0 before it. `null` means no history, i.e. the
 * fund is treated as having always run at its flat `sip_amount`.
 */
export function getSipStartMonth(fund: SipFundSchedule | null | undefined): string | null {
  const history = normalizeAmountHistory(fund?.amount_history);
  return history.length > 0 ? history[0].from_month : null;
}

/**
 * Declare when the fund started, so months before it show nothing.
 *
 * The amount running at `startMonth` is carried onto the new first entry, and
 * any later change is preserved untouched — moving the start date must not
 * disturb a raise recorded after it. Entries before `startMonth` are dropped:
 * that is the point, those months never ran.
 */
export function setSipStartMonth<T extends SipFundSchedule>(
  fund: T,
  params: { startMonth: string; currentMonth: string }
): T & SipFundSchedule {
  const { startMonth, currentMonth } = params;
  if (!isMonthKey(startMonth)) return fund;

  const existing = normalizeAmountHistory(fund.amount_history);

  // Before the first entry `resolveSipAmount` is 0 by design, so when the new
  // start predates the timeline fall back to its oldest known amount.
  const resolved = resolveSipAmount({ ...fund, amount_history: existing }, startMonth);
  const amountAtStart = resolved > 0 ? resolved : (existing[0]?.amount ?? toAmount(fund.sip_amount));

  const later = existing.filter((entry) => entry.from_month > startMonth);
  const history = normalizeAmountHistory([
    { from_month: startMonth, amount: amountAtStart },
    ...later,
  ]);

  const next = { ...fund, amount_history: history } as T & SipFundSchedule;
  next.sip_amount = resolveSipAmount(next, currentMonth);
  return next;
}

/** Human-readable timeline, newest first, for showing under the fund. */
export function describeAmountHistory(fund: SipFundSchedule): SipAmountChange[] {
  return normalizeAmountHistory(fund.amount_history).slice().reverse();
}
