/**
 * Rupee formatting for insight *descriptions*.
 *
 * Deliberately separate from `lib/utils.formatCurrency`, which is a UI helper.
 * These strings are baked into cached JSONB and read as prose, so they favour
 * Indian grouping and lakh/crore shorthand over decimals.
 */

export function inr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/** ₹23,60,000 → "₹23.6L"; ₹2,36,09,915 → "₹2.36Cr". For headline figures only. */
export function inrShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

export function pct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

/** "Sep 2025, Oct 2025 and Nov 2025" */
export function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "3 months" / "1 month" */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
