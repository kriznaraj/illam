import { describe, expect, it } from 'vitest';
import {
  buildPortfolioInsights,
  decomposeGrowth,
  monthRange,
  preparePortfolioData,
  type InvestmentRow,
  type PortfolioAccountRow,
  type SnapshotRow,
} from '@/lib/insights/portfolioRules';

/**
 * Pins the data-integrity detectors and the contribution/valuation split.
 *
 * The shapes here are the ones the live database actually contains: credit cards
 * stored positive since 2026-01, balances frozen for months while contributions keep
 * being recorded against them, and two snapshots inside the same calendar month.
 */

const MONTHS = monthRange('2025-08', '2026-08');

function account(over: Partial<PortfolioAccountRow> & { id: string; type: string }): PortfolioAccountRow {
  return { name: over.id, isActive: true, details: null, ...over } as PortfolioAccountRow;
}

/** A snapshot per month, on the 1st, from a month→amount map or a constant. */
function series(accountId: string, amounts: number | Record<string, number>): SnapshotRow[] {
  return MONTHS.map((month) => ({
    accountId,
    month,
    date: `${month}-01`,
    amount: typeof amounts === 'number' ? amounts : amounts[month] ?? 0,
  }));
}

const ids = (list: ReturnType<typeof buildPortfolioInsights>) => list.map((i) => i.id);

function prepare(params: {
  accounts: PortfolioAccountRow[];
  snapshots: SnapshotRow[];
  investments?: InvestmentRow[];
}) {
  return preparePortfolioData({
    accounts: params.accounts,
    snapshots: params.snapshots,
    investments: params.investments ?? [],
    startMonthKey: '2025-08',
    analysisMonthKey: '2026-08',
    analysisLabel: 'August 2026',
  });
}

describe('credit card sign', () => {
  it('flags positive card balances and quantifies the overstatement at twice the balance', () => {
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [account({ id: 'card', name: 'Rewards card', type: 'Credit Card' })],
        snapshots: series('card', 58_580),
      })
    );

    const card = insights.find((i) => i.id === 'cc-sign-anomaly');
    expect(card).toBeDefined();
    expect(card!.severity).toBe('danger');
    // Not subtracted, and added instead — the error is worth twice the balance.
    expect(card!.value).toBe(117_160);
  });

  it('stays silent when cards are stored as the liabilities they are', () => {
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [account({ id: 'card', name: 'Rewards card', type: 'Credit Card' })],
        snapshots: series('card', -58_580),
      })
    );

    expect(ids(insights)).not.toContain('cc-sign-anomaly');
  });
});

describe('stale balances', () => {
  it('needs three consecutive unchanged months', () => {
    const twoStale = { ...Object.fromEntries(MONTHS.map((m, i) => [m, 1_00_000 + i * 1_000])) };
    twoStale['2026-07'] = 5_00_000;
    twoStale['2026-08'] = 5_00_000;

    const notYet = buildPortfolioInsights(
      prepare({ accounts: [account({ id: 'a', type: 'Long Term' })], snapshots: series('a', twoStale) })
    );
    expect(ids(notYet)).not.toContain('stale-snapshots');

    const threeStale = { ...twoStale, '2026-06': 5_00_000 };
    const now = buildPortfolioInsights(
      prepare({ accounts: [account({ id: 'a', type: 'Long Term' })], snapshots: series('a', threeStale) })
    );
    expect(ids(now)).toContain('stale-snapshots');
  });

  it('ignores inactive accounts', () => {
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [account({ id: 'a', type: 'Prepaid', isActive: false })],
        snapshots: series('a', 5_00_000),
      })
    );
    expect(ids(insights)).not.toContain('stale-snapshots');
  });
});

describe('contributions vs balances', () => {
  it('flags an account taking monthly contributions whose balance never moves', () => {
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [
          account({
            id: 'epf',
            name: 'EPF',
            type: 'Long Term',
            details: { recurring_investments_enabled: true, recurring_monthly_amount: 24_170 },
          }),
        ],
        snapshots: series('epf', 36_00_564),
      })
    );

    const card = insights.find((i) => i.id === 'contribution-contradiction');
    expect(card).toBeDefined();
    expect(card!.description).toContain('EPF');
  });
});

describe('growth decomposition', () => {
  const accounts = [
    account({ id: 'stocks', name: 'Stocks', type: 'Stocks' }),
    account({ id: 'loan', name: 'Housing Loan', type: 'Loan' }),
  ];

  it('separates money added, debt repaid and valuation change', () => {
    const stocks = Object.fromEntries(MONTHS.map((m, i) => [m, 50_00_000 + i * 1_00_000]));
    const loan = Object.fromEntries(MONTHS.map((m, i) => [m, -50_00_000 + i * 50_000]));
    // Dated 2025-08 … 2026-07: each lands in the next month's snapshot, so all twelve
    // fall inside the window's twelve moves.
    const investments: InvestmentRow[] = MONTHS.slice(0, -1).map((month) => ({
      accountId: 'stocks',
      month,
      amount: 40_000,
      kind: 'adhoc',
      note: null,
    }));

    const insights = buildPortfolioInsights(
      prepare({ accounts, snapshots: [...series('stocks', stocks), ...series('loan', loan)], investments })
    );

    const card = insights.find((i) => i.id === 'contribution-vs-growth');
    expect(card).toBeDefined();
    // 12 months: +₹12L of balance, +₹6L of loan repayment, ₹4.8L contributed
    // → ₹18L total change, of which ₹7.2L is valuation.
    expect(card!.value).toBeCloseTo(7_20_000, -2);
    expect(card!.description).toContain('loan repaid');
  });

  it('counts virtual SIPs, which are never stored as investment rows', () => {
    const mf = Object.fromEntries(MONTHS.map((m, i) => [m, 30_00_000 + i * 50_000]));
    const withSip = [
      account({
        id: 'mf',
        name: 'Grow',
        type: 'Mutual Funds',
        details: { funds: [{ sip_amount: 10_000, amount_history: [{ from_month: '2025-04', amount: 10_000 }] }] },
      }),
    ];

    const withSipCard = buildPortfolioInsights(
      prepare({ accounts: withSip, snapshots: series('mf', mf) })
    ).find((i) => i.id === 'contribution-vs-growth');

    const withoutSipCard = buildPortfolioInsights(
      prepare({ accounts: [account({ id: 'mf', name: 'Grow', type: 'Mutual Funds' })], snapshots: series('mf', mf) })
    ).find((i) => i.id === 'contribution-vs-growth');

    // ₹10,000 × 12 months of SIP must be attributed to contributions, not to markets.
    expect(withoutSipCard!.value! - withSipCard!.value!).toBeCloseTo(1_20_000, -2);
  });

  it('removes the credit-card sign flip from the valuation figure', () => {
    const cash = Object.fromEntries(MONTHS.map((m) => [m, 10_00_000]));
    const card: Record<string, number> = Object.fromEntries(
      MONTHS.map((m) => [m, m >= '2026-01' ? 50_000 : -50_000])
    );

    const insights = buildPortfolioInsights(
      prepare({
        accounts: [
          account({ id: 'cash', name: 'Savings', type: 'Saving Account' }),
          account({ id: 'card', name: 'Card', type: 'Credit Card' }),
        ],
        snapshots: [...series('cash', cash), ...series('card', card)],
      })
    );

    const decomposition = insights.find((i) => i.id === 'contribution-vs-growth');
    expect(decomposition).toBeDefined();
    // Net worth "rose" ₹1L purely from the sign flip; valuation change is zero.
    expect(decomposition!.value).toBeCloseTo(0, -2);
    expect(decomposition!.description).toContain('sign error');
  });
});

describe('within-month duplicates', () => {
  it('takes the latest snapshot in a month rather than summing them', () => {
    const snapshots: SnapshotRow[] = [
      ...series('kite', 25_00_000),
      // A mid-month re-entry. Summing these double-counts the account.
      { accountId: 'kite', month: '2026-08', date: '2026-08-27', amount: 25_56_770 },
    ];

    const prepared = prepare({
      accounts: [account({ id: 'kite', name: 'Kite', type: 'Stocks' })],
      snapshots,
    });

    expect(prepared.netWorthByMonth[prepared.netWorthByMonth.length - 1]).toBe(25_56_770);
  });

  it('is independent of the order rows arrive in', () => {
    const base = series('kite', 25_00_000);
    const late: SnapshotRow = { accountId: 'kite', month: '2026-08', date: '2026-08-27', amount: 25_56_770 };

    const forwards = prepare({ accounts: [account({ id: 'kite', type: 'Stocks' })], snapshots: [...base, late] });
    const backwards = prepare({ accounts: [account({ id: 'kite', type: 'Stocks' })], snapshots: [late, ...base] });

    expect(backwards.netWorthByMonth).toEqual(forwards.netWorthByMonth);
  });
});

describe('projection', () => {
  it('gives a range whose floor is contributions alone with no market return', () => {
    const stocks = Object.fromEntries(MONTHS.map((m, i) => [m, 50_00_000 + i * 1_00_000]));
    const investments: InvestmentRow[] = MONTHS.slice(1).map((month) => ({
      accountId: 'stocks',
      month,
      amount: 50_000,
      kind: 'adhoc',
      note: null,
    }));

    const insights = buildPortfolioInsights(
      prepare({ accounts: [account({ id: 'stocks', type: 'Stocks' })], snapshots: series('stocks', stocks), investments })
    );

    const projection = insights.find((i) => i.id === 'net-worth-projection');
    expect(projection).toBeDefined();
    expect(projection!.type).toBe('projection');
    // States its assumptions rather than presenting one annualised number.
    expect(projection!.description).toContain('zero market return');
    expect(projection!.description).toContain('Neither is a forecast of markets');
  });
});

describe('every insight is renderable', () => {
  it('carries an id and a severity', () => {
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [
          account({ id: 'stocks', name: 'Stocks', type: 'Stocks' }),
          account({ id: 'card', name: 'Card', type: 'Credit Card' }),
          account({ id: 'loan', name: 'Loan', type: 'Loan' }),
        ],
        snapshots: [
          ...series('stocks', Object.fromEntries(MONTHS.map((m, i) => [m, 50_00_000 + i * 2_00_000]))),
          ...series('card', 40_000),
          ...series('loan', Object.fromEntries(MONTHS.map((m, i) => [m, -50_00_000 + i * 60_000]))),
        ],
      })
    );

    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      // Missing severity is what rendered every portfolio card as `class="card undefined"`.
      expect(insight.id).toBeTruthy();
      expect(['danger', 'warning', 'info', 'success']).toContain(insight.severity);
      expect(insight.icon).toBeTruthy();
    }
  });
});

describe('catch-up corrections', () => {
  /**
   * EPF, from the live database: ₹37,54,308 every month from 2026-04 to 2026-08, then
   * ₹44,57,169 on 2026-09-01. Five months of accrual landing in one step is not one
   * month of market performance, and reporting it as such is how a frozen balance
   * turns into a fake record month the moment it is finally updated.
   */
  const FROZEN_THEN_JUMPED: Record<string, number> = Object.fromEntries(
    monthRange('2025-08', '2026-08').map((m) => [m, m >= '2026-08' ? 4_194_193 : 3_600_564])
  );

  it('attributes a jump after a long freeze to the month it landed in', () => {
    const d = prepare({
      accounts: [account({ id: 'epf', name: 'EPF', type: 'Long Term' })],
      snapshots: series('epf', FROZEN_THEN_JUMPED),
    });

    expect(d.catchUpByMonth.get('2026-08')).toBe(4_194_193 - 3_600_564);
  });

  it('does not treat an ordinary month-to-month move as a catch-up', () => {
    // A balance that changes every month is simply performing; nothing to reattribute.
    const moving = Object.fromEntries(
      monthRange('2025-08', '2026-08').map((m, i) => [m, 1_000_000 + i * 10_000])
    );
    const d = prepare({
      accounts: [account({ id: 'mf', name: 'Mutual Funds', type: 'Mutual Funds' })],
      snapshots: series('mf', moving),
    });

    expect(d.catchUpByMonth.size).toBe(0);
  });

  it('keeps a short flat stretch below the staleness bar out of it', () => {
    // Two identical months then a move — normal, not a backdated correction.
    const brieflyFlat = Object.fromEntries(
      monthRange('2025-08', '2026-08').map((m) => [m, m >= '2026-08' ? 1_500_000 : m >= '2026-07' ? 1_000_000 : 900_000 ])
    );
    const d = prepare({
      accounts: [account({ id: 'fd', name: 'FD', type: 'Fixed Deposit' })],
      snapshots: series('fd', brieflyFlat),
    });

    expect(d.catchUpByMonth.get('2026-08')).toBeUndefined();
  });

  it('says the top mover was frozen, rather than presenting neglect as performance', () => {
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [
          account({ id: 'epf', name: 'EPF', type: 'Long Term' }),
          account({ id: 'mf', name: 'Mutual Funds', type: 'Mutual Funds' }),
        ],
        snapshots: [...series('epf', FROZEN_THEN_JUMPED), ...series('mf', 500_000)],
      })
    );

    const top = insights.find((i) => i.id === 'top-mover');
    expect(top?.title).toBe('EPF Moved Most');
    expect(top?.description).toContain('frozen');
    expect(top?.description).toContain("rather than one month's performance");
  });

  it('leaves an ordinary top mover unqualified', () => {
    const climbing = Object.fromEntries(
      monthRange('2025-08', '2026-08').map((m, i) => [m, 1_000_000 + i * 50_000])
    );
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [account({ id: 'mf', name: 'Mutual Funds', type: 'Mutual Funds' })],
        snapshots: series('mf', climbing),
      })
    );

    const top = insights.find((i) => i.id === 'top-mover');
    expect(top?.description).not.toContain('frozen');
  });

  it('opens the month-move breakdown as a sentence', () => {
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [account({ id: 'epf', name: 'EPF', type: 'Long Term' })],
        snapshots: series('epf', FROZEN_THEN_JUMPED),
      })
    );

    // The breakdown follows a full stop, so it must not start lowercase.
    expect(insights.find((i) => i.id === 'month-move')!.description).not.toMatch(/\. [a-z]/);
  });

  it('separates the catch-up from market gain in the month-move insight', () => {
    const insights = buildPortfolioInsights(
      prepare({
        accounts: [account({ id: 'epf', name: 'EPF', type: 'Long Term' })],
        snapshots: series('epf', FROZEN_THEN_JUMPED),
      })
    );

    const move = insights.find((i) => i.id === 'month-move');
    expect(move).toBeDefined();
    expect(move!.description).toContain('catch-up');
    // The whole move is catch-up, so nothing is left to credit to the market.
    expect(move!.description).toContain('markets added ₹0');
  });
});

/**
 * The boundary. The salary account, the savings accounts and the brokerage wallets are
 * all snapshotted into net worth, so money moving between them and the investments is
 * not money added to net worth. The old engine subtracted every such transfer from net
 * worth's change anyway, understating market gain by each one.
 */
describe('investment boundary', () => {
  const salaryAccount = account({ id: 'salary', name: 'Salary - Alice', type: 'Salary Account', isCash: true });
  const usStocks = account({ id: 'us', name: 'IND Money US Stocks', type: 'Stocks' });
  const flow = (accountId: string, month: string, amount: number, note: string | null = null): InvestmentRow => ({
    accountId,
    month,
    amount,
    kind: 'adhoc',
    note,
  });

  it('counts a bank transfer into investments as neither growth nor saving', () => {
    // ₹47,775 leaves the salary account on 2026-07-22 and lands in US stocks; nothing else moves.
    const d = prepare({
      accounts: [salaryAccount, usStocks],
      snapshots: [
        ...series('salary', Object.fromEntries(MONTHS.map((m) => [m, m >= '2026-08' ? 2_33_000 : 2_82_000]))),
        ...series('us', Object.fromEntries(MONTHS.map((m) => [m, m >= '2026-08' ? 36_49_000 : 36_00_000]))),
      ],
      investments: [flow('us', '2026-07', 49_000)],
    });

    const g = decomposeGrowth(d, d.months.length - 2, d.months.length - 1);
    expect(g.change).toBe(0);
    expect(g.contributed).toBe(49_000);
    expect(g.marketGain).toBe(0);
    expect(g.saved).toBe(0);
    // A flat balance that moves by exactly the money put in is that money, not a catch-up.
    expect(g.catchUp).toBe(0);
  });

  it('nets a deposit against the snapshot it lands in, not the month it is dated in', () => {
    // Dated 2026-07-22: the 2026-07-01 snapshot cannot contain it; the 2026-08-01 one does.
    const d = prepare({
      accounts: [salaryAccount, usStocks],
      snapshots: [
        ...series('salary', 2_82_000),
        ...series('us', Object.fromEntries(MONTHS.map((m) => [m, m >= '2026-08' ? 36_49_000 : 36_00_000]))),
      ],
      investments: [flow('us', '2026-07', 49_000)],
    });
    const n = d.months.length;

    expect(d.contributionsByMonth.get('2026-08')).toBe(49_000);
    expect(d.contributionsByMonth.has('2026-07')).toBe(false);
    expect(decomposeGrowth(d, n - 3, n - 2).marketGain).toBe(0);
    expect(decomposeGrowth(d, n - 2, n - 1).marketGain).toBe(0);
  });

  it('does not read a redemption paid out to the bank as a loss', () => {
    // −₹1,07,353 on 2026-05-20, as entered by hand: the fund closed and the money reached the bank.
    const d = prepare({
      accounts: [salaryAccount, account({ id: 'mf', name: 'Alice MF', type: 'Mutual Funds' })],
      snapshots: [
        ...series('salary', Object.fromEntries(MONTHS.map((m) => [m, m >= '2026-06' ? 3_00_640 : 2_00_000]))),
        ...series('mf', Object.fromEntries(MONTHS.map((m) => [m, m >= '2026-06' ? 9_00_000 : 10_00_640]))),
      ],
      investments: [flow('mf', '2026-05', -1_00_640, 'Fund closed')],
    });
    const index = d.months.indexOf('2026-06');
    const g = decomposeGrowth(d, index - 1, index);

    expect(g.change).toBe(0);
    expect(g.marketGain).toBe(0);
  });

  it('ignores money booked against a cash account, which never crossed the boundary', () => {
    const d = prepare({
      accounts: [salaryAccount, usStocks],
      snapshots: [...series('salary', 2_82_000), ...series('us', 36_00_000)],
      investments: [flow('salary', '2026-07', 49_000)],
    });
    expect(d.contributionsByMonth.size).toBe(0);
  });

  it('nets a catch-up against everything that landed while the balance was frozen', () => {
    // EPF, as in the live data: the balance is not updated while ₹25,980 a month keeps
    // being recorded, then jumps. The contributions are already subtracted month by month,
    // so the catch-up is only what is left of the jump after all of them.
    const epf = account({ id: 'epf', name: 'EPF', type: 'Long Term' });
    const d = prepare({
      accounts: [epf],
      snapshots: series('epf', Object.fromEntries(MONTHS.map((m) => [m, m >= '2026-08' ? 41_94_193 : 36_00_564]))),
      investments: MONTHS.slice(0, -1).map((month) => flow('epf', month, 24_170)),
    });
    const g = decomposeGrowth(d, 0, d.months.length - 1);

    expect(g.contributed).toBe(12 * 24_170);
    expect(g.catchUp).toBe(41_94_193 - 36_00_564 - 12 * 24_170);
    // The balance moved by exactly contributions plus catch-up: nothing is left for markets.
    expect(g.marketGain).toBeCloseTo(0, 6);
  });

  it('lands a SIP in the month after it is paid', () => {
    const fund = { sip_amount: 5_000, amount_history: [{ from_month: '2026-07', amount: 5_000 }] };
    const d = prepare({
      accounts: [account({ id: 'mf', type: 'Mutual Funds', details: { funds: [fund] } })],
      snapshots: series('mf', Object.fromEntries(MONTHS.map((m, i) => [m, 10_00_000 + i * 7_000]))),
    });
    expect(d.sipByMonth.has('2026-07')).toBe(false);
    expect(d.sipByMonth.get('2026-08')).toBe(5_000);
  });

  it('keeps the parts adding up to the change', () => {
    const d = prepare({
      accounts: [salaryAccount, usStocks, account({ id: 'stocks', type: 'Stocks' }), account({ id: 'loan', type: 'Loan' })],
      snapshots: [
        ...series('salary', Object.fromEntries(MONTHS.map((m, i) => [m, 3_00_000 + ((i * 37_000) % 90_000)]))),
        ...series('us', Object.fromEntries(MONTHS.map((m, i) => [m, 36_00_000 + i * 13_000]))),
        ...series('stocks', Object.fromEntries(MONTHS.map((m, i) => [m, 50_00_000 + i * 1_10_000]))),
        ...series('loan', Object.fromEntries(MONTHS.map((m, i) => [m, -50_00_000 + i * 50_000]))),
      ],
      investments: MONTHS.map((month) => flow('stocks', month, 40_000)),
    });
    const g = decomposeGrowth(d, 0, d.months.length - 1);

    expect(g.marketGain + g.catchUp + g.saved + g.signArtefact).toBeCloseTo(g.change, 6);
    // Twelve deposits land inside the window; the one dated 2026-08 lands after it.
    expect(g.contributed).toBe(12 * 40_000);
    expect(g.marketGain).toBeCloseTo(12 * 1_10_000 + 12 * 13_000 - 12 * 40_000, 6);
  });
});
