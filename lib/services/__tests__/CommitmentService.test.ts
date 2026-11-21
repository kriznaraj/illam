import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Commitment, Transfer } from '@/types';

const commitments = vi.hoisted(() => ({ listAll: vi.fn(), create: vi.fn(), findById: vi.fn(), update: vi.fn() }));
const payments = vi.hoisted(() => ({ recordOnce: vi.fn(), update: vi.fn() }));
const transfers = vi.hoisted(() => ({ list: vi.fn() }));
const transferService = vi.hoisted(() => ({ apply: vi.fn() }));
const decisionService = vi.hoisted(() => ({ commitExpense: vi.fn() }));

vi.mock('@/lib/repositories/CommitmentRepository', () => ({
  CommitmentRepository: class { constructor() { return commitments as any; } },
  CommitmentPaymentRepository: class { constructor() { return payments as any; } },
}));
vi.mock('@/lib/repositories/TransferRepository', () => ({ TransferRepository: class { constructor() { return transfers as any; } } }));
vi.mock('../TransferService', () => ({ TransferService: class { constructor() { return transferService as any; } } }));
vi.mock('../MadalDecisionService', () => ({ MadalDecisionService: class { constructor() { return decisionService as any; } } }));

import { CommitmentService } from '../CommitmentService';
import { createSupabaseMock } from '@/lib/repositories/__tests__/supabaseMock';

const loan: Commitment = {
  id: 'c-loan',
  name: 'Housing loan',
  kind: 'loan',
  amount: 42000,
  frequency: 'monthly',
  start_month: '2025-01',
  due_day: 5,
  end_month: null,
  match_text: 'Housing loan',
  account_id: null,
  note: null,
  active: true,
  created_at: '',
  updated_at: '',
};
const NARRATION = 'NEFT Dr-IDIB000K501-ALICE V-SANDOZ - MUM-HDFCH••1193-NET BANKING SI -Housing loan Value Dt 05/07/2026';
const line = { date: '2026-07-05', narration: NARRATION, direction: 'debit' as const, amount: 42000, balance: 1 };

let service: CommitmentService;
beforeEach(() => {
  vi.clearAllMocks();
  commitments.listAll.mockResolvedValue([loan]);
  transfers.list.mockResolvedValue([]);
  payments.recordOnce.mockImplementation(async (p: object) => ({ payment: { id: 'p-1', ...p }, created: true }));
  service = new CommitmentService({} as any);
});

describe('CommitmentService.recordFromStatement', () => {
  it('records the EMI against its due month', async () => {
    const recorded = await service.recordFromStatement('alice', [{ last4: '3101', lines: [line] }]);
    expect(payments.recordOnce).toHaveBeenCalledWith(
      expect.objectContaining({ commitment_id: 'c-loan', due_month: '2026-07', paid_date: '2026-07-05', amount: 42000, source: 'statement', transfer_id: null })
    );
    expect(recorded).toHaveLength(1);
  });

  it('claims the waiting Madal transfer for the same debit, so it is counted once', async () => {
    const waiting = {
      id: 't-emi',
      owner: 'alice',
      date: '2026-07-05',
      amount: 42000,
      direction: 'debit',
      payment_method: 'HDFC Bank account ••3101',
      kind: 'other',
      status: 'needs_review',
      created_at: '2026-07-05T08:00:00Z',
    } as Transfer;
    transfers.list.mockResolvedValue([waiting]);

    await service.recordFromStatement('alice', [{ last4: '3101', lines: [line] }]);

    expect(payments.recordOnce).toHaveBeenCalledWith(expect.objectContaining({ transfer_id: 't-emi' }));
    expect(transferService.apply).toHaveBeenCalledWith(waiting, { kind: 'loan', note: 'Housing loan (Jul 2026)' });
  });

  it('ignores debits that are not a commitment', async () => {
    await service.recordFromStatement('alice', [{ last4: '3101', lines: [{ ...line, narration: 'UPI-CBDT TIN 2 0-cbdttin@ hdfcbank' }] }]);
    expect(payments.recordOnce).not.toHaveBeenCalled();
  });
});

describe('CommitmentService.markPaid', () => {
  const input = { commitment_id: '11111111-1111-4111-8111-111111111111', due_month: '2025-03', paid_date: '2025-03-12', amount: 81000 };

  it('records an advance covering the years after it', async () => {
    await service.markPaid({ ...input, covers_through: '2027-03' });
    expect(payments.recordOnce).toHaveBeenCalledWith(expect.objectContaining({ covers_through: '2027-03', source: 'manual' }));
  });

  it('adds the coverage to a payment a statement already found, leaving its amount alone', async () => {
    payments.recordOnce.mockResolvedValueOnce({ payment: { id: 'p-stmt', amount: 81250, covers_through: null }, created: false });
    payments.update.mockResolvedValueOnce({ id: 'p-stmt' });
    await service.markPaid({ ...input, covers_through: '2027-03' });
    expect(payments.update).toHaveBeenCalledWith('p-stmt', { covers_through: '2027-03' });
  });

  it('refuses coverage that does not reach past the instalment', async () => {
    await expect(service.markPaid({ ...input, covers_through: '2025-03' })).rejects.toThrow(/covers_through/);
  });
});

describe('CommitmentService validation', () => {
  it('refuses a match fragment too short to mean anything', async () => {
    await expect(service.create({ ...loan, match_text: 'lic' })).rejects.toThrow(/match_text/);
  });

  it('refuses an end month before the start', async () => {
    await expect(service.create({ ...loan, end_month: '2024-12' })).rejects.toThrow(/end_month/);
  });
});

// The ₹63,529 HDFC ERGO premium (15 Oct 2026) was recorded as an expense before its commitment
// existed, and October read as a spike. Declaring it now also sweeps such expenses.
describe('CommitmentService.claimRecordedExpenses', () => {
  const ergo: Commitment = { ...loan, id: 'c-ergo', name: 'HDFC ERGO family health', kind: 'insurance', amount: 19643.22, frequency: 'annual', start_month: '2026-10', due_day: 15, match_text: 'HDFC ERGO' };
  const expense = (over: object) => ({ id: 'e-1', date: '2026-10-15', amount: 68516.22, description: 'HDFC ERGO GIC OTHER', merchant: 'HDFC ERGO GIC OTHER', inbox_item_id: 'item-1', expense_tags: [], ...over });

  it('moves an expense that matches a commitment into its payments', async () => {
    const db = createSupabaseMock({ data: [expense({}), expense({ id: 'e-2', description: 'Groceries', merchant: 'DMART', amount: 900 })], error: null });
    commitments.listAll.mockResolvedValue([ergo]);
    decisionService.commitExpense.mockResolvedValue({ id: 'd-1' });

    const moved = await new CommitmentService(db.client).claimRecordedExpenses();

    expect(moved).toBe(1);
    expect(decisionService.commitExpense).toHaveBeenCalledTimes(1);
    expect(decisionService.commitExpense).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e-1' }),
      expect.objectContaining({ commitment: expect.objectContaining({ id: 'c-ergo' }), dueMonth: '2026-10' })
    );
    // From the earliest start month only: nothing older is read.
    expect(db.argsFor('gte')).toEqual([['date', '2026-10-01']]);
  });

  it('leaves an expense alone when it falls far from any due date', async () => {
    const db = createSupabaseMock({ data: [expense({ date: '2027-04-20' })], error: null });
    commitments.listAll.mockResolvedValue([ergo]);

    expect(await new CommitmentService(db.client).claimRecordedExpenses()).toBe(0);
    expect(decisionService.commitExpense).not.toHaveBeenCalled();
  });

  it('reads nothing when no commitment has a bank text to match', async () => {
    const db = createSupabaseMock({ data: [], error: null });
    commitments.listAll.mockResolvedValue([{ ...ergo, match_text: null }]);

    expect(await new CommitmentService(db.client).claimRecordedExpenses()).toBe(0);
    expect(db.from).not.toHaveBeenCalled();
  });
});
