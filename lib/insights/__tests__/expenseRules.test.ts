import { describe, expect, it } from 'vitest';
import {
  buildExpenseInsights,
  prepareExpenseData,
  MAX_ANOMALIES,
  MIN_DELTA_RUPEES,
  type ExpenseRow,
} from '@/lib/insights/expenseRules';

/**
 * These tests pin the behaviour that made the previous engine unusable, using the
 * shapes that actually occurred in this household's data:
 *
 *  - a ₹495 category spike reported as a warning inside a ₹2,04,854 month
 *  - a ₹1.4L renovation never mentioned, because it was "only" one category
 *  - "excellent spending control" awarded to a month with 9 logged transactions
 *  - achievements handed out mid-month on a partial total
 */

let nextId = 0;
function row(over: Partial<ExpenseRow> & { date: string; amount: number }): ExpenseRow {
  return {
    id: `e${nextId++}`,
    categoryId: 'cat-groceries',
    categoryName: 'Groceries',
    groupName: 'Need',
    budget: null,
    description: '',
    ...over,
  };
}

/** `count` evenly spread transactions totalling `total` in the given month. */
function monthOf(monthKey: string, count: number, total: number, over: Partial<ExpenseRow> = {}): ExpenseRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({ date: `${monthKey}-${String((i % 27) + 1).padStart(2, '0')}`, amount: total / count, ...over })
  );
}

/** Twelve well-logged months of ~₹60,000 running costs. */
function healthyHistory(): ExpenseRow[] {
  const months = [
    '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01',
    '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
  ];
  return months.flatMap((m) => [
    ...monthOf(m, 40, 40_000, { categoryId: 'cat-groceries', categoryName: 'Groceries' }),
    ...monthOf(m, 20, 20_000, { categoryId: 'cat-dining', categoryName: 'Dining Out', groupName: 'Want' }),
  ]);
}

const ids = (rows: ReturnType<typeof buildExpenseInsights>) => rows.map((i) => i.id);

describe('materiality gate', () => {
  it('suppresses a large-percentage, small-rupee category spike', () => {
    // Eggs: ₹265/month historically, ₹495 this month. +87%, but +₹230.
    const rows = [
      ...healthyHistory(),
      ...monthOf('2026-08', 40, 40_000),
      ...monthOf('2026-08', 20, 20_000, { categoryId: 'cat-dining', categoryName: 'Dining Out', groupName: 'Want' }),
      ...['2026-05', '2026-06', '2026-07'].flatMap((m) =>
        monthOf(m, 2, 265, { categoryId: 'cat-eggs', categoryName: 'Eggs' })
      ),
      ...monthOf('2026-08', 2, 495, { categoryId: 'cat-eggs', categoryName: 'Eggs' }),
    ];

    const insights = buildExpenseInsights(
      prepareExpenseData({ rows, analysisMonthKey: '2026-08', todayAppDate: '2026-09-15' })
    );

    expect(ids(insights)).not.toContain('anomaly-cat-eggs');
  });

  it('keeps a spike that clears the rupee floor', () => {
    const rows = [
      ...healthyHistory(),
      ...monthOf('2026-08', 40, 40_000),
      ...monthOf('2026-08', 20, 20_000, { categoryId: 'cat-dining', categoryName: 'Dining Out', groupName: 'Want' }),
      ...['2026-05', '2026-06', '2026-07'].flatMap((m) =>
        monthOf(m, 2, 4_000, { categoryId: 'cat-health', categoryName: 'Healthcare' })
      ),
      ...monthOf('2026-08', 2, 30_000, { categoryId: 'cat-health', categoryName: 'Healthcare' }),
    ];

    const insights = buildExpenseInsights(
      prepareExpenseData({ rows, analysisMonthKey: '2026-08', todayAppDate: '2026-09-15' })
    );

    const spike = insights.find((i) => i.id === 'anomaly-cat-health');
    expect(spike).toBeDefined();
    expect(spike!.severity).toBe('warning');
    expect(spike!.weight).toBeGreaterThan(MIN_DELTA_RUPEES);
  });

  it('emits at most MAX_ANOMALIES category cards, keeping the largest by rupees', () => {
    const movers = ['a', 'b', 'c', 'd', 'e', 'f'];
    const rows = [
      ...healthyHistory(),
      ...monthOf('2026-08', 40, 40_000),
      ...monthOf('2026-08', 20, 20_000, { categoryId: 'cat-dining', categoryName: 'Dining Out', groupName: 'Want' }),
      ...movers.flatMap((k, idx) => [
        ...['2026-05', '2026-06', '2026-07'].flatMap((m) =>
          monthOf(m, 1, 3_000, { categoryId: `cat-${k}`, categoryName: `Cat ${k}` })
        ),
        // Each mover jumps by a different, clearly material amount.
        ...monthOf('2026-08', 1, 20_000 + idx * 5_000, { categoryId: `cat-${k}`, categoryName: `Cat ${k}` }),
      ]),
    ];

    const insights = buildExpenseInsights(
      prepareExpenseData({ rows, analysisMonthKey: '2026-08', todayAppDate: '2026-09-15' })
    );

    const anomalies = insights.filter((i) => i.id.startsWith('anomaly-'));
    expect(anomalies).toHaveLength(MAX_ANOMALIES);
    // The biggest mover (f, +₹45k) must survive the cap; the smallest (a) must not.
    expect(ids(anomalies)).toContain('anomaly-cat-f');
    expect(ids(anomalies)).not.toContain('anomaly-cat-a');
  });
});

describe('recurring vs one-time', () => {
  it('does not report a renovation month as overspending', () => {
    const rows = [
      ...healthyHistory(),
      ...monthOf('2026-08', 40, 40_000),
      ...monthOf('2026-08', 20, 20_000, { categoryId: 'cat-dining', categoryName: 'Dining Out', groupName: 'Want' }),
      ...monthOf('2026-08', 6, 1_44_885, {
        categoryId: 'cat-reno',
        categoryName: 'Home Improvement',
        groupName: 'One-time',
      }),
    ];

    const insights = buildExpenseInsights(
      prepareExpenseData({ rows, analysisMonthKey: '2026-08', todayAppDate: '2026-09-15' })
    );

    // Running costs were normal, so no "ran hot" verdict...
    expect(ids(insights)).not.toContain('high-spending');
    // ...but the ₹1.4L is named rather than passing in silence.
    const oneTime = insights.find((i) => i.id === 'one-time-load');
    expect(oneTime).toBeDefined();
    expect(oneTime!.description).toContain('Home Improvement');
    // One-time categories are owned by that rule, not double-reported as an anomaly.
    expect(ids(insights)).not.toContain('anomaly-cat-reno');
  });

  it('judges the month on running costs, excluding one-time from the baseline', () => {
    const rows = [
      ...healthyHistory(),
      // A prior month carrying a huge one-time project must not raise the baseline.
      ...monthOf('2026-07', 5, 3_00_000, {
        categoryId: 'cat-reno',
        categoryName: 'Home Improvement',
        groupName: 'One-time',
      }),
      ...monthOf('2026-08', 40, 40_000),
      ...monthOf('2026-08', 20, 60_000, { categoryId: 'cat-dining', categoryName: 'Dining Out', groupName: 'Want' }),
    ];

    const insights = buildExpenseInsights(
      prepareExpenseData({ rows, analysisMonthKey: '2026-08', todayAppDate: '2026-09-15' })
    );

    const verdict = insights.find((i) => i.id === 'high-spending');
    expect(verdict).toBeDefined();
    expect(verdict!.description).toContain('One-time spend is excluded');
  });
});

describe('data quality', () => {
  it('flags an under-logged month and withholds every comparison', () => {
    const rows = [
      ...healthyHistory(),
      // 3 transactions against a 60-transaction norm.
      ...monthOf('2026-08', 3, 9_000),
    ];

    const insights = buildExpenseInsights(
      prepareExpenseData({ rows, analysisMonthKey: '2026-08', todayAppDate: '2026-09-15' })
    );

    expect(ids(insights)).toContain('data-quality-month');
    // No achievement for a month that was simply not written down.
    expect(ids(insights)).not.toContain('low-spending');
    expect(ids(insights)).not.toContain('yoy-trend');
    expect(insights.filter((i) => i.id.startsWith('anomaly-'))).toHaveLength(0);
  });

  it('excludes under-logged history from the baseline and says so', () => {
    const rows = [
      ...healthyHistory().filter((r) => !['2025-09', '2025-10', '2025-11'].includes(r.date.slice(0, 7))),
      ...['2025-09', '2025-10', '2025-11'].flatMap((m) => monthOf(m, 2, 3_000)),
      ...monthOf('2026-08', 40, 40_000),
      ...monthOf('2026-08', 20, 20_000, { categoryId: 'cat-dining', categoryName: 'Dining Out', groupName: 'Want' }),
    ];

    const prepared = prepareExpenseData({ rows, analysisMonthKey: '2026-08', todayAppDate: '2026-09-15' });
    expect(prepared.excludedMonths.map((m) => m.key)).toEqual(['2025-09', '2025-10', '2025-11']);
    expect(prepared.cleanHistory.every((m) => !m.lowConfidence)).toBe(true);

    const insights = buildExpenseInsights(prepared);
    const card = insights.find((i) => i.id === 'data-quality-history');
    expect(card).toBeDefined();
    expect(card!.description).toContain('Sep 2025');
  });
});

describe('open month', () => {
  const openRows = () => [
    ...healthyHistory(),
    // 10 days in, a third of a normal month spent.
    ...Array.from({ length: 15 }, (_, i) =>
      row({ date: `2026-08-${String((i % 10) + 1).padStart(2, '0')}`, amount: 1_400 })
    ),
  ];

  it('projects to month end from the app-timezone date, not the wall clock', () => {
    const insights = buildExpenseInsights(
      prepareExpenseData({ rows: openRows(), analysisMonthKey: '2026-08', todayAppDate: '2026-08-10' })
    );

    const runRate = insights.find((i) => i.id === 'run-rate-projection');
    expect(runRate).toBeDefined();
    expect(runRate!.description).toContain('10 days');
    // 21,000 over 10 days → ~65,100 over 31.
    expect(runRate!.value).toBeGreaterThan(60_000);
    expect(runRate!.value).toBeLessThan(70_000);
  });

  it('withholds whole-month verdicts while the month is still running', () => {
    const insights = buildExpenseInsights(
      prepareExpenseData({ rows: openRows(), analysisMonthKey: '2026-08', todayAppDate: '2026-08-10' })
    );

    // A partial total is not an achievement.
    expect(ids(insights)).not.toContain('low-spending');
    expect(ids(insights)).not.toContain('high-spending');
    expect(ids(insights)).not.toContain('yoy-trend');
    expect(insights.filter((i) => i.id.startsWith('anomaly-'))).toHaveLength(0);
  });
});

describe('ranking', () => {
  it('orders by severity, then by rupee weight', () => {
    const insights = buildExpenseInsights(
      prepareExpenseData({
        rows: [
          ...healthyHistory(),
          ...monthOf('2026-08', 40, 40_000),
          ...monthOf('2026-08', 20, 20_000, { categoryId: 'cat-dining', categoryName: 'Dining Out', groupName: 'Want' }),
          ...monthOf('2026-08', 4, 2_00_000, {
            categoryId: 'cat-reno',
            categoryName: 'Home Improvement',
            groupName: 'One-time',
          }),
        ],
        analysisMonthKey: '2026-08',
        todayAppDate: '2026-09-15',
      })
    );

    const rank = { danger: 0, warning: 1, info: 2, success: 3 } as const;
    for (let i = 1; i < insights.length; i++) {
      const prev = insights[i - 1];
      const cur = insights[i];
      expect(rank[prev.severity]).toBeLessThanOrEqual(rank[cur.severity]);
      if (prev.severity === cur.severity) {
        expect(prev.weight ?? 0).toBeGreaterThanOrEqual(cur.weight ?? 0);
      }
    }
  });
});
