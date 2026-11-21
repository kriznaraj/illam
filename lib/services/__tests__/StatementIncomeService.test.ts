import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transfer } from '@/types';

const incomeRepo = vi.hoisted(() => ({ findStatementRefs: vi.fn(), findByDateRange: vi.fn() }));
const incomeService = vi.hoisted(() => ({ create: vi.fn() }));
const transfers = vi.hoisted(() => ({ list: vi.fn() }));
const transferService = vi.hoisted(() => ({ apply: vi.fn() }));
const users = vi.hoisted(() => ({ findByUsername: vi.fn() }));

vi.mock('@/lib/repositories/IncomeRepository', () => ({ IncomeRepository: class { constructor() { return incomeRepo as any; } } }));
vi.mock('../IncomeService', async (original) => ({
  ...(await original<typeof import('../IncomeService')>()),
  IncomeService: class { constructor() { return incomeService as any; } },
}));
vi.mock('@/lib/repositories/TransferRepository', () => ({ TransferRepository: class { constructor() { return transfers as any; } } }));
vi.mock('../TransferService', () => ({ TransferService: class { constructor() { return transferService as any; } } }));
vi.mock('@/lib/repositories/UserRepository', () => ({ UserRepository: class { constructor() { return users as any; } } }));

import { StatementIncomeService } from '../StatementIncomeService';

const SALARY = 'A2AINT01 - ACME TECHNOLOGIES PVT LTD0979 - Salary - ACME Salary July 26 Value Dt 30/07/2026';
const salaryLine = { date: '2026-07-30', narration: SALARY, direction: 'credit' as const, amount: 150000, balance: 1 };
const REF = 'hdfc_account_statement:3101:2026-07-30:credit:150000.00:1';

const transfer = (over: Partial<Transfer>): Transfer =>
  ({
    id: 't-1',
    owner: 'alice',
    date: '2026-07-30',
    amount: 150000,
    direction: 'credit',
    payment_method: 'HDFC Bank account ••3101',
    kind: 'other',
    status: 'needs_review',
    created_at: '2026-07-30T10:00:00Z',
    ...over,
  }) as Transfer;

let service: StatementIncomeService;
beforeEach(() => {
  vi.clearAllMocks();
  users.findByUsername.mockResolvedValue({ id: 'user-k' });
  incomeRepo.findStatementRefs.mockResolvedValue(new Set());
  incomeRepo.findByDateRange.mockResolvedValue([]);
  transfers.list.mockResolvedValue([]);
  incomeService.create.mockResolvedValue({ id: 'inc-1' });
  service = new StatementIncomeService({} as any);
});

const read = () => service.record('alice', 'hdfc_account_statement', 'HDFC', [{ last4: '3101', lines: [salaryLine] }]);

describe('StatementIncomeService.record', () => {
  it('records a salary line as income, keyed by the line', async () => {
    const outcome = await read();
    expect(incomeService.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'salary', amount: 150000, user_id: 'user-k', source: 'statement', statement_ref: REF, source_name: 'ACME TECHNOLOGIES PVT LTD' })
    );
    expect(outcome).toEqual({ recorded: [{ kind: 'salary', amount: 150000 }], settled: 0 });
  });

  it('adds nothing when the statement is read again', async () => {
    incomeRepo.findStatementRefs.mockResolvedValue(new Set([REF]));
    await read();
    expect(incomeService.create).not.toHaveBeenCalled();
  });

  it('files a credit Madal is waiting on as income instead of writing a second row', async () => {
    const waiting = transfer({});
    transfers.list.mockResolvedValue([waiting]);
    const outcome = await read();
    expect(transferService.apply).toHaveBeenCalledWith(waiting, expect.objectContaining({ kind: 'income', income_kind: 'salary' }));
    expect(incomeService.create).not.toHaveBeenCalled();
    expect(outcome.settled).toBe(1);
  });

  it('leaves a credit a person already decided alone', async () => {
    transfers.list.mockResolvedValue([transfer({ status: 'confirmed', kind: 'family' })]);
    await read();
    expect(transferService.apply).not.toHaveBeenCalled();
    expect(incomeService.create).not.toHaveBeenCalled();
  });

  it('treats a hand entry of the same amount within three days as the same money', async () => {
    incomeRepo.findByDateRange.mockResolvedValue([{ id: 'i-hand', user_id: 'user-k', amount: 150000, date: '2026-07-31', source: 'manual' }]);
    await read();
    expect(incomeService.create).not.toHaveBeenCalled();
  });
});
