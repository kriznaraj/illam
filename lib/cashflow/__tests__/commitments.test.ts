import { describe, expect, it } from 'vitest';
import { dueDate, dueMonthFor, dueMonths, findCommitment, instalments, matchesText } from '../commitments';
import type { Commitment, CommitmentPayment } from '@/types';

const commitment = (overrides: Partial<Commitment> = {}): Commitment => ({
  id: 'c1',
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
  ...overrides,
});

const payment = (overrides: Partial<CommitmentPayment>): CommitmentPayment => ({
  id: 'p1',
  commitment_id: 'c1',
  due_month: '2026-07',
  paid_date: '2026-07-08',
  amount: 10470,
  source: 'statement',
  inbox_item_id: null,
  transfer_id: null,
  note: null,
  created_at: '',
  ...overrides,
});

describe('schedule', () => {
  it('steps from the start month by the frequency and stops at the end month', () => {
    const annual = commitment({ frequency: 'annual', start_month: '2025-03' });
    expect(dueMonths(annual, '2025-04', '2027-03')).toEqual(['2026-03', '2027-03']);
    const quarterly = commitment({ frequency: 'quarterly', start_month: '2026-02', end_month: '2026-08' });
    expect(dueMonths(quarterly, '2026-01', '2026-12')).toEqual(['2026-02', '2026-05', '2026-08']);
  });

  it('clamps a due day past the month end', () => {
    expect(dueDate(commitment({ due_day: 31 }), '2026-02')).toBe('2026-02-28');
  });
});

describe('matching a debit', () => {
  it('ignores case, spaces and punctuation, as statements wrap words', () => {
    expect(matchesText(commitment(), 'LICPOLICY_C••0266_••0002 Value Dt 08/06/2026')).toBe(true);
    expect(matchesText(commitment({ match_text: 'Housing loan' }), 'NEFT Dr-IDIB000K501-ALICE V-SANDOZ - MUM-HDFCH••3798-NET BANKING SI -Housing loan')).toBe(true);
  });

  it('refuses a fragment too short to mean anything', () => {
    expect(matchesText(commitment({ match_text: 'lic' }), 'PUBLIC PROVIDENT')).toBe(false);
  });

  it('settles the nearest due month within the window', () => {
    const annual = commitment({ frequency: 'annual', start_month: '2026-03', due_day: 28 });
    expect(dueMonthFor(annual, '2026-04-02')).toBe('2026-03');
    expect(dueMonthFor(annual, '2026-06-02')).toBeNull();
  });

  it('tells two policies with one payee apart by amount', () => {
    const term = commitment();
    const other = commitment({ id: 'c2', amount: 4200 });
    expect(findCommitment([term, other], { text: 'LICPOLICY_C••0266', date: '2026-07-08', amount: 4200 })?.commitment.id).toBe('c2');
  });

  it('ignores stopped commitments', () => {
    expect(findCommitment([commitment({ active: false })], { text: 'LICPOLICY', date: '2026-07-08', amount: 10470 })).toBeNull();
  });
});

describe('instalments', () => {
  it('counts paid at what left, a passed due date at the declared amount, and the future at nothing', () => {
    const rows = instalments([commitment()], [payment({ amount: 11400 })], '2026-07', '2026-10', '2026-09-10');
    expect(rows.map((r) => [r.month, r.status, r.amount])).toEqual([
      ['2026-07', 'paid', 11400],
      ['2026-08', 'assumed', 10470],
      ['2026-09', 'assumed', 10470],
      ['2026-10', 'upcoming', 0],
    ]);
  });

  it('counts an advance once, in the month it was paid, and the years it covers at nothing', () => {
    // The family health policy: yearly, but three years paid in Mar 2025 for a discount.
    const health = commitment({ id: 'c1', frequency: 'annual', start_month: '2025-03', due_day: 15, amount: 30000 });
    const advance = payment({ due_month: '2025-03', paid_date: '2025-03-12', amount: 81000, covers_through: '2027-03' });
    const rows = instalments([health], [advance], '2025-01', '2028-12', '2026-10-16');
    expect(rows.map((r) => [r.month, r.status, r.amount, r.covered])).toEqual([
      ['2025-03', 'paid', 81000, false],
      ['2026-03', 'paid', 0, true],
      ['2027-03', 'paid', 0, true],
      ['2028-03', 'upcoming', 0, false],
    ]);
  });

  it('keeps a stopped commitment’s paid instalments and asks nothing more of it', () => {
    const rows = instalments([commitment({ active: false })], [payment({})], '2026-07', '2026-08', '2026-09-10');
    expect(rows.map((r) => [r.month, r.status])).toEqual([['2026-07', 'paid']]);
  });
});
