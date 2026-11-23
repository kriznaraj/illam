import { NextResponse } from 'next/server';
import pdfParse from 'pdf-parse';
import { getProvider, isAIEnabled } from '@/lib/ai';
import { HoldingsExtractionSchema } from '@/lib/ai/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ParsedRow = {
  name: string;
  symbol: string;
  identifier: string;
  quantity: number;
  unitPrice: number | '';
  value: number;
  date: string; // e.g. "Feb 2026"
  accountType: 'stock' | 'mf';
};

function csvEscape(v: string): string {
  if (v.includes('"') || v.includes(',') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function toNumber(raw: string): number {
  return Number(String(raw).replace(/,/g, ''));
}

function extractNumberStrings(raw: string): string[] {
  return String(raw).match(/[\d,]+(?:\.\d+)?/g) ?? [];
}

function monthLabelFromDdMmYyyy(ddmmyyyy: string): { monthLabel: string; isoDate: string } | null {
  const m = ddmmyyyy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!dd || !mm || !yyyy) return null;
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  const monthLabel = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); // "Feb 2026"
  const isoDate = `${yyyy.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`;
  return { monthLabel, isoDate };
}

function parseCdslCasTextToRows(text: string): { rows: ParsedRow[]; asOn?: string; period?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const asOnMatch =
    lines.find((l) => /HOLDING STATEMENT AS ON \d{2}-\d{2}-\d{4}/i.test(l))?.match(/(\d{2}-\d{2}-\d{4})/) ??
    lines.find((l) => /MUTUAL FUND UNITS HELD AS ON \d{2}-\d{2}-\d{4}/i.test(l))?.match(/(\d{2}-\d{2}-\d{4})/);
  const asOn = asOnMatch?.[1];
  const month = asOn ? monthLabelFromDdMmYyyy(asOn) : null;
  const dateLabel = month?.monthLabel ?? 'Unknown';

  const periodLine = lines.find((l) => /STATEMENT FOR THE PERIOD FROM/i.test(l));
  const period = periodLine ?? undefined;

  const rows: ParsedRow[] = [];
  const ISIN_RE = /\bIN[A-Z0-9]{10}\b/;

  // ── Demat holdings section ──
  let inHoldings = false;
  let inMfUnits = false;
  let cur: { isin: string; nameParts: string[] } | null = null;

  const parseHoldingNumbersFromRaw = (
    raw: string,
  ): { quantity: number; unitPrice: number | ''; value: number } | null => {
    // Many CDSL PDFs compress columns so that FreeBal + UnitPrice + Value get concatenated:
    // e.g. "6.000------6.0008125.50048,753.00"
    // We parse the tail (after dashes) as:
    //   <qty><unit_int>.<unit_dec3><value_int>.<value_dec2>
    const tail = String(raw).split(/-+/).pop() ?? String(raw);
    const s = tail.replace(/\s+/g, '').replace(/[^0-9.,]/g, '');

    // Parse the concatenated tail from the RIGHT:
    //   <qty><unitPrice><value>
    // where unitPrice is like "8125.500" and value is like "48,753.00".
    const valuePattern = '(?:\\d{1,3}(?:,\\d{2})*(?:,\\d{3})+\\.\\d{2}|\\d+\\.\\d{2})';
    const m =
      s.match(new RegExp(`^(?:\\d+\\.\\d{3})+(\\d+\\.\\d{3})(\\d+\\.\\d{3})(${valuePattern})$`)) ??
      s.match(new RegExp(`^(\\d+\\.\\d{3})(\\d+\\.\\d{3})(${valuePattern})$`));
    if (!m) return null;
    const quantity = toNumber(m[1]);
    const unitPrice = toNumber(m[2]);
    const value = toNumber(m[3]);
    return {
      quantity: Number.isNaN(quantity) ? 0 : quantity,
      unitPrice: Number.isNaN(unitPrice) ? ('' as const) : unitPrice,
      value,
    };
  };

  const flushHoldingFromLine = (line: string) => {
    if (!cur) return;
    const name = cur.nameParts.join(' ').replace(/\s+/g, ' ').trim();
    const nums = parseHoldingNumbersFromRaw(line);
    if (!name || !cur.isin || !nums || Number.isNaN(nums.value)) return;
    rows.push({
      name,
      symbol: '',
      identifier: cur.isin,
      quantity: nums.quantity,
      unitPrice: nums.unitPrice,
      value: nums.value,
      date: dateLabel,
      accountType: 'stock',
    });
    cur = null;
  };

  // ── MF units section ──
  let mfNameParts: string[] = [];
  let pendingMfIsinPrefix = '';
  const tryParseMfLine = (raw: string) => {
    const compact = String(raw).replace(/\s+/g, '').replace(/[^0-9A-Za-z/.,]/g, '');
    const money = '(?:\\d{1,3}(?:,\\d{2})*(?:,\\d{3})+\\.\\d{2}|\\d+\\.\\d{2})';
    const mIsin = compact.match(/^(IN[A-Z0-9]{10})/);
    if (!mIsin) return null;
    const isin = mIsin[1];
    const rest = compact.slice(isin.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx < 0) return null;
    const afterSlash = rest.slice(slashIdx + 1);
    const suffixLen = afterSlash.startsWith('0') ? 1 : 2;
    const payload = afterSlash.slice(suffixLen);

    const re = new RegExp(`^(\\d+\\.\\d{3})(\\d+\\.\\d{2,4})(${money})(${money})`);
    const m = payload.match(re);
    if (!m) return null;
    return {
      isin,
      units: toNumber(m[1]),
      nav: toNumber(m[2]),
      valuation: toNumber(m[4]),
    };
  };

  const isMfHeaderLine = (l: string) => {
    const alpha = String(l).toLowerCase().replace(/[^a-z]/g, '');
    return (
      alpha.startsWith('schemename') ||
      alpha === 'closing' ||
      alpha === 'bal' ||
      alpha === 'units' ||
      alpha === 'amount' ||
      alpha === 'inr' ||
      alpha.startsWith('unreali') ||
      alpha === 'sed' ||
      alpha.includes('folio') ||
      alpha.includes('nav') ||
      alpha.includes('valuation') ||
      alpha.includes('unrealised') ||
      alpha.includes('profit') ||
      alpha.includes('loss') ||
      alpha.includes('cumulative') ||
      alpha.includes('invested')
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/HOLDING STATEMENT AS ON \d{2}-\d{2}-\d{4}/i.test(line)) {
      inHoldings = true;
      inMfUnits = false;
      cur = null;
      continue;
    }
    if (/MUTUAL FUND UNITS HELD AS ON \d{2}-\d{2}-\d{4}/i.test(line)) {
      inMfUnits = true;
      inHoldings = false;
      cur = null;
      mfNameParts = [];
      pendingMfIsinPrefix = '';
      continue;
    }

    if (inHoldings) {
      // Skip table headers / noise
      if (/^page \d+/i.test(line)) continue;
      if (/^isin security/i.test(line)) continue;
      if (/^isin\b/i.test(line) && /value/i.test(line)) continue;
      if (/^-- \d+ of/i.test(line)) continue;
      if (/^no transaction during the period/i.test(line)) continue;

      const m = line.match(new RegExp(`^(${ISIN_RE.source})\\s+(.*)$`));
      if (m) {
        const isin = m[1];
        const rest = m[2] ?? '';
        // Some PDFs put ISIN + name on the same line; numbers are often on following lines.
        // Otherwise start multi-line entry; rest is part of the name.
        cur = { isin, nameParts: rest ? [rest] : [] };
        continue;
      }

      // Some PDFs put the ISIN on its own line and the security name on following lines.
      if (ISIN_RE.test(line) && line.split(' ').length === 1) {
        cur = { isin: line.trim(), nameParts: [] };
        continue;
      }

      if (cur) {
        // numeric line includes balances + market price + value
        const hasNums = extractNumberStrings(line).length >= 3;
        if (hasNums) {
          flushHoldingFromLine(line);
          if (cur) cur.nameParts.push(line);
        } else {
          cur.nameParts.push(line);
        }
      }
      continue;
    }

    if (inMfUnits) {
      if (/^page \d+/i.test(line)) continue;
      if (isMfHeaderLine(line)) continue;
      if (/^isin\b/i.test(line) && /folio/i.test(line)) continue;
      if (/^-- \d+ of/i.test(line)) continue;
      if (/^load structures/i.test(line)) break; // end of useful MF table
      if (/^IN[A-Z0-9]{8,10}$/i.test(line)) {
        pendingMfIsinPrefix = line.trim();
        continue;
      }
      const mergedLine = pendingMfIsinPrefix ? pendingMfIsinPrefix + line : line;
      pendingMfIsinPrefix = '';
      const details = tryParseMfLine(mergedLine);
      if (details) {
        const name = mfNameParts.join(' ').replace(/\s+/g, ' ').trim();
        if (name && !Number.isNaN(details.valuation)) {
          rows.push({
            name,
            symbol: '',
            identifier: details.isin,
            quantity: Number.isNaN(details.units) ? 0 : details.units,
            unitPrice: Number.isNaN(details.nav) ? '' : details.nav,
            value: details.valuation,
            date: dateLabel,
            accountType: 'mf',
          });
        }
        mfNameParts = [];
      } else {
        let cleaned = line;
        const idx = cleaned.search(/\b[A-Z0-9]{2,5}\s*-\s*/);
        if (idx > 0) cleaned = cleaned.slice(idx);
        if (/[A-Za-z]/.test(cleaned)) mfNameParts.push(cleaned);
      }
      continue;
    }
  }

  return { rows, asOn, period };
}

/**
 * Read the PDF with Claude instead of the regex parser below.
 *
 * The regex parser hardcodes decimal-place counts and English section headings, and drops
 * a row silently when a number does not match its expected shape. This path asks the model
 * to read the tables directly. It returns null on any failure so the caller can fall back.
 */
async function extractWithClaude(
  buf: Buffer,
): Promise<{ rows: ParsedRow[]; asOn: string } | null> {
  const result = await getProvider().complete({
    task: 'extract-holdings',
    schema: HoldingsExtractionSchema,
    schemaName: 'holdings_extraction',
    system:
      'You read CDSL Consolidated Account Statement (CAS) PDFs and return every holding. ' +
      'Amounts are in rupees. Include every row in both the demat holdings table and the ' +
      'mutual fund units table. Never omit a holding because a number looks unusual.',
    prompt:
      'Extract all holdings from this CDSL statement. Use kind="stock" for demat equity ' +
      'holdings and kind="mf" for mutual fund units. `value` is the current market value ' +
      'of the holding. Report `statementDate` as the "as on" date in yyyy-MM-dd.',
    documents: [{ mediaType: 'application/pdf', base64: buf.toString('base64') }],
  });

  if (!result.ok || result.data.holdings.length === 0) return null;

  // "Feb 2026" — the format the downstream importer's date parser expects.
  const asOn = result.data.statementDate
    ? new Date(result.data.statementDate + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      })
    : '';

  return {
    asOn,
    rows: result.data.holdings.map((h) => ({
      name: h.name,
      symbol: '',
      identifier: h.identifier,
      quantity: h.quantity,
      unitPrice: h.unitPrice ?? '',
      value: h.value,
      date: asOn,
      accountType: h.kind,
    })),
  };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'Missing PDF file.' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ ok: false, error: 'File must be a PDF.' }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // auto  — try Claude, fall back to the regex parser on any failure (default)
    // claude — Claude only; report the failure instead of falling back
    // regex  — the original parser only
    const mode = (process.env.CDSL_PARSER ?? 'auto').toLowerCase();

    let rows: ParsedRow[] = [];
    // Optional, matching parseCdslCasTextToRows — the response omits them when absent,
    // which is what the import UI already expects.
    let asOn: string | undefined;
    let period: string | undefined;
    let parser: 'claude' | 'regex' = 'regex';

    if ((mode === 'auto' || mode === 'claude') && isAIEnabled()) {
      const viaClaude = await extractWithClaude(buf);
      if (viaClaude) {
        rows = viaClaude.rows;
        asOn = viaClaude.asOn;
        parser = 'claude';
      } else if (mode === 'claude') {
        return NextResponse.json(
          { ok: false, error: 'Claude could not read this statement and CDSL_PARSER=claude disables the regex fallback.' },
          { status: 422 },
        );
      }
    }

    // Fallback (and the default path when AI is unconfigured): the original regex parser.
    if (rows.length === 0 && mode !== 'claude') {
      const parsed = await pdfParse(buf);
      const viaRegex = parseCdslCasTextToRows(parsed.text || '');
      rows = viaRegex.rows;
      asOn = viaRegex.asOn;
      period = viaRegex.period;
      parser = 'regex';
    }

    if (!rows.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Could not find holdings tables in this PDF. Make sure it is a CDSL CAS PDF that includes "HOLDING STATEMENT AS ON" and/or "MUTUAL FUND UNITS HELD AS ON".',
        },
        { status: 422 },
      );
    }

    const header = ['Name', 'Symbol', 'Identifier', 'Quantity', 'Unit Price', 'Value', 'Date', 'Account Type'];
    const csvLines = [
      header.join(','),
      ...rows.map((r) =>
        [
          csvEscape(r.name),
          csvEscape(r.symbol ?? ''),
          csvEscape(r.identifier ?? ''),
          String(r.quantity ?? ''),
          r.unitPrice === '' ? '' : String(r.unitPrice),
          String(r.value ?? ''),
          csvEscape(r.date ?? ''),
          csvEscape(r.accountType ?? ''),
        ].join(','),
      ),
    ];

    return NextResponse.json({
      ok: true,
      rows: rows.length,
      asOn,
      period,
      /** Which parser produced these rows, so the UI can say so. */
      parser,
      csv: csvLines.join('\n'),
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Failed to convert PDF.' }, { status: 500 });
  }
}

