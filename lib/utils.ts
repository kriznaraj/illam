import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { NextResponse } from 'next/server';

/**
 * Wrap a JSON response with a Cache-Control header.
 * Use on GET API routes so the browser can serve repeated requests from cache.
 *
 * Presets (chosen for a low-traffic 2-user app):
 *  'static'    — nearly immutable data (categories, account types)  → 10 min / revalidate 1 h
 *  'portfolio' — monthly-updated data                               → 5 min  / revalidate 1 h
 *  'expenses'  — a few writes per day                               → 1 min  / revalidate 5 min
 *  'realtime'  — should not be cached                               → no-store
 */
export function cachedJson(
  data: unknown,
  preset: 'static' | 'portfolio' | 'expenses' | 'realtime' = 'expenses',
  status = 200,
): NextResponse {
  const cc: Record<string, string> = {
    static:    'private, max-age=600,  stale-while-revalidate=3600',
    portfolio: 'private, max-age=300,  stale-while-revalidate=3600',
    expenses:  'private, max-age=60,   stale-while-revalidate=300',
    realtime:  'no-store',
  };
  const res = NextResponse.json(data, { status });
  res.headers.set('Cache-Control', cc[preset]);
  return res;
}

/**
 * Parse a CDSL report period string and return the snapshot date as the
 * first day of the NEXT month. Safe to call from both client and server.
 *
 * Examples:
 *   "Dec 2025"    → "2026-01-01"
 *   "November 2025" → "2025-12-01"
 *   "2025-12"     → "2026-01-01"
 *   "2025-12-01"  → "2026-01-01"
 *   "31-12-2025"  → "2026-01-01"  (DD-MM-YYYY)
 */
export function deriveSnapshotDate(dateStr: string): string | null {
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  const s = (dateStr ?? '').trim().toLowerCase();
  if (!s) return null;

  // "Dec 2025" / "December 2025"
  const m1 = s.match(/^([a-z]+)\s+(\d{4})$/);
  if (m1) {
    const mon = MONTHS[m1[1]];
    const yr = parseInt(m1[2]);
    if (mon && !isNaN(yr)) return _nextMonthFirst(yr, mon);
  }

  // "2025-12" or "2025-12-01" or "2025-12-31"
  const m2 = s.match(/^(\d{4})-(\d{2})/);
  if (m2) {
    const yr = parseInt(m2[1]);
    const mon = parseInt(m2[2]);
    if (!isNaN(yr) && mon >= 1 && mon <= 12) return _nextMonthFirst(yr, mon);
  }

  // "31-12-2025" or "1-12-2025" (DD-MM-YYYY)
  const m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m3) {
    const mon = parseInt(m3[2]);
    const yr = parseInt(m3[3]);
    if (!isNaN(yr) && mon >= 1 && mon <= 12) return _nextMonthFirst(yr, mon);
  }

  return null;
}

function _nextMonthFirst(year: number, month: number): string {
  const nextMon = month === 12 ? 1 : month + 1;
  const nextYr = month === 12 ? year + 1 : year;
  return `${nextYr}-${String(nextMon).padStart(2, '0')}-01`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Compact Indian-style currency: ₹75.43L, ₹2.5Cr, ₹45K.
 * Negatives are prefixed with −: −₹49.38L.
 */
export function formatCompactCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000)    return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000)       return `${sign}₹${(abs / 1_000).toFixed(2)}K`;
  return `${sign}₹${abs.toFixed(2)}`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'dd MMM yyyy');
}

export function formatMonth(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM yyyy');
}

export function getCurrentMonthString(): string {
  return format(new Date(), 'MMMM yyyy');
}

export function classNames(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Logs API/Supabase errors without dumping large HTML bodies into the console.
 * Supabase returns HTML (e.g. Cloudflare 5xx pages) as error.message on network
 * failures, which makes logs unreadable.
 */
export function logApiError(label: string, err: unknown): void {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const code = e.code ?? e.status ?? '';
    const msg = typeof e.message === 'string' ? e.message.slice(0, 200) : String(err).slice(0, 200);
    console.error(label, ...[code, msg].filter(Boolean));
  } else {
    console.error(label, String(err).slice(0, 200));
  }
}
