import type { Transfer, TransferKind } from '@/types';
import type { TransferResolution } from '@/lib/ai/schemas';

/**
 * Claude deciding a waiting transfer (the rule: no To-do item unless the Claude API couldn't
 * resolve it). Pure: what Claude is shown, and whether its answer may be applied.
 *
 * Applied without asking only when all of these hold:
 *   - Claude is confident;
 *   - the text it quotes as evidence really is in the statement line or the history it was shown
 *     — so a plausible guess cannot pass as evidence;
 *   - the kind is one that only re-labels the transfer. An investment needs a contribution or SIP
 *     match (a confident wrong account mis-files real money), and an expense or income writes
 *     other tables — those are suggested, never applied;
 *   - for money in, only a household or own-account move: a credit filed as `other` would count
 *     as money in on the cash-flow report, which a refund or a reversal is not.
 */

const AUTO_DEBIT_KINDS: readonly TransferKind[] = ['family', 'own_account', 'tax', 'cash', 'loan', 'card_bill', 'other'];
const AUTO_CREDIT_KINDS: readonly TransferKind[] = ['family', 'own_account'];

/** Shorter quotes ("NEFT", "UPI") are in nearly every line and prove nothing. */
const MIN_QUOTE_CHARS = 5;

/** Case, spacing and punctuation ignored — statements wrap and glue words mid-name. */
export function normalizeForQuote(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether `quote` appears in any of `sources`. */
export function quoteFound(quote: string | null, sources: readonly string[]): boolean {
  if (!quote) return false;
  const needle = normalizeForQuote(quote);
  if (needle.length < MIN_QUOTE_CHARS) return false;
  return sources.some((source) => normalizeForQuote(source).includes(needle));
}

/** The kind to apply without asking, or null when the answer is only a suggestion. */
export function autoApplyKind(
  answer: TransferResolution,
  direction: Transfer['direction'],
  evidence: readonly string[]
): TransferKind | null {
  if (answer.confidence !== 'high') return null;
  if (answer.kind === 'unsure' || answer.kind === 'expense' || answer.kind === 'income' || answer.kind === 'investment') return null;
  const allowed = direction === 'credit' ? AUTO_CREDIT_KINDS : AUTO_DEBIT_KINDS;
  if (!allowed.includes(answer.kind)) return null;
  return quoteFound(answer.quote, evidence) ? answer.kind : null;
}

/**
 * What the decision was made from; a transfer is put to Claude again only when this changes.
 * A plain 64-bit FNV-1a, not `crypto`: this only tells evidence apart, and node's crypto is not
 * available in the browser-like test environment the build runs in.
 */
export function evidenceKey(transfer: Pick<Transfer, 'note' | 'counterparty' | 'amount' | 'date'>): string {
  const text = [transfer.note ?? '', transfer.counterparty ?? '', transfer.amount, transfer.date].join('|');
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  const mask = (BigInt(1) << BigInt(64)) - BigInt(1);
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0) as number);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** One line of the household's filing history, as Claude sees it. */
export function historyLine(t: Pick<Transfer, 'date' | 'direction' | 'amount' | 'counterparty' | 'kind' | 'note' | 'payment_method'>): string {
  const money = `${t.direction === 'credit' ? '+' : '-'}₹${Number(t.amount).toLocaleString('en-IN')}`;
  return [t.date, money, t.payment_method ?? '', t.counterparty ? `payee: ${t.counterparty}` : '', `filed as: ${t.kind}`, t.note ? `note: ${t.note}` : '']
    .filter(Boolean)
    .join(' | ');
}

/**
 * The confirmed transfers most likely to explain this one: the same payee first, then the same
 * amount, then the most recent — at most `limit`.
 */
export function relevantHistory<T extends Pick<Transfer, 'id' | 'date' | 'amount' | 'counterparty'>>(
  transfer: Pick<Transfer, 'id' | 'amount' | 'counterparty'>,
  confirmed: readonly T[],
  limit = 30
): T[] {
  const payee = transfer.counterparty ? normalizeForQuote(transfer.counterparty) : null;
  const score = (t: T) =>
    (payee && t.counterparty && normalizeForQuote(t.counterparty) === payee ? 2 : 0) +
    (Number(t.amount) === Number(transfer.amount) ? 1 : 0);
  return confirmed
    .filter((t) => t.id !== transfer.id)
    .slice()
    .sort((a, b) => score(b) - score(a) || b.date.localeCompare(a.date))
    .slice(0, limit);
}

/** The household as the prompt names it — `householdDescription()` from lib/household.ts. */
export const resolveSystem = (household: string) => `You classify bank transfers for an Indian household (${household}). Each transfer is money that left or reached one of their bank accounts
and that their bank alert did not explain.

Kinds:
- family: money between members of the household (or to/for their dependants)
- own_account: between two accounts of the same person
- investment: into a brokerage, mutual fund, US-stocks or pension account
- loan: an EMI or loan repayment
- card_bill: paying a credit-card bill
- tax: income tax / TDS / GST to the government
- cash: an ATM withdrawal
- other: a real payment to someone else that is none of the above
- expense: household spending (a shop, a service, fees)
- income: salary, interest, dividends, a refund of earnings
- unsure: the evidence does not say

Rules:
- Decide only from the STATEMENT LINE, the PAYEE and the HISTORY you are given. Never guess from the amount alone.
- "quote" must be text copied exactly from the STATEMENT LINE, PAYEE or HISTORY that shows the kind. Use null if there is none.
- "high" confidence only when the quoted text alone settles it.
- Keep "reason" to one plain sentence a family member would understand.`;

export function buildResolvePrompt(input: {
  transfer: Transfer;
  ownerName: string;
  householdNames: readonly string[];
  commitments: readonly string[];
  history: readonly string[];
}): string {
  const { transfer } = input;
  const money = `₹${Number(transfer.amount).toLocaleString('en-IN')}`;
  return [
    `TRANSFER: ${transfer.direction === 'credit' ? 'money in' : 'money out'} ${money} on ${transfer.date}, ${input.ownerName}'s ${transfer.payment_method ?? 'account'}`,
    `STATEMENT LINE: ${transfer.note?.startsWith('Statement:') ? transfer.note.slice('Statement:'.length).trim() : '(none — the bank statement did not show this line)'}`,
    `PAYEE: ${transfer.counterparty ?? '(not named)'}`,
    `HOUSEHOLD NAMES AS BANKS PRINT THEM: ${input.householdNames.join(', ')}`,
    input.commitments.length > 0 ? `DECLARED COMMITMENTS (insurance, EMIs): ${input.commitments.join('; ')}` : null,
    'HISTORY (how similar transfers were filed):',
    ...(input.history.length > 0 ? input.history.map((line) => `- ${line}`) : ['- (none)']),
  ]
    .filter(Boolean)
    .join('\n');
}
