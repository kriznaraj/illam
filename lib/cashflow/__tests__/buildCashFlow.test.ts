import { describe, expect, it } from 'vitest';
import { buildCashFlow, type CashFlowInput } from '../buildCashFlow';
import { instalments } from '../commitments';
import type { Commitment, Transfer } from '@/types';

const transfer = (overrides: Partial<Transfer>): Transfer => ({
  id: 't',
  inbox_item_id: null,
  owner: 'alice',
  date: '2026-07-10',
  amount: 1000,
  direction: 'debit',
  counterparty: null,
  payment_method: null,
  kind: 'other',
  account_id: null,
  portfolio_investment_id: null,
  credit_card_statement_id: null,
  expense_id: null,
  note: null,
  status: 'confirmed',
  created_at: '',
  updated_at: '',
  ...overrides,
});

const term: Commitment = {
  id: 'term',
  name: 'Tata AIA term',
  kind: 'insurance',
  amount: 10470,
  frequency: 'monthly',
  start_month: '2026-01',
  due_day: 8,
  end_month: null,
  match_text: 'LICPOLICY',
  account_id: null,
  note: null,
  active: true,
  created_at: '',
  updated_at: '',
};

const base = (overrides: Partial<CashFlowInput> = {}): CashFlowInput => ({
  from: '2026-07',
  to: '2026-07',
  income: [{ date: '2026-07-30', amount: 150000, currency: 'INR', kind: 'salary', needs_review: false }],
  expenses: [
    { date: '2026-07-03', amount: 8000, category: 'Groceries & Staples', group: 'Need' },
    { date: '2026-07-04', amount: 2000, category: 'Dining Out', group: 'Want' },
  ],
  instalments: instalments([term], [], '2026-07', '2026-07', '2026-07-31'),
  upcoming: [],
  contributions: [
    { month: '2026-07', accountId: 'epf', accountName: 'EPF', amount: 25980, via: 'payroll' },
    { month: '2026-07', accountId: 'mf', accountName: 'Alice MF', amount: 10000, via: 'sip' },
  ],
  transfers: [],
  claimedTransferIds: new Set(),
  currentMonth: '2026-10',
  ...overrides,
});

const section = (report: ReturnType<typeof buildCashFlow>, key: string) => report.moneyOut.sections.find((s) => s.key === key);

describe('buildCashFlow', () => {
  it('sets salary and payroll against spending, commitments and investments', () => {
    const report = buildCashFlow(base());
    expect(report.moneyIn.total).toBe(150000 + 25980);
    expect(section(report, 'spending')?.total).toBe(10000);
    expect(section(report, 'commitments')?.lines[0]).toMatchObject({ label: 'Tata AIA term', amount: 10470, status: 'assumed' });
    expect(section(report, 'investments')?.total).toBe(35980);
    expect(report.moneyOut.total).toBe(10000 + 10470 + 35980);
    expect(report.net).toBe(175980 - 56450);
    expect(report.monthly).toEqual([{ month: '2026-07', moneyIn: 175980, moneyOut: 56450, net: 119530 }]);
  });

  it('never counts card bills, household moves, investment transfers, waiting transfers or cash', () => {
    const report = buildCashFlow(
      base({
        transfers: [
          transfer({ id: 'a', kind: 'card_bill', amount: 30350 }),
          transfer({ id: 'b', kind: 'family', amount: 47775 }),
          transfer({ id: 'c', kind: 'investment', amount: 47500 }),
          transfer({ id: 'd', kind: 'own_account', amount: 5000 }),
          transfer({ id: 'e', kind: 'other', amount: 40000, status: 'needs_review' }),
          transfer({ id: 'f', kind: 'cash', amount: 3000 }),
        ],
      })
    );
    expect(report.moneyOut.total).toBe(10000 + 10470 + 35980);
    expect(report.gaps.waitingTransfers).toEqual({ count: 1, debit: 40000, credit: 0 });
    expect(report.gaps.cashWithdrawn).toBe(3000);
  });

  it('counts tax and other payments, but not a transfer a commitment payment claimed', () => {
    const report = buildCashFlow(
      base({
        transfers: [
          transfer({ id: 'tax', kind: 'tax', amount: 100898, counterparty: 'CBDT TIN 2 0' }),
          transfer({ id: 'fund', kind: 'other', amount: 392164, note: 'Apartment common fund' }),
          transfer({ id: 'emi', kind: 'other', amount: 42000 }),
        ],
        claimedTransferIds: new Set(['emi']),
      })
    );
    expect(section(report, 'tax')?.total).toBe(100898);
    expect(section(report, 'other')?.lines.map((l) => l.label)).toEqual(['Apartment common fund']);
  });

  it('puts a redemption on the money-in side, never as negative investing', () => {
    const report = buildCashFlow(
      base({
        contributions: [
          { month: '2026-07', accountId: 'mf', accountName: 'Alice MF', amount: 10000, via: 'sip' },
          { month: '2026-07', accountId: 'mf', accountName: 'Alice MF', amount: -88957, via: 'entered' },
        ],
      })
    );
    expect(report.moneyIn.lines.find((l) => l.key === 'withdrawals')).toMatchObject({ amount: 88957, detail: 'Alice MF' });
    expect(section(report, 'investments')?.lines).toEqual([expect.objectContaining({ amount: 10000 })]);
    expect(report.monthly[0].moneyIn).toBe(150000 + 88957);
  });

  it('shows a year covered by an advance at nothing, and says so', () => {
    const health = { ...term, id: 'health', name: 'Family health', frequency: 'annual' as const, start_month: '2025-07', due_day: 10, amount: 30000 };
    const report = buildCashFlow(
      base({
        instalments: instalments(
          [health],
          [{ id: 'p', commitment_id: 'health', due_month: '2025-07', paid_date: '2025-07-09', amount: 81000, source: 'manual', inbox_item_id: null, transfer_id: null, covers_through: '2027-07', note: null, created_at: '' }],
          '2026-07',
          '2026-07',
          '2026-07-31'
        ),
      })
    );
    expect(section(report, 'commitments')?.lines[0]).toMatchObject({ amount: 0, detail: 'Covered by the advance paid 09 Jul 2025' });
  });

  it('lists another currency without adding it to rupees', () => {
    const report = buildCashFlow(base({ income: [{ date: '2026-07-05', amount: 12.5, currency: 'USD', kind: 'dividend', needs_review: false }] }));
    expect(report.moneyIn.foreign).toEqual([{ currency: 'USD', amount: 12.5 }]);
    expect(report.moneyIn.lines.map((l) => l.key)).toEqual(['payroll']);
  });

  it('names closed months whose salary was never read', () => {
    const report = buildCashFlow(base({ from: '2026-07', to: '2026-10' }));
    expect(report.gaps.monthsWithoutSalary).toEqual(['2026-08', '2026-09']);
  });
});
