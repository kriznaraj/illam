/**
 * Readers for credit-card statement PDFs, written against real HDFC and Axis
 * layouts (captured via statement_samples). pdf.js flattens each page
 * into lines, often gluing neighbouring cells together, so these match the order
 * values appear in rather than column positions.
 *
 * Pure: text in, figures out. Anything not found is null rather than a guess.
 */

export interface CardStatementTransaction {
  date: string; // yyyy-MM-dd
  description: string;
  amount: number;
  direction: 'debit' | 'credit';
}

export interface ParsedCardStatement {
  bank: 'HDFC Bank' | 'Axis Bank' | 'ICICI Bank';
  last4: string | null;
  statementDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  totalDue: number | null;
  minDue: number | null;
  transactions: CardStatementTransaction[];
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const money = (value: string | undefined): number | null => {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** "28 Jul, 2026" → 2026-07-28 */
function fromDayMonthName(value: string | undefined): string | null {
  const m = value?.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})/);
  const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${month}-${m[1].padStart(2, '0')}` : null;
}

/** "July 30, 2026" → 2026-07-30 */
function fromMonthDayYear(value: string | undefined): string | null {
  const m = value?.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/);
  const month = m ? MONTHS[m[1].toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${month}-${m[2].padStart(2, '0')}` : null;
}

/** "28/07/2026" → 2026-07-28 */
function fromSlashDate(value: string | undefined): string | null {
  const m = value?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** The value on the first non-empty line after a label line. */
function valueAfter(lines: string[], label: RegExp): string | undefined {
  const index = lines.findIndex((line) => label.test(line.trim()));
  if (index < 0) return undefined;
  return lines.slice(index + 1).find((line) => line.trim().length > 0)?.trim();
}

// pdf.js renders HDFC's rupee glyph as "C"; amounts read "C2,450.00" or "C 2,450.00".
const HDFC_AMOUNT = /C\s?([\d,]+\.\d{2})/;

export function parseHdfcCardStatement(text: string): ParsedCardStatement {
  const lines = text.split('\n');

  // "Credit Card No." … "CKYC ID" labels come first, then their values in the same order.
  const labelIndex = lines.findIndex((line) => /^Credit Card No\.?$/i.test(line.trim()));
  const block = labelIndex >= 0 ? lines.slice(labelIndex, labelIndex + 14).map((l) => l.trim()) : [];
  const cardNumber = block.find((line) => /^\d{6}X{6}\d{4}$/.test(line));
  const statementDate = fromDayMonthName(block.find((line) => /^\d{1,2} [A-Za-z]{3}, \d{4}$/.test(line)));
  const period = block.find((line) => /^\d{1,2} [A-Za-z]{3}, \d{4} - \d{1,2} [A-Za-z]{3}, \d{4}$/.test(line));
  const [periodStart, periodEnd] = period ? period.split(' - ').map(fromDayMonthName) : [null, null];

  const transactions: CardStatementTransaction[] = [];
  const row = /^(\d{2}\/\d{2}\/\d{4})\|\s*\d{2}:\d{2}\s*(.+?)(\+)?\s+C\s?([\d,]+\.\d{2})\s*$/;
  for (const line of lines) {
    const m = line.trim().match(row);
    const amount = m ? money(m[4]) : null;
    const date = m ? fromSlashDate(m[1]) : null;
    if (m && amount !== null && date) {
      transactions.push({ date, description: m[2].trim(), amount, direction: m[3] ? 'credit' : 'debit' });
    }
  }

  return {
    bank: 'HDFC Bank',
    last4: cardNumber?.slice(-4) ?? null,
    statementDate,
    periodStart: periodStart ?? null,
    periodEnd: periodEnd ?? null,
    dueDate: fromDayMonthName(valueAfter(lines, /^DUE DATE$/i)),
    totalDue: money(valueAfter(lines, /^TOTAL AMOUNT DUE$/i)?.match(HDFC_AMOUNT)?.[1]),
    minDue: money(valueAfter(lines, /^MINIMUM DUE$/i)?.match(HDFC_AMOUNT)?.[1]),
    transactions,
  };
}

export function parseAxisCardStatement(text: string): ParsedCardStatement {
  const lines = text.split('\n').map((line) => line.trim());

  // "Total Payment Due…Statement Generation Date" header, then
  // "DD/MM/YYYY - DD/MM/YYYY" + due date + generation date glued on one line, then
  // "3,215.40   Dr104.00   Dr" (total, minimum).
  const headerIndex = lines.findIndex((line) => /^Total Payment Due.*Statement Generation Date$/i.test(line));
  const datesLine = headerIndex >= 0 ? lines[headerIndex + 1] ?? '' : '';
  const dates = datesLine.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})(\d{2}\/\d{2}\/\d{4})(\d{2}\/\d{2}\/\d{4})/);
  const amountsLine = headerIndex >= 0 ? lines[headerIndex + 2] ?? '' : '';
  const amounts = amountsLine.match(/([\d,]+\.\d{2})\s*(Dr|Cr)\s*([\d,]+\.\d{2})\s*(Dr|Cr)/);

  const cardNumber = text.match(/\d{6}\*{6}(\d{4})/);

  const transactions: CardStatementTransaction[] = [];
  const row = /^(\d{2}\/\d{2}\/\d{4})(.+?)([\d,]+\.\d{2})\s(Dr|Cr)(?:[\d,]+\.\d{2}\s(?:Dr|Cr))?$/;
  for (const line of lines) {
    const m = line.match(row);
    const amount = m ? money(m[3]) : null;
    const date = m ? fromSlashDate(m[1]) : null;
    if (m && amount !== null && date) {
      transactions.push({ date, description: m[2].trim(), amount, direction: m[4] === 'Cr' ? 'credit' : 'debit' });
    }
  }

  // A total shown as "Cr" is a credit balance: nothing is owed.
  const totalDue = amounts ? (amounts[2] === 'Cr' ? 0 : money(amounts[1])) : null;
  const minDue = amounts ? (amounts[4] === 'Cr' ? 0 : money(amounts[3])) : null;

  return {
    bank: 'Axis Bank',
    last4: cardNumber?.[1] ?? null,
    statementDate: fromSlashDate(dates?.[4]),
    periodStart: fromSlashDate(dates?.[1]),
    periodEnd: fromSlashDate(dates?.[2]),
    dueDate: fromSlashDate(dates?.[3]),
    totalDue,
    minDue,
    transactions,
  };
}

/**
 * ICICI (Amazon Pay card), as captured 2026-09-14. pdf.js renders the rupee glyph as a
 * backtick. The summary prints the minimum and total due as the first two lines that
 * hold a lone amount; the "Statement period" line gives the statement date, and the due
 * date is the header date that falls within a month after it.
 *
 * Transactions are not read yet: date, serial number, details and reward points arrive
 * glued into one run, and the captured samples mask exactly the digits that would tell
 * them apart. Without lines, the statement is recorded but not reconciled.
 */
export function parseIciciCardStatement(text: string): ParsedCardStatement {
  const lines = text.split('\n').map((line) => line.trim());

  const period = text.match(/Statement period\s*:\s*([A-Za-z]+ \d{1,2}, \d{4})\s*to\s*([A-Za-z]+ \d{1,2}, \d{4})/i);
  const periodStart = fromMonthDayYear(period?.[1]);
  const periodEnd = fromMonthDayYear(period?.[2]);

  const headerDates = lines
    .filter((line) => /^[A-Za-z]+ \d{1,2}, \d{4}$/.test(line))
    .map((line) => fromMonthDayYear(line))
    .filter((date): date is string => date !== null);
  const dueDate = periodEnd
    ? headerDates.find((date) => date > periodEnd && (Date.parse(date) - Date.parse(periodEnd)) / 86_400_000 <= 31) ?? null
    : null;

  const amounts = lines
    .filter((line) => /^`[\d,]+\.\d{2}$/.test(line))
    .slice(0, 2)
    .map((line) => money(line.slice(1)))
    .filter((amount): amount is number => amount !== null);

  const card = text.match(/\b\d{4}X{8}(\d{4})\b/);

  return {
    bank: 'ICICI Bank',
    last4: card?.[1] ?? null,
    statementDate: periodEnd,
    periodStart,
    periodEnd,
    dueDate,
    totalDue: amounts.length === 2 ? Math.max(...amounts) : null,
    minDue: amounts.length === 2 ? Math.min(...amounts) : null,
    transactions: [],
  };
}
