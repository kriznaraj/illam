/**
 * Display decisions for an insight card, kept out of the component so they can be
 * tested. Two shipped defects lived in this logic:
 *
 * 1. The card guarded on `value !== undefined`, but the AI wire schema declares `value`
 *    and `change` as `.nullable()`. A `null` passed the guard and reached
 *    `formatCurrency(null)` and `change.toFixed(1)`.
 * 2. Severity was indexed straight into a style map with no fallback, so portfolio
 *    insights — which shipped with no `severity` at all — rendered as
 *    `class="card undefined border-2"`.
 */

import type { InsightSeverity } from '@/types';

export const SEVERITY_TONES: Record<InsightSeverity, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  danger: 'bg-red-50 border-red-200 text-red-900',
  success: 'bg-green-50 border-green-200 text-green-900',
};

export const SEVERITY_ICON_TONES: Record<InsightSeverity, string> = {
  info: 'bg-blue-100',
  warning: 'bg-amber-100',
  danger: 'bg-red-100',
  success: 'bg-green-100',
};

/** More spend is bad, so a positive change reads red and a negative one green. */
export const CHANGE_TONES = {
  positive: 'text-red-600',
  negative: 'text-green-600',
} as const;

export interface InsightCardDisplay {
  tone: string;
  iconTone: string;
  showValue: boolean;
  showChange: boolean;
  changeTone: string;
}

export function resolveInsightCardDisplay(input: {
  severity: InsightSeverity | undefined | null;
  value: number | null | undefined;
  change: number | null | undefined;
}): InsightCardDisplay {
  // Unknown severity falls back rather than interpolating `undefined` into a class list.
  const severity = input.severity && input.severity in SEVERITY_TONES ? input.severity : 'info';
  // `!= null` on purpose: null means absent, but 0 is a real figure worth showing.
  const showValue = input.value != null;
  const showChange = input.change != null;

  return {
    tone: SEVERITY_TONES[severity],
    iconTone: SEVERITY_ICON_TONES[severity],
    showValue,
    showChange,
    changeTone: (input.change ?? 0) > 0 ? CHANGE_TONES.positive : CHANGE_TONES.negative,
  };
}
