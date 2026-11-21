import { describe, expect, it } from 'vitest';
import {
  CHANGE_TONES,
  SEVERITY_TONES,
  resolveInsightCardDisplay,
} from '@/lib/insights/cardDisplay';

describe('resolveInsightCardDisplay', () => {
  it('treats null as absent, so formatCurrency/toFixed are never reached', () => {
    // The AI wire schema returns `value: null`; the old `!== undefined` guard let it through.
    const d = resolveInsightCardDisplay({ severity: 'warning', value: null, change: null });
    expect(d.showValue).toBe(false);
    expect(d.showChange).toBe(false);
  });

  it('shows zero, which is a real figure rather than an absent one', () => {
    const d = resolveInsightCardDisplay({ severity: 'info', value: 0, change: 0 });
    expect(d.showValue).toBe(true);
    expect(d.showChange).toBe(true);
  });

  it('shows a genuine value and change', () => {
    const d = resolveInsightCardDisplay({ severity: 'warning', value: 59969, change: 12.5 });
    expect(d.showValue).toBe(true);
    expect(d.showChange).toBe(true);
  });

  it('falls back to info styling instead of emitting "undefined" into the class list', () => {
    // Portfolio insights shipped with no severity at all: `class="card undefined border-2"`.
    for (const bad of [undefined, null, 'critical' as never]) {
      const d = resolveInsightCardDisplay({ severity: bad, value: 1, change: 1 });
      expect(d.tone).toBe(SEVERITY_TONES.info);
      expect(d.tone).not.toContain('undefined');
      expect(d.iconTone).not.toContain('undefined');
    }
  });

  it('keeps every declared severity distinct', () => {
    const tones = (['danger', 'warning', 'info', 'success'] as const).map(
      (s) => resolveInsightCardDisplay({ severity: s, value: null, change: null }).tone
    );
    expect(new Set(tones).size).toBe(4);
  });

  it('colours more spend red and less spend green', () => {
    expect(resolveInsightCardDisplay({ severity: 'info', value: 1, change: 5 }).changeTone).toBe(
      CHANGE_TONES.positive
    );
    expect(resolveInsightCardDisplay({ severity: 'info', value: 1, change: -5 }).changeTone).toBe(
      CHANGE_TONES.negative
    );
  });
});
