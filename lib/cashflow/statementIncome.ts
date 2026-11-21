import { narrationPayee } from '@/lib/inbox/automation/statementNarration';
import { cleanPayee } from '@/lib/inbox/payee';
import type { StatementLine } from '@/lib/statements/accountStatements';
import type { IncomeKind } from '@/types';

/**
 * Which bank-statement credits are income — the only source of money in (by design: no
 * salary alert ever reaches Madal, but the statement prints every credit).
 * Written against real HDFC and Kotak statement layouts. Pure.
 *
 * Only what the narration says outright is read as income:
 *  - salary: the word itself ("A2AINT01 - ACME TECHNOLOGIES PVT LTD… - Salary - ACME
 *    Salary July 26"). A salary credit that prints only a reference number is missed — a
 *    guess on amount or day would also catch a large transfer from family;
 *  - interest: "Interest paid till 30-JUN-2026", Kotak's "Int.Pd:…";
 *  - dividends: a company paying through a mandate ("ACH C- EXAMPLE LIMITED-1234567") or a
 *    narration that says DIV ("EXAMPLE LTD EQ DIV25 26", "XYZ1stIntDiv…").
 * Every other credit — the other person's transfer, a Zerodha payout, an FD maturing —
 * is the household's own money moving, not money earned.
 */

export interface IncomeReading {
  kind: IncomeKind;
  sourceName: string | null;
}

const SALARY = /\bsalary\b/i;
const INTEREST = /^(?:Interest paid\b|Int\.Pd\b)/i;
const MANDATE_CREDIT = /\bACH C-/;
// "DIV25", "FINALDIV", "IntDiv••", "DIVIDEND" — but not "DIVYA" or "DHIVYA".
const DIVIDEND = /div(?:idend)?(?![a-z])/i;
const EMPLOYER = /([A-Z][A-Z&. ]*?\b(?:PVT|PRIVATE)?\.?\s*(?:LTD|LIMITED))/;

export function readIncomeLine(line: Pick<StatementLine, 'narration' | 'direction'>): IncomeReading | null {
  if (line.direction !== 'credit') return null;
  const { narration } = line;

  if (SALARY.test(narration)) {
    const employer = narration.match(EMPLOYER)?.[1];
    return { kind: 'salary', sourceName: employer ? cleanPayee(employer.trim()) : null };
  }
  if (INTEREST.test(narration.trim())) return { kind: 'interest', sourceName: null };
  if (MANDATE_CREDIT.test(narration) || DIVIDEND.test(narration)) {
    const named = narrationPayee(narration) ?? narration.match(/([A-Z][A-Z .&]+?)\s+(?:LTD\s+)?(?:EQ\s+)?DIV/)?.[1] ?? null;
    return { kind: 'dividend', sourceName: named ? cleanPayee(named.trim()) : null };
  }
  return null;
}

/**
 * A stable key per statement line, so re-reading a statement finds the rows it already wrote.
 * Two identical credits on one day (two ₹1,000 dividends) are told apart by their order.
 */
export function statementRefs(sourceId: string, last4: string, lines: readonly StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = `${sourceId}:${last4}:${line.date}:${line.direction}:${line.amount.toFixed(2)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}:${n}`;
  });
}
