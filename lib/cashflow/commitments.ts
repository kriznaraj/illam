import { monthKeys } from '@/lib/utils/dateUtils';
import type { Commitment, CommitmentDueStatus, CommitmentFrequency, CommitmentKind, CommitmentPayment } from '@/types';

/**
 * Commitments — insurance premiums, loan EMIs. Declared once, the way a SIP
 * is, and never expenses: a premium is what the household signed up to pay, not what it
 * chose to spend that month. Pure.
 *
 * A due month with evidence (a statement line, card line or alert containing `match_text`)
 * is *paid*, at the amount that left. One whose due date has passed with none is *assumed*
 * — counted at the declared amount, like a virtual SIP instalment — because the evidence
 * comes from statements, and the month's statement arrives after the month. One not yet due
 * is *upcoming* and counted nowhere.
 *
 * A premium paid ahead (three years of a yearly policy at once, for a discount) is one payment
 * whose `covers_through` reaches the later due months: they are *paid*, at ₹0 — the whole
 * advance left in the month it was paid, which is what a cash flow shows.
 */

export const COMMITMENT_KINDS: readonly CommitmentKind[] = ['insurance', 'loan', 'other'];
export const COMMITMENT_KIND_LABEL: Record<CommitmentKind, string> = {
  insurance: 'Insurance',
  loan: 'Loan EMI',
  other: 'Other',
};

export const FREQUENCY_MONTHS: Record<CommitmentFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
};

export const FREQUENCY_LABEL: Record<CommitmentFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  annual: 'Yearly',
};

/** How far from its due date a debit may land and still be that instalment: a premium due on the 28th posts on the 2nd. */
export const PAYMENT_WINDOW_DAYS = 20;

/** A match fragment shorter than this would match half the statement ("lic" is in "public"). */
export const MIN_MATCH_LENGTH = 4;

const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

const DAY_MS = 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

export function isDueIn(commitment: Pick<Commitment, 'start_month' | 'end_month' | 'frequency'>, month: string): boolean {
  if (!monthKeys.isValid(month) || month < commitment.start_month) return false;
  if (commitment.end_month && month > commitment.end_month) return false;
  return monthsBetween(commitment.start_month, month) % FREQUENCY_MONTHS[commitment.frequency] === 0;
}

/** Every month in [from, to] the commitment falls due. */
export function dueMonths(commitment: Pick<Commitment, 'start_month' | 'end_month' | 'frequency'>, from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = monthKeys.shift(month, 1)) {
    if (isDueIn(commitment, month)) months.push(month);
  }
  return months;
}

/** yyyy-MM-dd it falls due in `month`; a due day past the month's end is its last day. */
export function dueDate(commitment: Pick<Commitment, 'due_day'>, month: string): string {
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(commitment.due_day, 1), last)).padStart(2, '0')}`;
}

/** Case, spaces and punctuation ignored: statements wrap narrations mid-word ("Towar ds"). */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchesText(commitment: Pick<Commitment, 'match_text'>, text: string): boolean {
  const needle = squash(commitment.match_text ?? '');
  return needle.length >= MIN_MATCH_LENGTH && squash(text).includes(needle);
}

/** The due month a payment dated `date` settles: the nearest due date within the window. */
export function dueMonthFor(commitment: Commitment, date: string): string | null {
  const month = date.slice(0, 7);
  const candidates = [monthKeys.shift(month, -1), month, monthKeys.shift(month, 1)]
    .filter((m) => isDueIn(commitment, m))
    .map((m) => ({ month: m, days: daysApart(dueDate(commitment, m), date) }))
    .filter((c) => c.days <= PAYMENT_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);
  return candidates[0]?.month ?? null;
}

export interface CommitmentMatch {
  commitment: Commitment;
  dueMonth: string;
}

/**
 * The active commitment a debit pays, if any: its text names the payee and its date falls
 * near a due date. Two commitments to one payee (two Tata AIA policies) are told apart by
 * amount, then by the nearer due date.
 */
export function findCommitment(
  commitments: readonly Commitment[],
  debit: { text: string; date: string; amount: number }
): CommitmentMatch | null {
  const cents = (value: number) => Math.round(value * 100);
  const options = commitments
    .filter((c) => c.active && matchesText(c, debit.text))
    .map((commitment) => {
      const dueMonth = dueMonthFor(commitment, debit.date);
      return dueMonth
        ? {
            commitment,
            dueMonth,
            exact: cents(Number(commitment.amount)) === cents(debit.amount),
            days: daysApart(dueDate(commitment, dueMonth), debit.date),
          }
        : null;
    })
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.days - b.days);
  return options[0] ? { commitment: options[0].commitment, dueMonth: options[0].dueMonth } : null;
}

export interface DueInstalment {
  commitment: Commitment;
  month: string;
  dueDate: string;
  status: CommitmentDueStatus;
  /** What it counts for: the amount paid, the declared amount when assumed, 0 when upcoming or covered. */
  amount: number;
  payment: CommitmentPayment | null;
  /** Settled by an advance paid for an earlier due month (`payment` is that advance). */
  covered: boolean;
}

/** Every instalment due in [from, to], with what is known of it as of `today`. */
export function instalments(
  commitments: readonly Commitment[],
  payments: readonly CommitmentPayment[],
  from: string,
  to: string,
  today: string
): DueInstalment[] {
  const paid = new Map(payments.map((p) => [`${p.commitment_id}|${p.due_month}`, p]));
  const advanceFor = (commitmentId: string, month: string) =>
    payments.find((p) => p.commitment_id === commitmentId && p.covers_through && p.due_month < month && month <= p.covers_through) ?? null;
  return commitments.flatMap((commitment) =>
    dueMonths(commitment, from, to).map((month): DueInstalment => {
      const due = dueDate(commitment, month);
      const own = paid.get(`${commitment.id}|${month}`) ?? null;
      const advance = own ? null : advanceFor(commitment.id, month);
      if (advance) return { commitment, month, dueDate: due, status: 'paid', amount: 0, payment: advance, covered: true };
      // A stopped commitment keeps the instalments it paid and asks nothing more.
      if (!own && !commitment.active) return { commitment, month, dueDate: due, status: 'upcoming', amount: 0, payment: null, covered: false };
      const status: CommitmentDueStatus = own ? 'paid' : due <= today ? 'assumed' : 'upcoming';
      const amount = own ? Number(own.amount) : status === 'assumed' ? Number(commitment.amount) : 0;
      return { commitment, month, dueDate: due, status, amount, payment: own, covered: false };
    })
  ).filter((i) => i.commitment.active || i.payment);
}
