import { formatters, monthKeys } from '@/lib/utils/dateUtils';
import { INCOME_KIND_LABEL } from '@/lib/services/IncomeService';
import type { DueInstalment } from './commitments';
import type { CashFlowLine, CashFlowMonth, CashFlowReport, CashFlowSection, Income, Transfer } from '@/types';

/**
 * The cash-flow statement behind /cash-flow: money in against every kind of money out.
 * Pure — the service fetches, this decides what counts, once.
 *
 * Counted, each from exactly one place:
 *  - in: `income` (INR; another currency is listed, never added), credits a person filed in
 *    Madal as `other`, EPF/NPS paid through payroll, and money taken back out of investments
 *    (a negative contribution — a redemption is money arriving, not negative investing);
 *  - spending: every expense, by planning group — card spends included, so card *bills* are not;
 *  - commitments: each instalment due (paid, or assumed once its due date passes), and any
 *    confirmed `loan` transfer no commitment claimed;
 *  - investments: contributions as Selvam records them — entered rows, auto-monthly rows and
 *    virtual SIP instalments — so `investment` transfers are not;
 *  - tax and other outflows: confirmed transfers of those kinds no commitment claimed.
 * Not counted: card bills (the spends are), household transfers between the two of us and
 * own-account moves (no money left), cash withdrawn (what it bought is, when logged), and
 * transfers still waiting in Madal (reported as a gap — a guess would be worse).
 *
 * Payroll: take-home salary already has EPF and the employer NPS taken out, but Selvam records
 * them as contributions. Adding them to money in as well keeps the saving honest instead of
 * subtracting them twice.
 */

export interface CashFlowExpense {
  date: string;
  amount: number;
  category: string | null;
  /** categories.group_name: Need | Want | One-time | Unplanned. */
  group: string | null;
}

export interface CashFlowContribution {
  month: string;
  accountId: string;
  accountName: string;
  amount: number;
  /** entered: a portfolio_investments row · payroll: an auto-monthly row (EPF, NPS) · sip: a virtual instalment. */
  via: 'entered' | 'payroll' | 'sip';
  /** Negative for a withdrawal or redemption ("Fund closed", "Kite Ledger Withdrawal"). */
}

export interface CashFlowInput {
  from: string;
  to: string;
  income: readonly Pick<Income, 'date' | 'amount' | 'currency' | 'kind' | 'needs_review'>[];
  expenses: readonly CashFlowExpense[];
  instalments: readonly DueInstalment[];
  upcoming: readonly DueInstalment[];
  contributions: readonly CashFlowContribution[];
  transfers: readonly Transfer[];
  /** Transfers a commitment payment claimed. */
  claimedTransferIds: ReadonlySet<string>;
  /** The current month, yyyy-MM; earlier months are closed. */
  currentMonth: string;
}

const GROUP_ORDER = ['Need', 'Want', 'Unplanned', 'One-time'] as const;
const GROUP_LABEL: Record<string, string> = {
  Need: 'Needs',
  Want: 'Wants',
  Unplanned: 'Unplanned',
  'One-time': 'One-time',
};

const round = (value: number) => Math.round(value * 100) / 100;
const sum = (values: readonly number[]) => round(values.reduce((total, v) => total + v, 0));
const monthOf = (date: string) => date.slice(0, 7);
const inr = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

function listMonths(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = monthKeys.shift(month, 1)) months.push(month);
  return months;
}

function topCategories(rows: readonly CashFlowExpense[]): string {
  const byCategory = new Map<string, number>();
  for (const row of rows) byCategory.set(row.category ?? 'Uncategorised', (byCategory.get(row.category ?? 'Uncategorised') ?? 0) + row.amount);
  return [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, amount]) => `${name} ${inr(amount)}`)
    .join(' · ');
}

function instalmentDetail(rows: readonly DueInstalment[]): string {
  if (rows.length === 1) {
    const [only] = rows;
    if (only.covered) return `Covered by the advance paid ${formatters.toFullDate(only.payment?.paid_date ?? only.dueDate)}`;
    if (only.status === 'paid') return `Paid ${formatters.toFullDate(only.payment?.paid_date ?? only.dueDate)}`;
    if (only.status === 'assumed') return `Due ${formatters.toFullDate(only.dueDate)} · not seen on a statement yet`;
    return `Due ${formatters.toFullDate(only.dueDate)}`;
  }
  const covered = rows.filter((r) => r.covered).length;
  const paid = rows.filter((r) => r.status === 'paid').length - covered;
  const assumed = rows.filter((r) => r.status === 'assumed').length;
  return [
    paid + assumed > 0 ? `${paid} of ${paid + assumed} seen paid` : null,
    covered > 0 ? `${covered} covered by an advance` : null,
    assumed > 0 ? `${assumed} assumed at the declared amount` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function buildCashFlow(input: CashFlowInput): CashFlowReport {
  const months = listMonths(input.from, input.to);
  const inRange = (date: string) => monthOf(date) >= input.from && monthOf(date) <= input.to;

  // ---- Money in ----
  const income = input.income.filter((row) => !row.needs_review && inRange(row.date));
  const inrIncome = income.filter((row) => (row.currency || 'INR') === 'INR');
  const foreign = new Map<string, number>();
  for (const row of income) {
    if ((row.currency || 'INR') !== 'INR') foreign.set(row.currency, (foreign.get(row.currency) ?? 0) + Number(row.amount));
  }

  const confirmed = input.transfers.filter((t) => t.status === 'confirmed' && inRange(t.date) && !input.claimedTransferIds.has(t.id));
  const otherCredits = confirmed.filter((t) => t.direction === 'credit' && t.kind === 'other');
  const inRangeContributions = input.contributions.filter((c) => c.month >= input.from && c.month <= input.to);
  const payroll = inRangeContributions.filter((c) => c.via === 'payroll' && c.amount > 0);
  const withdrawals = inRangeContributions.filter((c) => c.amount < 0);
  const contributions = inRangeContributions.filter((c) => c.amount > 0);

  const inLines: CashFlowLine[] = [];
  const kinds = Array.from(new Set(inrIncome.map((row) => row.kind)));
  for (const kind of kinds) {
    const rows = inrIncome.filter((row) => row.kind === kind);
    inLines.push({
      key: `income:${kind}`,
      label: INCOME_KIND_LABEL[kind],
      amount: sum(rows.map((row) => Number(row.amount))),
      detail: `${rows.length} credit${rows.length === 1 ? '' : 's'}`,
    });
  }
  if (payroll.length > 0) {
    const accounts = Array.from(new Set(payroll.map((c) => c.accountName)));
    inLines.push({
      key: 'payroll',
      label: 'Through payroll',
      amount: sum(payroll.map((c) => c.amount)),
      detail: `${accounts.join(' & ')} — taken out before salary reaches the bank`,
    });
  }
  if (withdrawals.length > 0) {
    const accounts = Array.from(new Set(withdrawals.map((c) => c.accountName)));
    inLines.push({
      key: 'withdrawals',
      label: 'Taken out of investments',
      amount: sum(withdrawals.map((c) => -c.amount)),
      detail: accounts.join(' · '),
    });
  }
  if (otherCredits.length > 0) {
    inLines.push({
      key: 'other-credits',
      label: 'Other money received',
      amount: sum(otherCredits.map((t) => Number(t.amount))),
      detail: otherCredits.map((t) => t.note || t.counterparty).filter(Boolean).slice(0, 2).join(' · ') || null,
    });
  }
  inLines.sort((a, b) => b.amount - a.amount);

  // ---- Money out ----
  const expenses = input.expenses.filter((row) => inRange(row.date));
  const spendingLines: CashFlowLine[] = [];
  const groups = [...GROUP_ORDER, ...Array.from(new Set(expenses.map((e) => e.group ?? 'Other'))).filter((g) => !GROUP_ORDER.includes(g as never))];
  for (const group of groups) {
    const rows = expenses.filter((e) => (e.group ?? 'Other') === group);
    if (rows.length === 0) continue;
    spendingLines.push({ key: `group:${group}`, label: GROUP_LABEL[group] ?? group, amount: sum(rows.map((r) => r.amount)), detail: topCategories(rows) });
  }

  const commitmentLines: CashFlowLine[] = [];
  const counted = input.instalments.filter((i) => i.status !== 'upcoming');
  for (const id of Array.from(new Set(counted.map((i) => i.commitment.id)))) {
    const rows = counted.filter((i) => i.commitment.id === id);
    const { commitment } = rows[0];
    commitmentLines.push({
      key: `commitment:${id}`,
      label: commitment.name,
      amount: sum(rows.map((r) => r.amount)),
      detail: instalmentDetail(rows),
      status: rows.some((r) => r.status === 'assumed') ? 'assumed' : 'paid',
      date: rows.length === 1 && !rows[0].covered ? (rows[0].payment?.paid_date ?? rows[0].dueDate) : null,
    });
  }
  const loanTransfers = confirmed.filter((t) => t.direction === 'debit' && t.kind === 'loan');
  if (loanTransfers.length > 0) {
    commitmentLines.push({
      key: 'loan-transfers',
      label: 'Loan payments not declared',
      amount: sum(loanTransfers.map((t) => Number(t.amount))),
      detail: 'Filed as loan in Madal — declare the loan to see it by name',
    });
  }

  const investmentLines: CashFlowLine[] = [];
  for (const accountId of Array.from(new Set(contributions.map((c) => c.accountId)))) {
    const rows = contributions.filter((c) => c.accountId === accountId);
    const via = Array.from(new Set(rows.map((r) => r.via)));
    investmentLines.push({
      key: `investment:${accountId}`,
      label: rows[0].accountName,
      amount: sum(rows.map((r) => r.amount)),
      detail: via.map((v) => ({ entered: 'recorded', payroll: 'through payroll', sip: 'SIP' })[v]).join(' · '),
    });
  }

  const taxLines: CashFlowLine[] = confirmed
    .filter((t) => t.direction === 'debit' && t.kind === 'tax')
    .map((t) => ({ key: `transfer:${t.id}`, label: t.counterparty || 'Tax payment', amount: Number(t.amount), date: t.date, detail: t.note }));

  const otherLines: CashFlowLine[] = confirmed
    .filter((t) => t.direction === 'debit' && t.kind === 'other')
    .map((t) => ({ key: `transfer:${t.id}`, label: t.note || t.counterparty || 'Payment', amount: Number(t.amount), date: t.date, detail: t.counterparty && t.note ? t.counterparty : null }));

  const byAmount = (a: CashFlowLine, b: CashFlowLine) => b.amount - a.amount;
  const section = (key: CashFlowSection['key'], label: string, lines: CashFlowLine[], sort = true): CashFlowSection => ({
    key,
    label,
    total: sum(lines.map((l) => l.amount)),
    lines: sort ? [...lines].sort(byAmount) : lines,
  });
  const sections = [
    section('spending', 'Spending', spendingLines, false),
    section('commitments', 'Insurance & EMIs', commitmentLines),
    section('investments', 'Investments', investmentLines),
    section('tax', 'Tax', taxLines),
    section('other', 'Other payments', otherLines),
  ].filter((s) => s.lines.length > 0);

  const moneyIn = sum(inLines.map((l) => l.amount));
  const moneyOut = sum(sections.map((s) => s.total));
  const net = round(moneyIn - moneyOut);

  // ---- Per month: the same rules, month by month ----
  const monthly: CashFlowMonth[] = months.map((month) => {
    const at = (date: string) => monthOf(date) === month;
    const monthIn =
      sum(inrIncome.filter((r) => at(r.date)).map((r) => Number(r.amount))) +
      sum(payroll.filter((c) => c.month === month).map((c) => c.amount)) +
      sum(withdrawals.filter((c) => c.month === month).map((c) => -c.amount)) +
      sum(otherCredits.filter((t) => at(t.date)).map((t) => Number(t.amount)));
    const monthOut =
      sum(expenses.filter((e) => at(e.date)).map((e) => e.amount)) +
      sum(counted.filter((i) => i.month === month).map((i) => i.amount)) +
      sum(contributions.filter((c) => c.month === month).map((c) => c.amount)) +
      sum(
        confirmed
          .filter((t) => t.direction === 'debit' && at(t.date) && (t.kind === 'loan' || t.kind === 'tax' || t.kind === 'other'))
          .map((t) => Number(t.amount))
      );
    return { month, moneyIn: round(monthIn), moneyOut: round(monthOut), net: round(monthIn - monthOut) };
  });

  // ---- What the totals cannot see ----
  const waiting = input.transfers.filter((t) => t.status === 'needs_review' && inRange(t.date));
  const salaryMonths = new Set(inrIncome.filter((r) => r.kind === 'salary').map((r) => monthOf(r.date)));

  return {
    from: input.from,
    to: input.to,
    months,
    moneyIn: {
      total: moneyIn,
      lines: inLines,
      foreign: [...foreign.entries()].map(([currency, amount]) => ({ currency, amount: round(amount) })),
    },
    moneyOut: { total: moneyOut, sections },
    net,
    savingsRate: moneyIn > 0 ? round(net / moneyIn) : null,
    monthly,
    upcoming: input.upcoming
      .filter((i) => i.status === 'upcoming')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((i) => ({
        key: `upcoming:${i.commitment.id}:${i.month}`,
        label: i.commitment.name,
        amount: Number(i.commitment.amount),
        date: i.dueDate,
        status: 'upcoming' as const,
      })),
    gaps: {
      waitingTransfers: {
        count: waiting.length,
        debit: sum(waiting.filter((t) => t.direction === 'debit').map((t) => Number(t.amount))),
        credit: sum(waiting.filter((t) => t.direction === 'credit').map((t) => Number(t.amount))),
      },
      monthsWithoutSalary: months.filter((m) => m < input.currentMonth && !salaryMonths.has(m)),
      cashWithdrawn: sum(confirmed.filter((t) => t.direction === 'debit' && t.kind === 'cash').map((t) => Number(t.amount))),
    },
  };
}
