import { ATM_PAYEE, CARD_BILL_PAYEE, INVESTMENT_PAYEE, TAX_PAYEE } from './classify';
import { otherMembers, payeeNames, statementAccountIds } from '@/lib/household';
import { cleanPayee } from '@/lib/inbox/payee';
import type { StatementLine } from '@/lib/statements/accountStatements';
import type { InboxOwner, Transfer, TransferKind } from '@/types';

/**
 * What a bank statement says about a transfer its alert left anonymous. HDFC and Kotak NEFT
 * alerts name no payee, so a ₹40,000 to Bob and a ₹40,000 to anyone else look the same
 * until the month's statement arrives — and its narration names the other side:
 * "NEFT Dr-KKBK0000123-BOB K-…", "50100…1303 NET BANKING SI", "NEFT … ALICE V".
 *
 * Only a household transfer is settled outright: the other person's name or one of their
 * accounts is in the narration, which is proof, not inference. Everything else is read into
 * a suggested kind and a payee and left to the usual rules — `own_account` is not
 * self-evident (a transfer narrated with the owner's own name can be a brokerage deposit), and an investment still
 * needs its SIP instalment or a person to say which account. Pure.
 */

export interface NarrationReading {
  kind: TransferKind;
  /** True only when the narration proves it — today, a household transfer. */
  settle: boolean;
  counterparty: string | null;
}

/** Last four digits of each owner's bank accounts, from the statement mapping (not NPS). */
export function householdAccounts(
  mapping: Partial<Record<InboxOwner, Record<string, string>>> = statementAccountIds()
): Record<InboxOwner, string[]> {
  return Object.fromEntries(
    Object.entries(mapping).map(([owner, accounts]) => [
      owner,
      Object.keys(accounts ?? {})
        .filter((key) => /_account_statement:/.test(key))
        .map((key) => key.split(':')[1]),
    ])
  );
}

const names = (list: readonly string[]) =>
  list.length === 0 ? /(?!)/ : new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');
/** A whole account number ending in these digits (or its masked form) — never a short reference. */
const accountEnding = (last4: string) => new RegExp(`(?:\\d{8,}|••)${last4}(?!\\d)`);

/** The other party as the narration prints it, when it prints one. */
export function narrationPayee(narration: string): string | null {
  const patterns = [
    /NEFT (?:Dr|Cr)-[A-Z]{4}0[A-Z0-9]{6}-([A-Z][A-Z .]+?)-/, // HDFC NEFT: IFSC, then the name
    /\bNEFT \S+ ([A-Z][A-Z .]+?) [A-Z]{4}0[A-Z0-9]{6}\b/, // Kotak NEFT: reference, name, IFSC
    /^UPI-([^-@]+?)-/, // HDFC UPI
    /^UPI\/([^/]+?)\s*\//, // Kotak UPI
    /\bACH [DC]- ([^-]+?)-/, // mandates
  ];
  for (const pattern of patterns) {
    const m = narration.match(pattern);
    if (m) return cleanPayee(m[1].trim());
  }
  return null;
}

/** "50100…1707-TPT-…-ZERODHA BROKING LTD-…": the account a narration opens with. */
/** Eight digits or more in all: an account number, never a short reference. */
const LEADING_ACCOUNT = /^(?:\d{4,}|••)(\d{4})(?!\d)/;

/**
 * Who each account number belongs to, learnt from the statement itself. A standing
 * instruction prints only "50100…1707 NET BANKING SI -Investment", but the same statement's
 * transfers to that account print "…1707-TPT-…-ZERODHA BROKING LTD": the account is Zerodha's.
 */
export function accountAliases(lines: readonly Pick<StatementLine, 'narration'>[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const { narration } of lines) {
    const account = narration.match(LEADING_ACCOUNT)?.[1];
    const payee = account ? narration.match(/-TPT-\S+(?: \S+)?-([A-Z][A-Z .]+?)-/)?.[1] : undefined;
    if (account && payee && !aliases.has(account)) aliases.set(account, payee.trim());
  }
  return aliases;
}

export function readNarration(
  narration: string,
  owner: InboxOwner,
  accounts: Record<InboxOwner, string[]> = householdAccounts(),
  aliases: ReadonlyMap<string, string> = new Map()
): NarrationReading | null {
  const alias = aliases.get(narration.match(LEADING_ACCOUNT)?.[1] ?? '');
  const counterparty = narrationPayee(narration) ?? (alias ? cleanPayee(alias) : null);
  // The alias is read like the narration's own words: "ZERODHA BROKING LTD" is an investment.
  const text = alias ? `${narration} ${alias}` : narration;

  const isMemberOf = (who: InboxOwner) =>
    names(payeeNames(who)).test(text) || (accounts[who] ?? []).some((last4) => accountEnding(last4).test(text));

  if (otherMembers(owner).some(isMemberOf)) {
    return { kind: 'family', settle: true, counterparty };
  }
  // "UPI-INDmoney Credit Card-…": a bill paid through INDmoney, not money invested with it.
  if (CARD_BILL_PAYEE.test(text) || /\bcredit\s*card\b/i.test(text)) return { kind: 'card_bill', settle: false, counterparty };
  if (TAX_PAYEE.test(text)) return { kind: 'tax', settle: false, counterparty };
  if (ATM_PAYEE.test(text)) return { kind: 'cash', settle: false, counterparty };
  if (INVESTMENT_PAYEE.test(text)) return { kind: 'investment', settle: false, counterparty };
  if (isMemberOf(owner)) {
    return { kind: 'own_account', settle: false, counterparty };
  }
  return counterparty ? { kind: 'other', settle: false, counterparty } : null;
}

/**
 * The account a debit went into, as its narration prints it: "50100…1707 NET BANKING SI",
 * "50100…1707-TPT-…", or "IB SS FUNDS TRANSFER DR-…1606".
 */
export function destinationAccount(narration: string): string | null {
  return (
    narration.match(LEADING_ACCOUNT)?.[1] ??
    narration.match(/FUNDS TRANSFER DR-(?:\d{4,}|••)(\d{4})(?!\d)/)?.[1] ??
    null
  );
}

/** How far a statement line may be dated from its alert: an evening NEFT posts the next day. */
export const LINE_MAX_DAYS = 2;

export interface StatementAccountLines {
  last4: string;
  lines: StatementLine[];
}

export interface LineMatch {
  transfer: Transfer;
  line: StatementLine;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
const accountOf = (transfer: Transfer) => transfer.payment_method?.match(/(?:account|UPI) ••(\d{4})\b/)?.[1] ?? null;

/**
 * Each waiting transfer of this owner, with the statement line it is: same account (the alert's
 * "account ••3101" or "UPI ••3101"), direction and amount to the paise, dated within two days.
 * Each line is claimed once, nearest date first — two ₹40,000 NEFTs on one day take the two
 * ₹40,000 lines, in order.
 */
export function matchStatementLines(
  transfers: readonly Transfer[],
  accounts: readonly StatementAccountLines[],
  { includeConfirmed = false }: { includeConfirmed?: boolean } = {}
): LineMatch[] {
  const options = transfers
    .filter((t) => includeConfirmed || t.status === 'needs_review')
    .flatMap((transfer) => {
      const lines = accounts.find((a) => a.last4 === accountOf(transfer))?.lines ?? [];
      return lines
        .map((line, index) => ({ transfer, line, index, days: daysApart(transfer.date, line.date) }))
        .filter(
          (o) =>
            o.line.direction === o.transfer.direction &&
            Math.round(o.line.amount * 100) === Math.round(Number(o.transfer.amount) * 100) &&
            o.days <= LINE_MAX_DAYS
        );
    })
    .sort((a, b) => a.days - b.days || a.transfer.created_at.localeCompare(b.transfer.created_at) || a.index - b.index);

  const usedTransfers = new Set<string>();
  const usedLines = new Set<StatementLine>();
  const matches: LineMatch[] = [];
  for (const option of options) {
    if (usedTransfers.has(option.transfer.id) || usedLines.has(option.line)) continue;
    usedTransfers.add(option.transfer.id);
    usedLines.add(option.line);
    matches.push({ transfer: option.transfer, line: option.line });
  }
  return matches;
}

/**
 * Debits on the statement that no alert ever reported — no transfer, waiting or confirmed,
 * is that line. A standing instruction is the usual one.
 */
export function unalertedDebits(transfers: readonly Transfer[], accounts: readonly StatementAccountLines[]): StatementLine[] {
  const seen = new Set(matchStatementLines(transfers, accounts, { includeConfirmed: true }).map((m) => m.line));
  return accounts.flatMap((a) => a.lines).filter((line) => line.direction === 'debit' && !seen.has(line));
}
