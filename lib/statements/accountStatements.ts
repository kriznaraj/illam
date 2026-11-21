/**
 * Readers for bank account statements, written against the real HDFC and Kotak
 * statements of June and July 2026 (statement_samples). What they produce is a
 * month-end balance per account, and a balance is trusted only when the statement's
 * own figures agree with each other — never by column position:
 *
 *  - HDFC sends one *combined* PDF per customer, one block per account. Each block
 *    ends in a SUMMARY whose four amounts pdf.js prints before their labels
 *    (closing, credits, debits, opening); opening + credits − debits must equal
 *    closing, or the block is not reconciled.
 *  - Kotak glues opening and closing into one run ("12,345.6712,890.12") per line of
 *    its Account Summary; savings + ActivMoney (its sweep FD) must equal the total,
 *    on both sides, or the statement is not reconciled.
 *
 * Each account's transaction lines are read too, because the narration names the other
 * side of every NEFT that the bank's alert left anonymous. A line is trusted the same
 * way: the running balance must step from the opening, line by line, to the closing.
 * Kotak glues a row's reference, amount and balance into one run
 * ("NEFTINW-…1110,000.0022,345.67"), so its split is whichever one makes
 * previous balance ± amount = this balance.
 *
 * Pure: text in, figures out.
 */

export interface StatementAccountBalance {
  /** Last four digits of the account number. */
  last4: string;
  accountType: string | null;
  opening: number | null;
  credits: number | null;
  debits: number | null;
  /** The balance the account closed the period on — the figure Selvam records. */
  closing: number;
  /** Whether the statement's own figures for this account agree with each other. */
  reconciled: boolean;
  /** The account's transactions, oldest first (Kotak: the savings side only). */
  lines: StatementLine[];
  /** Every line was read and the running balance steps from opening to closing. */
  linesReconciled: boolean;
}

export interface StatementLine {
  /** yyyy-MM-dd */
  date: string;
  /** The bank's description, wrapped lines joined by spaces. */
  narration: string;
  direction: 'debit' | 'credit';
  amount: number;
  balance: number;
}

export interface ParsedAccountStatement {
  bank: 'HDFC' | 'Kotak';
  /** yyyy-MM-dd */
  periodFrom: string | null;
  /** yyyy-MM-dd — the day the closing balances are as of. */
  periodTo: string | null;
  accounts: StatementAccountBalance[];
}

const TOLERANCE = 0.01;
const AMOUNT = /^-?(?:[1-9]\d{0,2}(?:,\d{2})*,\d{3}|[1-9]\d{0,2}|0)\.\d{2}$/;
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const toNumber = (value: string) => Number(value.replace(/,/g, ''));
const round2 = (value: number) => Math.round(value * 100) / 100;
const agrees = (a: number, b: number) => Math.abs(a - b) < TOLERANCE;
/** Account numbers arrive whole; samples arrive masked ("••3101"). Either way, the last four. */
const lastFour = (value: string) => value.replace(/\D/g, '').slice(-4);

function fromSlashDate(value: string): string {
  const [day, month, year] = value.split('/');
  return `${year}-${month}-${day}`;
}

function fromDayMonthName(value: string): string | null {
  const m = value.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${month}-${m[1].padStart(2, '0')}` : null;
}

/**
 * "12,345.6712,890.12" → [12345.67, 12890.12]. Amounts always carry exactly two
 * decimals, so the first one ends two digits after the first point — the split is
 * unique, and each half must still read as a properly grouped amount.
 */
export function splitGluedAmounts(run: string): number[] | null {
  const parts = run.trim().match(/-?[\d,]*?\d\.\d{2}/g);
  if (!parts || parts.join('') !== run.trim() || !parts.every((part) => AMOUNT.test(part))) return null;
  return parts.map(toNumber);
}

// ---------------------------------------------------------------------------
// HDFC
// ---------------------------------------------------------------------------

/** ": 50100123453101" then ": 01/07/2026 To 31/07/2026" — every page header of an account block. */
const HDFC_ACCOUNT_HEADER = /:\s*([•\d]{4,})\s*\n\s*:\s*(\d{2}\/\d{2}\/\d{4})\s+To\s+(\d{2}\/\d{2}\/\d{4})/g;
const HDFC_ACCOUNT_TYPE = /:\s*([A-Z][A-Z0-9 /&.-]+?)\s*\n?\s*\((\d{3})\)/;

export function parseHdfcAccountStatement(text: string): ParsedAccountStatement {
  const headers = Array.from(text.matchAll(HDFC_ACCOUNT_HEADER)).map((m) => ({
    index: m.index ?? 0,
    last4: lastFour(m[1]),
    from: fromSlashDate(m[2]),
    to: fromSlashDate(m[3]),
  }));

  const accounts: StatementAccountBalance[] = [];
  const summaryAt = /\nSUMMARY\b/g;
  for (const match of Array.from(text.matchAll(summaryAt))) {
    const at = match.index ?? 0;
    // The summary belongs to the account whose page header came last before it.
    const header = headers.filter((h) => h.index < at).pop();
    if (!header || accounts.some((a) => a.last4 === header.last4)) continue;

    const block = text.slice(header.index, at);
    const balance = readHdfcSummary(block);
    if (!balance) continue;
    const type = block.match(HDFC_ACCOUNT_TYPE);
    // An account runs over several pages, each with its own header; its lines start at the first.
    const previousSummary = accounts.length > 0 ? lastSummaryBefore(text, header.index) : -1;
    const first = headers.find((h) => h.last4 === header.last4 && h.index > previousSummary) ?? header;
    const read = readHdfcLines(text.slice(first.index, at), header, balance.opening, balance.closing);
    accounts.push({ last4: header.last4, accountType: type ? type[1].trim() : null, ...balance, ...read });
  }

  return {
    bank: 'HDFC',
    periodFrom: headers[0]?.from ?? null,
    periodTo: headers[0]?.to ?? null,
    accounts,
  };
}

function lastSummaryBefore(text: string, index: number): number {
  return text.lastIndexOf('\nSUMMARY', index);
}

/** "01/07/2026NEFT Dr-…" opens a row; masked samples print "01/07/••1303 …", so the year is optional. */
const HDFC_ROW_START = /^(\d{2})\/(\d{2})\/(\d{4})?/;

/**
 * Rows between the account's first page header and its SUMMARY. A row opens on a line that
 * starts with a date *while no row is open* — a wrapped "01/07/2026 Ref …" inside a row is
 * not a new one — and closes on its amounts line: withdrawal, deposit and balance glued.
 */
function readHdfcLines(
  block: string,
  period: { from: string; to: string },
  opening: number | null,
  closing: number
): Pick<StatementAccountBalance, 'lines' | 'linesReconciled'> {
  const lines: StatementLine[] = [];
  let open: { date: string; parts: string[] } | null = null;
  let previous = opening;
  let consistent = opening !== null;

  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!open) {
      const start = line.match(HDFC_ROW_START);
      if (!start) continue;
      const year = start[3] ?? yearFor(start[2], period);
      // What follows the date is kept whole: "50100…1303 NET BANKING SI" names the receiving account.
      open = { date: `${year}-${start[2]}-${start[1]}`, parts: [line.slice(start[0].length)] };
      continue;
    }
    const amounts = splitGluedAmounts(line);
    if (!amounts || amounts.length !== 3) {
      open.parts.push(line);
      continue;
    }
    const [withdrawal, deposit, balance] = amounts;
    const debit = withdrawal > 0;
    if ((withdrawal > 0) === (deposit > 0) || previous === null || !agrees(round2(previous - withdrawal + deposit), balance)) {
      consistent = false;
    }
    lines.push({
      date: open.date,
      narration: open.parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      direction: debit ? 'debit' : 'credit',
      amount: debit ? withdrawal : deposit,
      balance,
    });
    previous = balance;
    open = null;
  }

  return { lines, linesReconciled: consistent && open === null && previous !== null && agrees(previous, closing) };
}

/** A row's year from the statement period (a December–January statement spans two). */
function yearFor(month: string, period: { from: string; to: string }): string {
  return month >= period.from.slice(5, 7) ? period.from.slice(0, 4) : period.to.slice(0, 4);
}

/** The four amounts just before "Closing Balance / Credit Amount / Debit Amount / Opening Balance". */
function readHdfcSummary(block: string): Omit<StatementAccountBalance, 'last4' | 'accountType' | 'lines' | 'linesReconciled'> | null {
  const labelAt = block.lastIndexOf('Closing Balance');
  if (labelAt < 0) return null;
  const amounts = block
    .slice(0, labelAt)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-4);
  if (amounts.length < 4 || !amounts.every((line) => AMOUNT.test(line))) return null;

  const [closing, credits, debits, opening] = amounts.map(toNumber);
  return { opening, credits, debits, closing, reconciled: agrees(round2(opening + credits - debits), closing) };
}

// ---------------------------------------------------------------------------
// Kotak
// ---------------------------------------------------------------------------

export function parseKotakAccountStatement(text: string): ParsedAccountStatement {
  const period = text.match(/(\d{1,2} [A-Za-z]{3} \d{4})\s*-\s*(\d{1,2} [A-Za-z]{3} \d{4})/);
  const accountNo = text.match(/Account No\.?\s*([•\dXx]{4,})/);
  const pair = (label: RegExp) => {
    const m = text.match(label);
    return m ? splitGluedAmounts(m[1]) : null;
  };
  const savings = pair(/Savings Account \(SA\):\s*([\d,.]+)/);
  const sweep = pair(/ActivMoney \(AM\):\s*([\d,.]+)/);
  const total = pair(/Total Balance \(SA \+ AM\):\s*([\d,.]+)/);

  const base = {
    bank: 'Kotak' as const,
    periodFrom: period ? fromDayMonthName(period[1]) : null,
    periodTo: period ? fromDayMonthName(period[2]) : null,
  };
  if (!accountNo || !savings || savings.length !== 2) return { ...base, accounts: [] };

  // With no ActivMoney line the savings balance is the whole account.
  const sides = sweep && sweep.length === 2 ? sweep : [0, 0];
  const opening = round2(savings[0] + sides[0]);
  const closing = round2(savings[1] + sides[1]);
  const reconciled = total ? total.length === 2 && agrees(total[0], opening) && agrees(total[1], closing) : !sweep;

  return {
    ...base,
    accounts: [
      {
        last4: lastFour(accountNo[1]),
        accountType: sweep ? 'Savings + ActivMoney' : 'Savings',
        opening,
        credits: null,
        debits: null,
        closing,
        reconciled,
        ...readKotakLines(text, savings[0], savings[1]),
      },
    ],
  };
}

/** "101 Jul 2026NEFT …" — the row number glued to the date. */
const KOTAK_ROW_START = /^(\d{1,3}?)(\d{2} [A-Z][a-z]{2} \d{4})/;
/** Rows wrap over a few lines at most; past this the row is unreadable. */
const KOTAK_MAX_ROW_LINES = 6;

function readKotakLines(text: string, opening: number, closing: number): Pick<StatementAccountBalance, 'lines' | 'linesReconciled'> {
  const start = text.indexOf('Opening Balance---');
  const end = text.indexOf('Account Summary', start);
  if (start < 0) return { lines: [], linesReconciled: false };

  const lines: StatementLine[] = [];
  let open: { date: string; parts: string[] } | null = null;
  let previous = opening;
  let consistent = true;

  for (const raw of text.slice(start, end > start ? end : undefined).split('\n').slice(1)) {
    const line = raw.trim();
    if (!open) {
      const row = line.match(KOTAK_ROW_START);
      if (!row) continue;
      open = { date: fromDayMonthName(row[2]) ?? '', parts: [] };
      const rest = line.slice(row[0].length);
      if (!closeKotakRow(rest)) open.parts.push(rest);
      continue;
    }
    if (!closeKotakRow(line)) {
      open.parts.push(line);
      if (open.parts.length > KOTAK_MAX_ROW_LINES) {
        consistent = false;
        open = null;
      }
    }
  }

  function closeKotakRow(line: string): boolean {
    if (!open) return false;
    const tail = resolveTail(line, previous);
    if (!tail) return false;
    lines.push({
      date: open.date,
      narration: [...open.parts, tail.rest].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      direction: tail.direction,
      amount: tail.amount,
      balance: tail.balance,
    });
    previous = tail.balance;
    open = null;
    return true;
  }

  return { lines, linesReconciled: consistent && open === null && lines.length > 0 && agrees(previous, closing) };
}

/**
 * The amount and balance glued onto the end of a row, chosen by the running balance: of every
 * way to cut the tail into two well-formed amounts, the one where previous ± amount = balance.
 * Null when none fits, or when two different readings both would.
 */
export function resolveTail(
  line: string,
  previous: number
): { rest: string; amount: number; balance: number; direction: 'debit' | 'credit' } | null {
  const found: { rest: string; amount: number; balance: number; direction: 'debit' | 'credit' }[] = [];
  for (let b = line.length - 4; b >= 0; b--) {
    const balanceText = line.slice(b);
    if (!AMOUNT.test(balanceText)) continue;
    const balance = toNumber(balanceText);
    for (let a = b - 4; a >= 0; a--) {
      const amountText = line.slice(a, b);
      if (!AMOUNT.test(amountText)) continue;
      const amount = toNumber(amountText);
      if (amount <= 0) continue;
      const direction = agrees(round2(previous - amount), balance) ? 'debit' : agrees(round2(previous + amount), balance) ? 'credit' : null;
      if (direction) found.push({ rest: line.slice(0, a).trim(), amount, balance, direction });
    }
  }
  const readings = new Set(found.map((f) => `${f.direction}:${f.amount}:${f.balance}`));
  return readings.size === 1 ? found[0] : null;
}
