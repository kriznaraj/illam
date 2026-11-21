/**
 * Reader for the CDSL Consolidated Account Statement (CAS), written against the
 * real June and July 2026 statements (statement_samples). pdf.js glues table
 * cells into one run of digits — "1234567438.6161.27448,848.43…" is folio, units,
 * NAV and amount invested — so rows are split using what CDSL always prints
 * (fixed decimal places, Indian digit grouping) and every split is confirmed by
 * arithmetic: units × price = value, valuation − profit = invested. Never by
 * column position.
 *
 * Pure: text in, figures out. A row whose arithmetic does not hold is counted in
 * `unreadRows`, not guessed; `reconciled` says whether the rows add up to the
 * statement's own totals, which is what decides whether they can be trusted.
 */

export interface CasDematHolding {
  isin: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
}

export interface CasFolioHolding {
  isin: string;
  name: string;
  units: number;
  nav: number;
  invested: number;
  value: number;
}

export interface CasSummary {
  /** Sum of each demat account's "Portfolio Value" line. */
  demat: number | null;
  equity: number | null;
  mfFolios: number | null;
  mfDemat: number | null;
  others: number | null;
  total: number | null;
}

export interface ParsedCdslCas {
  /** yyyy-MM-dd, from "HOLDING STATEMENT AS ON" (or the MF units table). */
  asOn: string | null;
  demat: CasDematHolding[];
  folios: CasFolioHolding[];
  summary: CasSummary;
  unreadRows: number;
  reconciled: { demat: boolean; folios: boolean };
}

const RECONCILE_TOLERANCE = 1;
const ISIN = /^IN[A-Z0-9]{10}$/;
const INDIAN_MONEY = /^-?(?:[1-9]\d?,(?:\d{2},)*\d{3}|[1-9]\d{0,2}|0)\.\d{2}$/;
const WHOLE = /^(?:0|[1-9]\d*)$/;
const SOFT_HYPHEN = /­/g;

const toNumber = (value: string) => Number(value.replace(/,/g, ''));

/** "11,39,452.1032.49" → 1139452.1: the first two-decimal amount on a line. */
function firstAmount(line: string | undefined): number | null {
  const dot = line?.indexOf('.') ?? -1;
  if (!line || dot < 0) return null;
  const token = line.slice(0, dot + 3);
  return INDIAN_MONEY.test(token) ? toNumber(token) : null;
}

/** "30-06-2026" → 2026-06-30 */
function asOnDate(lines: string[]): string | null {
  for (const line of lines) {
    const m = line.match(/^(?:HOLDING STATEMENT|MUTUAL FUND UNITS HELD) AS ON (\d{2})-(\d{2})-(\d{4})/i);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

function readSummary(lines: string[]): Omit<CasSummary, 'demat'> {
  // The per-asset-class table; the same labels also appear in headings elsewhere.
  const start = lines.findIndex((line) => /^Asset Class\s*Value\s*Percentage$/i.test(line));
  const table = start >= 0 ? lines.slice(start + 1, start + 24) : [];
  const after = (label: RegExp) => {
    const index = table.findIndex((line) => label.test(line));
    return index >= 0 ? firstAmount(table[index + 1]) : null;
  };
  return {
    equity: after(/^Equity$/i),
    mfFolios: after(/^Mutual Fund Folios$/i),
    mfDemat: after(/^Mutual Funds Held in Demat Form$/i),
    others: after(/^Others$/i),
    total: after(/^Total$/i),
  };
}

// "<current bal><frozen, pledge… as dashes or figures><free bal><price, 4 dp><value>"
// e.g. 6.000------6.00010250.250061,501.50
const DEMAT_NUMBERS = /^(\d+\.\d{3})[-\d.]*?\d+\.\d{3}(\d+\.\d{4})(-?[\d,]+\.\d{2})$/;

function readDemat(lines: string[]): { holdings: CasDematHolding[]; portfolioValue: number | null; unread: number } {
  const holdings: CasDematHolding[] = [];
  let portfolioValue: number | null = null;
  let unread = 0;
  let inHoldings = false;
  let current: { isin: string; nameParts: string[] } | null = null;

  for (const line of lines) {
    if (/^HOLDING STATEMENT AS ON/i.test(line)) {
      inHoldings = true;
      current = null;
      continue;
    }
    if (!inHoldings) continue;

    const accountTotal = line.match(/^Portfolio Value\D*?([\d,]+\.\d{2})/);
    if (accountTotal || /^MUTUAL FUND UNITS HELD|^STATEMENT OF TRANSACTIONS/i.test(line)) {
      if (accountTotal && INDIAN_MONEY.test(accountTotal[1])) {
        portfolioValue = (portfolioValue ?? 0) + toNumber(accountTotal[1]);
      }
      if (current) unread += 1;
      inHoldings = false;
      current = null;
      continue;
    }

    if (ISIN.test(line)) {
      if (current) unread += 1;
      current = { isin: line, nameParts: [] };
      continue;
    }
    if (!current) continue;

    const m = line.match(DEMAT_NUMBERS);
    if (!m) {
      current.nameParts.push(line);
      continue;
    }
    const quantity = Number(m[1]);
    const price = Number(m[2]);
    const value = INDIAN_MONEY.test(m[3]) ? toNumber(m[3]) : NaN;
    if (Number.isFinite(value) && Math.abs(quantity * price - value) <= Math.max(1, value * 0.005)) {
      holdings.push({ isin: current.isin, name: joinName(current.nameParts), quantity, price, value });
    } else {
      unread += 1;
    }
    current = null;
  }

  return { holdings, portfolioValue, unread };
}

/**
 * "1234567/0845.12052.75" + valuation → units 845.120 and NAV 52.75. The NAV's
 * decimals end the run; which digits are units, NAV and folio is settled by
 * units × NAV coming back to the valuation.
 *
 * Units print with trailing zeros trimmed ("88.4") and a whole balance with no
 * point at all ("…1357/076312.4567" is 76 units at 312.4567), so the NAV is split
 * off first and the units may or may not carry decimals.
 */
function splitUnitsAndNav(head: string, value: number): { units: number; nav: number } | null {
  const navDot = head.lastIndexOf('.');
  if (navDot < 1) return null;
  const navDecimals = head.slice(navDot + 1);
  // Trailing zeros are trimmed from the NAV too: "92.3" (seen in real CAS files).
  if (!/^\d{1,4}$/.test(navDecimals)) return null;

  let best: { units: number; nav: number; error: number } | null = null;
  for (let navLength = 1; navLength <= 6 && navLength <= navDot; navLength++) {
    const navWhole = head.slice(navDot - navLength, navDot);
    if (!WHOLE.test(navWhole)) continue;
    const nav = Number(`${navWhole}.${navDecimals}`);

    const before = head.slice(0, navDot - navLength);
    const fractional = before.match(/(\d+)\.(\d{1,3})$/);
    const digits = fractional ? fractional[1] : (before.match(/\d+$/)?.[0] ?? '');
    const decimals = fractional ? fractional[2] : '';

    for (let length = 1; length <= 9 && length <= digits.length; length++) {
      const unitsWhole = digits.slice(-length);
      if (!WHOLE.test(unitsWhole)) continue;
      const units = Number(decimals ? `${unitsWhole}.${decimals}` : unitsWhole);
      const error = Math.abs(units * nav - value);
      if (error <= Math.max(1, value * 0.0005) && (!best || error < best.error)) {
        best = { units, nav, error };
      }
    }
  }
  return best ? { units: best.units, nav: best.nav } : null;
}

/** One glued MF units row: ISIN, folio, units, NAV, invested, valuation, profit, profit %. */
function readFolioRow(glued: string): Omit<CasFolioHolding, 'name'> | null {
  const s = glued.replace(SOFT_HYPHEN, '');
  const isin = s.slice(0, 12);
  if (!ISIN.test(isin)) return null;

  const dots: number[] = [];
  for (let i = 0; i < s.length; i++) if (s[i] === '.') dots.push(i);
  // NAV, invested, valuation, profit, profit % — and units, unless a whole balance prints no point
  if (dots.length < 5 || dots[dots.length - 1] !== s.length - 3) return null;
  const [investedDot, valueDot, profitDot] = dots.slice(-4, -1);

  const valueToken = s.slice(investedDot + 3, valueDot + 3);
  const profitToken = s.slice(valueDot + 3, profitDot + 3);
  if (!INDIAN_MONEY.test(valueToken) || !INDIAN_MONEY.test(profitToken)) return null;
  if (!/^-?\d+\.\d{2}$/.test(s.slice(profitDot + 3))) return null;
  const value = toNumber(valueToken);
  const invested = value - toNumber(profitToken);

  // The invested amount runs straight on from the NAV's decimals; valuation − profit
  // says how many of those digits are its own.
  for (let start = investedDot - 1; start > 12; start--) {
    const token = s.slice(start, investedDot + 3);
    if (!/^-?[\d,]+\.\d{2}$/.test(token)) break;
    if (!INDIAN_MONEY.test(token) || Math.abs(toNumber(token) - invested) > 0.02) continue;
    const split = splitUnitsAndNav(s.slice(12, start), value);
    return split ? { isin, ...split, invested: toNumber(token), value } : null;
  }
  return null;
}

/** Scheme names start with their code ("MCDG - Axis Mid Cap…"); header lines before it are dropped. */
function schemeName(parts: string[]): string {
  let start = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[A-Z0-9]{2,6} - /.test(parts[i])) {
      start = i;
      break;
    }
  }
  return joinName(parts.slice(start));
}

function joinName(parts: string[]): string {
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function readFolios(lines: string[]): { holdings: CasFolioHolding[]; unread: number } {
  const holdings: CasFolioHolding[] = [];
  let unread = 0;
  const start = lines.findIndex((line) => /^MUTUAL FUND UNITS HELD AS ON/i.test(line));
  if (start < 0) return { holdings, unread };

  let nameParts: string[] = [];
  let pending: string | null = null;

  for (const raw of lines.slice(start + 1)) {
    const line = raw.replace(SOFT_HYPHEN, '').trim();
    if (!line) continue;
    if (/^Grand Total/i.test(line)) break;

    // A row can wrap: "INF769K01D" / "M9" / "<folio><units>…". Continuations have no spaces.
    const rowStart = pending === null && /^IN[A-Z0-9]*\d/.test(line) && !/\s/.test(line);
    if (pending !== null && !/\s/.test(line)) {
      pending += line;
    } else if (rowStart) {
      pending = line;
    } else {
      if (pending !== null) {
        unread += 1;
        pending = null;
      }
      if (/Loss\s*\(%\)$/i.test(line)) nameParts = [];
      else nameParts.push(line);
      continue;
    }

    const row = readFolioRow(pending);
    if (row) {
      holdings.push({ ...row, name: schemeName(nameParts) });
      nameParts = [];
      pending = null;
    }
  }
  if (pending !== null) unread += 1;

  return { holdings, unread };
}

const within = (a: number, b: number | null) => b !== null && Math.abs(a - b) <= RECONCILE_TOLERANCE;
const sum = (values: number[]) => Math.round(values.reduce((total, v) => total + v, 0) * 100) / 100;

export function parseCdslCas(text: string): ParsedCdslCas {
  const lines = text.split('\n').map((line) => line.trim());
  const asOn = asOnDate(lines);
  const demat = readDemat(lines);
  const folios = readFolios(lines);
  const summary: CasSummary = { demat: demat.portfolioValue, ...readSummary(lines) };

  // A statement with no demat account (or no folios) has no section to add up: it
  // reconciles against 0 rather than failing for a total it never prints.
  const hasDematSection = lines.some((line) => /^HOLDING STATEMENT AS ON/i.test(line));
  const hasFolioSection = lines.some((line) => /^MUTUAL FUND UNITS HELD AS ON/i.test(line));
  const dematExpected =
    summary.demat ??
    (summary.equity !== null && summary.mfDemat !== null && summary.others !== null
      ? summary.equity + summary.mfDemat + summary.others
      : hasDematSection
        ? null
        : 0);
  const folioExpected = summary.mfFolios ?? (hasFolioSection ? null : 0);

  return {
    asOn,
    demat: demat.holdings,
    folios: folios.holdings,
    summary,
    unreadRows: demat.unread + folios.unread,
    reconciled: {
      demat: asOn !== null && within(sum(demat.holdings.map((h) => h.value)), dematExpected),
      folios: asOn !== null && within(sum(folios.holdings.map((h) => h.value)), folioExpected),
    },
  };
}
