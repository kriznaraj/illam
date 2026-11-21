import { differenceInCalendarDays } from 'date-fns';
import type { IncomeKind, InboxOwner, InboxTransactionData, TransactionRule, TransferKind } from '@/types';
import { parseAppDate } from '@/lib/utils/dateUtils';
import { paymentMethodLabel } from './owners';
import { otherMembers, payeeNames } from '@/lib/household';

/**
 * What a transaction alert *is*: spending, a transfer to log, a card bill, or
 * nothing to act on. Pure and deterministic — no AI.
 *
 * The rules come from real-world alerts, where most unmatched debits turn out
 * not to be spending: "INDmoney Credit Card Repayment" and "Indmoney1" pay card
 * bills, FINZOOM and self-transfers fund US stocks, "CBDT TIN" is income tax,
 * "HDFC ATM" is cash, and large NEFT/IMPS account debits have no merchant at
 * all. Every ad-hoc transfer is reviewed, so heuristics only ever *suggest* a
 * transfer kind.
 */

export const LARGE_UNMATCHED_DEBIT = 10_000;
export const CARD_BILL_WINDOW_DAYS = 45;
/** How far a hand-entered payment date may sit from the bank's alert date. */
export const PAYMENT_DATE_TOLERANCE_DAYS = 3;

export interface StatementRef {
  id: string;
  account_id: string;
  statement_date: string;
  statement_amount: number;
  amount_paid: number;
  payment_date: string | null;
}

export interface ClassifyContext {
  owner: InboxOwner;
  rules: readonly TransactionRule[];
  /** Recent card statements, paid or not. */
  statements: readonly StatementRef[];
  /** Whether a hand-entered expense matches this alert (see match.ts). */
  hasExpenseMatch: boolean;
}

export type Classification =
  | {
      kind: 'ignore';
      reason: 'declined' | 'credit' | 'foreign_currency' | 'rule' | 'card_payment_received';
    }
  /** `alreadyPaid`: the statement was marked paid by hand, so only link it. */
  | { kind: 'card_bill'; statementId: string; alreadyPaid: boolean }
  | { kind: 'transfer'; suggestedKind: TransferKind; reason: string; accountId: string | null; ruleId: string | null }
  | { kind: 'expense'; categoryId: string | null; ruleId: string | null }
  /** Money earned, and the mail said so — recorded without review (migration 035). */
  | { kind: 'income'; incomeKind: IncomeKind; sourceName: string | null; reason: string };

/**
 * Payees that say "this is a card bill". "PZ HDFC CC BILLPAY UPI" is HDFC's own bill-pay
 * handle: a small bill paid through it can settle by amount alone, while a larger one the
 * same day waits as a "Large payment" if its statement was already marked paid by hand,
 * which needs the payee to vouch for it — so the payee has to count.
 */
export const CARD_BILL_PAYEE = /credit\s*card\s*(?:re)?payment|card\s*bill|\bcc\s*bill\s*pay|\bindmoney1\b|\bcred\b|billdesk/i;
/**
 * Apps that pay card bills on your behalf. FINZOOM is INDmoney's company, and it is
 * ambiguous: several FINZOOM debits on one day can be exactly that month's card
 * statements, not US-stock funding. So a statement that matches outranks the payee's
 * investment reading below.
 */
const BILL_PAY_PLATFORM = /finzoom|indmoney|\bcred\b|billdesk/i;
export const INVESTMENT_PAYEE =
  /indmoney|finzoom|zerodha|groww|upstox|kuvera|\biccl\b|indian\s+clearing|bse\s*star|mf\s*utilit|\bcams\b|kfin|protean|\bnps\b|nsdl/i;
export const TAX_PAYEE = /\bcbdt\b|income\s*tax|\btin\s*\d/i;
export const ATM_PAYEE = /\batm\b|cash\s+withdrawal/i;

/**
 * Paise drift between what the bank debited and what a statement or a person recorded:
 * for example, ₹1,234.48 settling a ₹1,234.50 card statement. Allowed only for a card-bill
 * payee, where the payee already says what the money was for.
 */
export const BILL_AMOUNT_TOLERANCE_RUPEES = 1;

const amountMatches = (a: number, b: number, billPayee: boolean) =>
  Math.abs(a - b) <= (billPayee ? BILL_AMOUNT_TOLERANCE_RUPEES : 0.005);

function namesIn(counterparty: string, names: readonly string[]): boolean {
  return names.some((name) => new RegExp(`\\b${name}\\b`, 'i').test(counterparty));
}

function matchRule(
  rules: readonly TransactionRule[],
  owner: InboxOwner,
  counterparty: string,
  paymentMethod: string
): TransactionRule | null {
  const payee = counterparty.toLowerCase();
  const method = paymentMethod.toLowerCase();
  return (
    rules.find(
      (rule) =>
        (rule.owner === null || rule.owner === owner) &&
        rule.match_counterparty.length > 0 &&
        payee.includes(rule.match_counterparty.toLowerCase()) &&
        (!rule.match_payment_method || method.includes(rule.match_payment_method.toLowerCase()))
    ) ?? null
  );
}

/**
 * The statement a payment settles.
 *
 * Unpaid: the amount equals what is still owed, paid within 45 days of the
 * statement. Already paid by hand — common for statements recorded before the
 * first sync — the amount equals what was recorded as paid, on a payment date
 * within a few days of the alert; that second case also needs a card-bill payee,
 * because a same-sized grocery bill on the same day would otherwise qualify.
 */
function findStatement(
  data: InboxTransactionData,
  statements: readonly StatementRef[]
): { statement: StatementRef; alreadyPaid: boolean } | null {
  if (!data.txnDate) return null;
  const paidOn = parseAppDate(data.txnDate);
  const payee = data.merchant ?? '';
  const billPayee = CARD_BILL_PAYEE.test(payee) || BILL_PAY_PLATFORM.test(payee);
  const cycleDays = (s: StatementRef) => differenceInCalendarDays(paidOn, parseAppDate(s.statement_date));

  const unpaid = statements
    .filter((s) => s.statement_amount - s.amount_paid > 0.005 && amountMatches(s.statement_amount - s.amount_paid, data.amount, billPayee))
    .map((s) => ({ s, days: cycleDays(s) }))
    .filter(({ days }) => days >= 0 && days <= CARD_BILL_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);
  if (unpaid[0]) return { statement: unpaid[0].s, alreadyPaid: false };

  if (!billPayee) return null;
  // Marked paid by hand. A recorded payment date close to the alert is trusted. One
  // *after* it is a bulk "marked paid on" date — Axis can show one later date for bills
  // actually paid in earlier months — so the statement's cycle stands in for it. One well
  // *before* the alert is an earlier, different payment and never matches.
  const paid = statements
    .filter((s) => s.payment_date && amountMatches(s.amount_paid, data.amount, true))
    .map((s) => {
      const recordedAfter = differenceInCalendarDays(parseAppDate(s.payment_date as string), paidOn);
      if (Math.abs(recordedAfter) <= PAYMENT_DATE_TOLERANCE_DAYS) return { s, rank: Math.abs(recordedAfter) };
      const days = cycleDays(s);
      const inCycle = recordedAfter > PAYMENT_DATE_TOLERANCE_DAYS && days >= 0 && days <= CARD_BILL_WINDOW_DAYS;
      // Ranked behind every date match; among cycle matches the most recent statement wins.
      return inCycle ? { s, rank: PAYMENT_DATE_TOLERANCE_DAYS + 1 + days } : null;
    })
    .filter((match): match is { s: StatementRef; rank: number } => match !== null)
    .sort((a, b) => a.rank - b.rank);
  return paid[0] ? { statement: paid[0].s, alreadyPaid: true } : null;
}

const transfer = (
  suggestedKind: TransferKind,
  reason: string,
  accountId: string | null = null,
  ruleId: string | null = null
): Classification => ({ kind: 'transfer', suggestedKind, reason, accountId, ruleId });

/**
 * Money arriving (migration 035). Before this every credit was dropped on the floor, so
 * INDmoney dividends were never recorded and neither was anything else that came in.
 *
 * Credits are not one thing, which is why only a dividend is booked outright: many credits
 * are the household's own card-bill payments landing back on the card, or card refunds.
 * Booking those as earnings would count money that was
 * already counted going out. Everything that is not certain becomes a transfer to classify in
 * Madal, the same way an ambiguous debit does.
 */
function classifyCredit(data: InboxTransactionData, ctx: ClassifyContext): Classification {
  // Said outright by the mail; no guessing involved.
  if (data.purpose === 'dividend') {
    return { kind: 'income', incomeKind: 'dividend', sourceName: data.merchant, reason: 'Dividend' };
  }

  // A credit landing on a credit card for exactly what a statement was paid is that payment
  // arriving, not income — the card-bill debit that sent it is already on record.
  if (data.instrument === 'card' && findStatement(data, ctx.statements)) {
    return { kind: 'ignore', reason: 'card_payment_received' };
  }

  return transfer('other', 'Money received · classify it');
}

export function classifyTransaction(data: InboxTransactionData, ctx: ClassifyContext): Classification {
  if (data.outcome === 'declined') return { kind: 'ignore', reason: 'declined' };
  if (data.direction === 'credit') return classifyCredit(data, ctx);
  // A foreign-currency spend has no reliable rupee amount to record.
  if (data.currency !== 'INR') return { kind: 'ignore', reason: 'foreign_currency' };

  const counterparty = data.merchant ?? '';
  const rule = matchRule(ctx.rules, ctx.owner, counterparty, paymentMethodLabel(data));
  if (rule) {
    if (rule.action === 'ignore') return { kind: 'ignore', reason: 'rule' };
    if (rule.action === 'expense') return { kind: 'expense', categoryId: rule.category_id, ruleId: rule.id };
    return transfer(rule.transfer_kind ?? 'other', `Rule: ${rule.match_counterparty}`, rule.account_id, rule.id);
  }

  const settled = findStatement(data, ctx.statements);
  if (settled) return { kind: 'card_bill', statementId: settled.statement.id, alreadyPaid: settled.alreadyPaid };

  if (CARD_BILL_PAYEE.test(counterparty)) return transfer('card_bill', 'Card bill payment');
  if (INVESTMENT_PAYEE.test(counterparty)) return transfer('investment', 'Investment platform');
  if (TAX_PAYEE.test(counterparty)) return transfer('tax', 'Tax payment');
  if (ATM_PAYEE.test(counterparty)) return transfer('cash', 'Cash withdrawal');
  if (namesIn(counterparty, payeeNames(ctx.owner))) return transfer('own_account', 'Paid to yourself');

  if (otherMembers(ctx.owner).some((other) => namesIn(counterparty, payeeNames(other)))) {
    return transfer('family', 'Household transfer');
  }

  // Below here the evidence is circumstantial, so a hand-entered expense wins:
  // a large UPI debit for, say, an annual membership is a real expense.
  if (ctx.hasExpenseMatch) return { kind: 'expense', categoryId: null, ruleId: null };
  if (data.instrument === 'account') return transfer('other', 'Account transfer (NEFT/IMPS)');
  // A card cannot send money to another account — a large card debit is a purchase (a big
  // AMAZON PAY ECOM order would otherwise sit in the transfer queue as "Large payment"). A large
  // UPI debit stays a question: rent, a person, or a deposit all look the same.
  if (data.amount >= LARGE_UNMATCHED_DEBIT && data.instrument !== 'card') return transfer('other', 'Large payment');

  return { kind: 'expense', categoryId: null, ruleId: null };
}
