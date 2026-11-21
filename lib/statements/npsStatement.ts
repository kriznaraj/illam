/**
 * Reader for the monthly NPS transaction statement (Protean), written against the
 * real June and July 2026 statements (statement_samples). pdf.js glues the
 * scheme-wise table into runs of digits — "54.863830.888128.8537" is three NAVs —
 * so each run is split on its fixed decimal places, and the value is trusted only
 * when the arithmetic closes: units × NAV must give each scheme's printed value,
 * and the schemes must add up to the "Value of your Holdings" the summary opens
 * with. Units and NAV are told apart by nothing but that product, which is
 * symmetric, so their order never matters.
 *
 * Pure: text in, figures out.
 */

export interface NpsScheme {
  units: number;
  nav: number;
  value: number;
}

export interface ParsedNpsStatement {
  /** Last four digits of the PRAN. */
  pranLast4: string | null;
  /** yyyy-MM-dd — the day the holdings are valued as of. */
  asOn: string | null;
  schemes: NpsScheme[];
  /** Σ scheme values — the account's balance. */
  total: number | null;
  reconciled: boolean;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** A product of two 4-decimal figures, rounded by the CRA, against our own rounding. */
const PRODUCT_TOLERANCE = 0.05;

const runOf = (places: number) => new RegExp(`^(?:\\d+\\.\\d{${places}})+$`);

/**
 * "858790.12458712.34" → [858790.12, 458712.34]. A lazy integer part would stop at
 * the first digit, so each figure is cut where its decimals end instead.
 */
function splitRun(line: string, places: number): number[] {
  const out: number[] = [];
  let rest = line;
  while (rest.length > 0) {
    const m = rest.match(new RegExp(`^(\\d+\\.\\d{${places}})`));
    if (!m) return [];
    out.push(Number(m[1]));
    rest = rest.slice(m[1].length);
  }
  return out;
}

export function parseNpsStatement(text: string): ParsedNpsStatement {
  const pran = text.match(/PRAN\s*([•\d]{4,})/);
  const period = text.match(/([A-Z][a-z]{2}) (\d{2}), (\d{4}) To ([A-Z][a-z]{2}) (\d{2}), (\d{4})/);
  const month = period ? MONTHS[period[4].toLowerCase()] : undefined;
  const asOn = period && month ? `${period[6]}-${month}-${period[5]}` : null;

  const empty: ParsedNpsStatement = {
    pranLast4: pran ? pran[1].replace(/\D/g, '').slice(-4) : null,
    asOn,
    schemes: [],
    total: null,
    reconciled: false,
  };

  const start = text.indexOf('Scheme wise Value');
  const end = text.indexOf('Changes made during', start);
  if (start < 0) return empty;
  const lines = text
    .slice(start, end > start ? end : undefined)
    .split('\n')
    .map((line) => line.trim());

  const values = lines.filter((line) => runOf(2).test(line)).map((line) => splitRun(line, 2));
  const fourPlace = lines.filter((line) => runOf(4).test(line)).map((line) => splitRun(line, 4));
  if (values.length !== 1 || fourPlace.length !== 2) return empty;

  const [schemeValues] = values;
  const [a, b] = fourPlace;
  if (schemeValues.length === 0 || a.length !== schemeValues.length || b.length !== schemeValues.length) return empty;

  const schemes = schemeValues.map((value, i) => ({ units: a[i], nav: b[i], value }));
  const productsHold = schemes.every((s) => Math.abs(s.units * s.nav - s.value) <= PRODUCT_TOLERANCE);
  const total = Math.round(schemeValues.reduce((sum, v) => sum + v, 0) * 100) / 100;

  // The summary's first figure is the value of holdings, glued to the next ones.
  const summary = summaryRun(text);
  const summaryHolds = summary !== null && summary.startsWith(total.toFixed(2));

  return { ...empty, schemes, total, reconciled: productsHold && summaryHolds };
}

/** The glued figures under the Investment Summary headings ("1145670.32 37 …"). */
function summaryRun(text: string): string | null {
  const at = text.indexOf('Investment Summary');
  if (at < 0) return null;
  const line = text
    .slice(at, text.indexOf('Scheme wise Value', at))
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^\d+\.\d{2}\d/.test(l));
  return line ?? null;
}
