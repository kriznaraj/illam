import { describe, it, expect } from 'vitest';
import {
  applySipAmountChange,
  applySipAmountCorrection,
  describeAmountHistory,
  getSipStartMonth,
  normalizeAmountHistory,
  resolveSipAmount,
  setSipStartMonth,
} from '../sipSchedule';
import { INVESTMENT_START_MONTH } from '../constants';

const CURRENT = '2026-08';

describe('resolveSipAmount', () => {
  it('uses the flat amount when the fund has no history', () => {
    // Every existing fund is in this shape — behaviour must not change.
    expect(resolveSipAmount({ sip_amount: 3000 }, '2025-06')).toBe(3000);
    expect(resolveSipAmount({ sip_amount: 3000 }, '2026-08')).toBe(3000);
  });

  it('returns 0 for a missing or zero amount', () => {
    expect(resolveSipAmount({ sip_amount: 0 }, CURRENT)).toBe(0);
    expect(resolveSipAmount({}, CURRENT)).toBe(0);
    expect(resolveSipAmount(null, CURRENT)).toBe(0);
  });

  it('bills each month at the amount in effect that month', () => {
    // The reported case: ₹3,000/month, raised to ₹5,000 from April 2026.
    const fund = {
      sip_amount: 5000,
      amount_history: [
        { from_month: '2025-04', amount: 3000 },
        { from_month: '2026-04', amount: 5000 },
      ],
    };

    expect(resolveSipAmount(fund, '2025-06')).toBe(3000);
    expect(resolveSipAmount(fund, '2026-03')).toBe(3000);
    expect(resolveSipAmount(fund, '2026-04')).toBe(5000);
    expect(resolveSipAmount(fund, '2026-08')).toBe(5000);
  });

  it('treats from_month as inclusive', () => {
    const fund = { sip_amount: 5000, amount_history: [{ from_month: '2026-04', amount: 5000 }] };
    expect(resolveSipAmount(fund, '2026-04')).toBe(5000);
  });

  it('contributes nothing before the first entry — the fund was not running yet', () => {
    // The first entry doubles as the fund's start month, so a SIP added today
    // does not back-fill months it never ran in.
    const fund = {
      sip_amount: 5000,
      amount_history: [
        { from_month: '2025-04', amount: 3000 },
        { from_month: '2026-04', amount: 5000 },
      ],
    };
    expect(resolveSipAmount(fund, '2024-01')).toBe(0);
  });

  it('handles several increases', () => {
    const fund = {
      sip_amount: 8000,
      amount_history: [
        { from_month: '2025-04', amount: 3000 },
        { from_month: '2026-04', amount: 5000 },
        { from_month: '2026-07', amount: 8000 },
      ],
    };
    expect(resolveSipAmount(fund, '2026-03')).toBe(3000);
    expect(resolveSipAmount(fund, '2026-06')).toBe(5000);
    expect(resolveSipAmount(fund, '2026-07')).toBe(8000);
  });

  it('reads an unsorted history correctly', () => {
    const fund = {
      sip_amount: 5000,
      amount_history: [
        { from_month: '2026-04', amount: 5000 },
        { from_month: '2025-04', amount: 3000 },
      ],
    };
    expect(resolveSipAmount(fund, '2025-09')).toBe(3000);
    expect(resolveSipAmount(fund, '2026-05')).toBe(5000);
  });

  it('falls back to the flat amount for a malformed month', () => {
    const fund = { sip_amount: 5000, amount_history: [{ from_month: '2025-04', amount: 3000 }] };
    expect(resolveSipAmount(fund, 'garbage')).toBe(5000);
  });
});

describe('normalizeAmountHistory', () => {
  it('sorts ascending', () => {
    const out = normalizeAmountHistory([
      { from_month: '2026-04', amount: 5000 },
      { from_month: '2025-04', amount: 3000 },
    ]);
    expect(out.map((e) => e.from_month)).toEqual(['2025-04', '2026-04']);
  });

  it('drops malformed months and non-positive amounts', () => {
    const out = normalizeAmountHistory([
      { from_month: '2025-13', amount: 100 },
      { from_month: 'nope', amount: 100 },
      { from_month: '2025-04', amount: 0 },
      { from_month: '2025-05', amount: -50 },
      { from_month: '2025-06', amount: 3000 },
    ]);
    expect(out).toEqual([{ from_month: '2025-06', amount: 3000 }]);
  });

  it('keeps one entry per month, last write winning', () => {
    const out = normalizeAmountHistory([
      { from_month: '2026-04', amount: 4000 },
      { from_month: '2026-04', amount: 5000 },
    ]);
    expect(out).toEqual([{ from_month: '2026-04', amount: 5000 }]);
  });

  it('returns empty for a non-array', () => {
    expect(normalizeAmountHistory(undefined)).toEqual([]);
    expect(normalizeAmountHistory('nope')).toEqual([]);
  });
});

describe('applySipAmountChange', () => {
  it('pins the old amount to the past and the new one from the chosen month', () => {
    const fund = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );

    expect(fund.amount_history).toEqual([
      { from_month: INVESTMENT_START_MONTH, amount: 3000 },
      { from_month: '2026-04', amount: 5000 },
    ]);
    expect(resolveSipAmount(fund, '2026-03')).toBe(3000);
    expect(resolveSipAmount(fund, '2026-04')).toBe(5000);
  });

  it('keeps sip_amount mirroring the amount in effect today', () => {
    const fund = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );
    expect(fund.sip_amount).toBe(5000);
  });

  it('does not let a future-dated change move the current amount', () => {
    // Scheduling October's raise in August must not inflate August.
    const fund = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-10', currentMonth: CURRENT }
    );
    expect(fund.sip_amount).toBe(3000);
    expect(resolveSipAmount(fund, '2026-09')).toBe(3000);
    expect(resolveSipAmount(fund, '2026-10')).toBe(5000);
  });

  it('layers a second change onto an existing history', () => {
    const first = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );
    const second = applySipAmountChange(first, {
      amount: 8000,
      fromMonth: '2026-07',
      currentMonth: CURRENT,
    });

    expect(resolveSipAmount(second, '2026-03')).toBe(3000);
    expect(resolveSipAmount(second, '2026-05')).toBe(5000);
    expect(resolveSipAmount(second, '2026-08')).toBe(8000);
  });

  it('replaces an entry when the same effective month is set again', () => {
    const first = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );
    const corrected = applySipAmountChange(first, {
      amount: 6000,
      fromMonth: '2026-04',
      currentMonth: CURRENT,
    });

    expect(corrected.amount_history).toEqual([
      { from_month: INVESTMENT_START_MONTH, amount: 3000 },
      { from_month: '2026-04', amount: 6000 },
    ]);
  });

  it('drops entries at or after the new effective month', () => {
    const first = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );
    // Re-dating the change earlier should not leave the later entry stranded.
    const rewound = applySipAmountChange(first, {
      amount: 7000,
      fromMonth: '2026-02',
      currentMonth: CURRENT,
    });

    expect(rewound.amount_history).toEqual([
      { from_month: INVESTMENT_START_MONTH, amount: 3000 },
      { from_month: '2026-02', amount: 7000 },
    ]);
    expect(resolveSipAmount(rewound, '2026-05')).toBe(7000);
  });

  it('ignores a zero or malformed change', () => {
    const fund = { sip_amount: 3000 };
    expect(applySipAmountChange(fund, { amount: 0, fromMonth: '2026-04', currentMonth: CURRENT })).toBe(fund);
    expect(applySipAmountChange(fund, { amount: 5000, fromMonth: 'nope', currentMonth: CURRENT })).toBe(fund);
  });

  it('starts a history from scratch for a fund with no prior amount', () => {
    // A brand-new fund starting in April must not appear in March.
    const fund = applySipAmountChange(
      { sip_amount: 0 },
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );
    expect(fund.amount_history).toEqual([{ from_month: '2026-04', amount: 5000 }]);
    expect(resolveSipAmount(fund, '2026-03')).toBe(0);
    expect(resolveSipAmount(fund, '2026-04')).toBe(5000);
  });

  it('keeps an already-running fund billing the old amount in past months', () => {
    const fund = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );
    // Seeded at INVESTMENT_START_MONTH, so nothing in range resolves to zero.
    expect(resolveSipAmount(fund, INVESTMENT_START_MONTH)).toBe(3000);
    expect(resolveSipAmount(fund, '2025-12')).toBe(3000);
  });

  it('leaves other fund properties untouched', () => {
    const fund = applySipAmountChange(
      { sip_amount: 3000, name: 'Parag Flexi', sip_date: '20th' } as any,
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );
    expect(fund).toMatchObject({ name: 'Parag Flexi', sip_date: '20th' });
  });
});

describe('applySipAmountCorrection', () => {
  it('applies the amount to every month and clears the history', () => {
    const changed = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-04', currentMonth: CURRENT }
    );
    const corrected = applySipAmountCorrection(changed, 4000);

    expect(corrected.amount_history).toBeUndefined();
    expect(resolveSipAmount(corrected, '2025-06')).toBe(4000);
    expect(resolveSipAmount(corrected, '2026-08')).toBe(4000);
  });
});

describe('describeAmountHistory', () => {
  it('lists changes newest first', () => {
    const fund = {
      sip_amount: 8000,
      amount_history: [
        { from_month: '2025-04', amount: 3000 },
        { from_month: '2026-04', amount: 5000 },
      ],
    };
    expect(describeAmountHistory(fund).map((e) => e.from_month)).toEqual(['2026-04', '2025-04']);
  });

  it('is empty for a fund with no history', () => {
    expect(describeAmountHistory({ sip_amount: 3000 })).toEqual([]);
  });
});

describe('getSipStartMonth', () => {
  it('is the first entry in the timeline', () => {
    expect(
      getSipStartMonth({
        sip_amount: 5000,
        amount_history: [
          { from_month: '2026-01', amount: 3000 },
          { from_month: '2026-06', amount: 5000 },
        ],
      })
    ).toBe('2026-01');
  });

  it('is null for a fund with no history', () => {
    expect(getSipStartMonth({ sip_amount: 3000 })).toBeNull();
    expect(getSipStartMonth(null)).toBeNull();
  });
});

describe('setSipStartMonth', () => {
  it('makes months before the start resolve to nothing', () => {
    const fund = setSipStartMonth(
      { sip_amount: 3000 },
      { startMonth: '2026-02', currentMonth: CURRENT }
    );

    expect(resolveSipAmount(fund, '2026-01')).toBe(0);
    expect(resolveSipAmount(fund, '2026-02')).toBe(3000);
    expect(resolveSipAmount(fund, CURRENT)).toBe(3000);
  });

  it('trims a seeded history back to the real start', () => {
    // A fund that got seeded at INVESTMENT_START_MONTH but only began later.
    const changed = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-06', currentMonth: CURRENT }
    );
    const started = setSipStartMonth(changed, {
      startMonth: '2026-02',
      currentMonth: CURRENT,
    });

    expect(started.amount_history).toEqual([
      { from_month: '2026-02', amount: 3000 },
      { from_month: '2026-06', amount: 5000 },
    ]);
    expect(resolveSipAmount(started, '2026-01')).toBe(0);
    expect(resolveSipAmount(started, '2026-03')).toBe(3000);
  });

  it('preserves a raise recorded after the start month', () => {
    const changed = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-06', currentMonth: CURRENT }
    );
    const started = setSipStartMonth(changed, {
      startMonth: '2026-02',
      currentMonth: CURRENT,
    });

    expect(resolveSipAmount(started, '2026-07')).toBe(5000);
    expect(started.sip_amount).toBe(5000);
  });

  it('carries the amount running at the new start month', () => {
    const changed = applySipAmountChange(
      { sip_amount: 3000 },
      { amount: 5000, fromMonth: '2026-06', currentMonth: CURRENT }
    );
    // Starting *after* the raise: the fund began at the newer amount.
    const started = setSipStartMonth(changed, {
      startMonth: '2026-07',
      currentMonth: CURRENT,
    });

    expect(started.amount_history).toEqual([{ from_month: '2026-07', amount: 5000 }]);
    expect(resolveSipAmount(started, '2026-06')).toBe(0);
    expect(resolveSipAmount(started, '2026-07')).toBe(5000);
  });

  it('can move a start month earlier without inventing a gap', () => {
    const started = setSipStartMonth(
      { sip_amount: 3000, amount_history: [{ from_month: '2026-06', amount: 5000 }] },
      { startMonth: '2026-03', currentMonth: CURRENT }
    );

    expect(resolveSipAmount(started, '2026-02')).toBe(0);
    expect(resolveSipAmount(started, '2026-03')).toBe(5000);
    expect(resolveSipAmount(started, '2026-06')).toBe(5000);
  });

  it('is reported back by getSipStartMonth', () => {
    const fund = setSipStartMonth(
      { sip_amount: 3000 },
      { startMonth: '2026-02', currentMonth: CURRENT }
    );
    expect(getSipStartMonth(fund)).toBe('2026-02');
  });

  it('ignores a malformed month', () => {
    const fund = { sip_amount: 3000 };
    expect(setSipStartMonth(fund, { startMonth: 'nope', currentMonth: CURRENT })).toBe(fund);
  });

  it('leaves other fund properties untouched', () => {
    const fund = setSipStartMonth(
      { sip_amount: 3000, name: 'Bandhan Small Cap', sip_date: '11th' } as any,
      { startMonth: '2026-02', currentMonth: CURRENT }
    );
    expect(fund).toMatchObject({ name: 'Bandhan Small Cap', sip_date: '11th' });
  });
});
