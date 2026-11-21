/**
 * Tolerant text helpers for reading alert and statement emails. Every bank
 * words its mail differently and changes the template without notice, so these
 * look for *shapes* (a currency amount, a date, a masked card number) rather
 * than exact sentences. All return null instead of throwing.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_NAME = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';

/**
 * Drop the asterisks plain-text mail uses for bold. HDFC's card alert (seen live 2026-10) reads
 * "ending *1909* towards *RSP*BHARTI AIRTEL LIMI* on *17 Oct, 2026 at 16:50:04*", and every
 * shape below failed on it: no payee, no card, no time. Only a lone `*` at a word edge goes —
 * one inside a descriptor (RSP*BHARTI) and a run masking a number (**********8723) both stay.
 * Mail with fewer than two `*bold*` spans is left alone: Axis prints "OPENAI *CHATGPT SUBSCR",
 * where the asterisk is part of the merchant.
 */
const BOLD_SPAN = /(?<![*\w])\*[^\s*][^*\n]{0,80}?\*(?![*\w])/g;

export function stripEmphasis(text: string): string {
  if ((text.match(BOLD_SPAN) ?? []).length < 2) return text;
  return text.replace(/(?<![*\w])\*(?=[^\s*])/g, '').replace(/(?<=[^\s*])\*(?![*\w])/g, '');
}

/** Collapse whitespace into single spaces. `\s` already covers non-breaking spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function parseAmountToken(token: string): number | null {
  const value = Number(token.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

const NUMBER = '([\\d,]*\\d(?:\\.\\d{1,2})?)';
const INR_AMOUNT = new RegExp(`(?:\\brs\\.?|\\binr|₹)\\s*${NUMBER}`, 'i');
const FOREIGN_AMOUNT = new RegExp(`\\b(USD|EUR|GBP|AED|SGD|JPY|AUD|CAD)\\s*${NUMBER}`, 'i');

/** First rupee amount in the text: "Rs.1,234.50", "INR 500", "₹ 99". */
export function findAmount(text: string): number | null {
  const match = text.match(INR_AMOUNT);
  return match ? parseAmountToken(match[1]) : null;
}

/**
 * First amount of any supported currency. Order matters: a USD card spend is
 * usually followed by "Available limit: INR …", which must not win.
 */
export function findFirstAmount(text: string): { amount: number; currency: string } | null {
  const inr = text.match(INR_AMOUNT);
  const foreign = text.match(FOREIGN_AMOUNT);
  const inrAt = inr?.index ?? Number.POSITIVE_INFINITY;
  const foreignAt = foreign?.index ?? Number.POSITIVE_INFINITY;

  if (inr && inrAt <= foreignAt) {
    const amount = parseAmountToken(inr[1]);
    return amount === null ? null : { amount, currency: 'INR' };
  }
  if (foreign) {
    const amount = parseAmountToken(foreign[2]);
    return amount === null ? null : { amount, currency: foreign[1].toUpperCase() };
  }
  return null;
}

/** First amount (currency marker optional) within a short window after `label`. */
export function findAmountAfter(text: string, label: RegExp): number | null {
  const at = text.match(label);
  if (!at || at.index === undefined) return null;
  const start = at.index + at[0].length;
  const match = text.slice(start, start + 40).match(new RegExp(`^[^\\d]*?(?:rs\\.?|inr|₹)?\\s*${NUMBER}`, 'i'));
  return match ? parseAmountToken(match[1]) : null;
}

function isoDate(year: number, month: number, day: number): string | null {
  const fullYear = year < 100 ? 2000 + year : year;
  if (month < 1 || month > 12 || day < 1 || day > 31 || fullYear < 2000 || fullYear > 2100) return null;
  const probe = new Date(Date.UTC(fullYear, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return null; // 31 Feb and friends
  return `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

type DatePattern = { re: RegExp; toIso: (m: RegExpMatchArray) => string | null };

// Numeric dates are read day-first: these are Indian institutions.
const DATE_PATTERNS: DatePattern[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, toIso: (m) => isoDate(+m[1], +m[2], +m[3]) },
  { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g, toIso: (m) => isoDate(+m[3], +m[2], +m[1]) },
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*${MONTH_NAME}[\\s,'-]*(\\d{4}|\\d{2})\\b`, 'gi'),
    toIso: (m) => isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]),
  },
  {
    re: new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2}),?\\s*(\\d{4})\\b`, 'gi'),
    toIso: (m) => isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]),
  },
];

/** Every recognisable date in the text, in order of appearance, as yyyy-MM-dd. */
export function findDates(text: string): string[] {
  const found: { index: number; iso: string }[] = [];
  for (const { re, toIso } of DATE_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const iso = toIso(match);
      if (iso && match.index !== undefined) found.push({ index: match.index, iso });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.iso);
}

export function findDate(text: string): string | null {
  return findDates(text)[0] ?? null;
}

/** First date within a short window after `label`. */
export function findDateAfter(text: string, label: RegExp, windowSize = 40): string | null {
  const at = text.match(label);
  if (!at || at.index === undefined) return null;
  const start = at.index + at[0].length;
  return findDate(text.slice(start, start + windowSize));
}

/** "Sep 2026" / "September, 2026" → first and last day of that month. */
export function findMonthPeriod(text: string): { from: string; to: string } | null {
  const match = text.match(new RegExp(`\\b${MONTH_NAME}[\\s,'-]*(\\d{4})\\b`, 'i'));
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  const year = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, lastDay);
  return from && to ? { from, to } : null;
}

/**
 * A two-column alert read as label → value.
 *
 * Axis card alerts are a table, not a sentence — "Transaction Amount / INR 289 / Merchant Name /
 * SRI SWEETS / Axis Bank Credit Card No. / XX0001 / Date & Time / 19-09-2026, 13:20:46 IST". The
 * prose patterns find nothing in it, so 31 of 46 Axis alerts arrived with no payee at all, were
 * described "Axis Bank card ••2303 payment", and left the category matcher nothing to read —
 * which is why they all landed in Miscellaneous.
 *
 * Read **line by line**, on the body before `oneLine` flattens it. Collapsed to one line the
 * split is genuinely ambiguous: "INR 289 Merchant Name:" reads as the label "INR 289 Merchant
 * Name" just as well as "Merchant Name". One field per line is how these mails are actually
 * built, and it needs no guessing. A label is a short line ending in a colon; its value is the
 * rest of that line, or the next line when the colon ends it.
 *
 * Nothing here knows which labels a bank uses — callers ask for the keys they want, so an
 * unknown or invented label costs nothing.
 */
export function readLabelledFields(text: string): Map<string, string> {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const isLabel = (line: string) => /^[A-Za-z][^:]{0,44}\*?\s*:/.test(line);
  const fields = new Map<string, string>();

  lines.forEach((line, i) => {
    if (!isLabel(line)) return;
    const colon = line.indexOf(':');
    const key = line.slice(0, colon).replace(/\*+$/, '').trim().toLowerCase();
    const inline = line.slice(colon + 1).trim();
    const next = lines[i + 1];
    const value = inline || (next && !isLabel(next) ? next : '');
    // First wins: the same label repeated in a footer must not overwrite the real value.
    if (key && value && !fields.has(key)) fields.set(key, value);
  });
  return fields;
}

/** "13:20:46" / "1:05 PM" — the clock time an alert quotes, as HH:mm:ss. */
export function findTime(text: string): string | null {
  const match = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(am|pm)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`;
}

/**
 * Last four digits of a masked card or account: "XX1234", "ending 1234", "**1234", and ICICI's
 * standing-instruction mail, which prints the bare "Credit Card 4123".
 */
export function findLast4(text: string): string | null {
  const match =
    text.match(/(?:ending(?:\s+(?:with|in))?|\bx{2,}|\*{2,}|•{2,})\s*(\d{4})\b/i) ??
    text.match(/\bcredit\s+card\s+(\d{4})(?!\d)/i);
  return match ? match[1] : null;
}

/**
 * The time of a spend, read only where a transaction sentence prints it: "on 17 Oct, 2026 at
 * 16:50:04" (HDFC card), "on Oct 15, 2026 at 03:59:03" (ICICI). Anywhere else in the mail a
 * time is as likely to be the footer's.
 */
export function findTxnTime(text: string): string | null {
  const match = text.match(/\bon\s+[^.;:]{4,24}?\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)/i);
  return match ? findTime(match[1]) : null;
}

/**
 * Mask anything that should never reach the database, even in a one-line
 * summary or an attachment name: PANs and long digit runs (account, card,
 * PRAN, folio numbers). Lookarounds rather than `\b`, because attachment names
 * glue these to underscores ("CAS_ABCDE1234F.pdf").
 */
export function redact(text: string): string {
  return text
    .replace(/(?<![A-Za-z])[A-Z]{5}\d{4}[A-Z](?![A-Za-z])/g, '[PAN]')
    .replace(/(?<!\d)\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}(?!\d)/g, (m) => `••${m.slice(-4)}`)
    .replace(/(?<!\d)\d{8,}(?!\d)/g, (m) => `••${m.slice(-4)}`);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** An HTML-only email ("<!doctype html>…") as it arrives through Gmail's plain body. */
export function looksLikeHtml(text: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html)/i.test(text);
}

/** HTML mail as plain text: head, styles and scripts dropped, block ends as line breaks, common entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|table|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
