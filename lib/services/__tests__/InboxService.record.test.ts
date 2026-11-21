import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InboxItem, InboxTransactionData } from '@/types';

const { repo, expenses, incomeRepo, transfers, users, incomeService, expenseService } = vi.hoisted(() => ({
  repo: { findById: vi.fn(), updateConsumed: vi.fn(), update: vi.fn(), updateItem: vi.fn() },
  expenses: { findById: vi.fn(), delete: vi.fn() },
  transfers: { findByInboxItem: vi.fn() },
  users: { findByUsername: vi.fn() },
  incomeService: { recordFromInbox: vi.fn() },
  incomeRepo: { findById: vi.fn() },
  expenseService: { createExpense: vi.fn() },
}));

// Each factory builds its own class: vi.mock is hoisted above every top-level binding.
vi.mock('@/lib/repositories/InboxRepository', () => ({
  InboxRepository: class { constructor() { return repo as never; } },
}));
vi.mock('@/lib/repositories/ExpenseRepository', () => ({
  ExpenseRepository: class { constructor() { return expenses as never; } },
}));
vi.mock('@/lib/repositories/IncomeRepository', () => ({
  IncomeRepository: class { constructor() { return incomeRepo as never; } },
}));
vi.mock('@/lib/repositories/TransferRepository', () => ({
  TransferRepository: class { constructor() { return transfers as never; } },
}));
vi.mock('@/lib/repositories/UserRepository', () => ({
  UserRepository: class { constructor() { return users as never; } },
}));
vi.mock('../IncomeService', () => ({
  IncomeService: class { constructor() { return incomeService as never; } },
}));
vi.mock('../ExpenseService', () => ({
  ExpenseService: class { constructor() { return expenseService as never; } },
}));
vi.mock('@/lib/cache-invalidation', () => ({ invalidateInsightsCache: vi.fn() }));

import { InboxService } from '../InboxService';

const ITEM_ID = '123e4567-e89b-12d3-a456-426614174000';
const CATEGORY_ID = '53688707-b9ac-44cf-a6ce-115655126749';
const USER_ID = '5ca66709-e8de-4be9-8135-8bdb519055f4';

const txn = (over: Partial<InboxTransactionData> = {}): InboxTransactionData => ({
  kind: 'transaction',
  bank: 'HDFC Bank',
  amount: 2200,
  currency: 'INR',
  direction: 'debit',
  instrument: 'upi',
  last4: '3101',
  merchant: 'GANESH KUMAR R',
  txnDate: '2026-09-19',
  available: null,
  outcome: 'success',
  international: false,
  ...over,
});

const item = (over: Partial<InboxItem> = {}): InboxItem =>
  ({
    id: ITEM_ID,
    owner: 'alice',
    kind: 'transaction',
    title: 'GANESH KUMAR R',
    summary: 'Debit · HDFC Bank UPI ••3101',
    received_at: '2026-09-19T03:25:09Z',
    status: 'new',
    consumed: null,
    needs_attention: false,
    attention_reason: null,
    action_by: null,
    attachment_names: [],
    data: txn(),
    ...over,
  }) as InboxItem;

let service: InboxService;

beforeEach(() => {
  vi.clearAllMocks();
  users.findByUsername.mockResolvedValue({ id: USER_ID });
  transfers.findByInboxItem.mockResolvedValue(null);
  repo.updateConsumed.mockResolvedValue(undefined);
  expenseService.createExpense.mockResolvedValue({ id: 'expense-1' });
  incomeService.recordFromInbox.mockResolvedValue({ id: 'income-1' });
  incomeRepo.findById.mockResolvedValue({ id: 'income-existing' });
  service = new InboxService({} as never);
});

describe('InboxService.record', () => {
  it('adds a debit to Selavu as a confirmed expense, whatever automation decided', async () => {
    // history_unmatched is the state 27 live alerts were left in: dated before the go-live cut,
    // acted on once, and with nothing in the UI to press afterwards.
    repo.findById.mockResolvedValue(item({ consumed: { action: 'history_unmatched', at: '2026-09-14T00:00:00Z' } }));

    const result = await service.record(ITEM_ID, { as: 'expense', category_id: CATEGORY_ID });

    expect(result.expenseId).toBe('expense-1');
    expect(expenseService.createExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-09-19',
        amount: 2200,
        category_id: CATEGORY_ID,
        inbox_item_id: ITEM_ID,
        // A person chose this, so it counts immediately rather than waiting for review.
        needs_review: false,
      })
    );
    expect(repo.updateConsumed).toHaveBeenCalledWith(
      ITEM_ID,
      expect.objectContaining({ action: 'created', expense_id: 'expense-1' }),
      { needs_attention: false, attention_reason: null }
    );
  });

  it('records a credit as income', async () => {
    repo.findById.mockResolvedValue(
      item({
        consumed: { action: 'ignored', reason: 'credit', at: '2026-09-14T00:00:00Z' },
        data: txn({ direction: 'credit', amount: 3.96, currency: 'USD', merchant: 'Microsoft Inc', purpose: 'dividend' }),
      })
    );

    const result = await service.record(ITEM_ID, { as: 'income', kind: 'dividend' });

    expect(result.incomeId).toBe('income-1');
    expect(incomeService.recordFromInbox).toHaveBeenCalledWith(
      // Stored in the currency it was paid in — there is no rate here to make rupees with.
      expect.objectContaining({ amount: 3.96, currency: 'USD', kind: 'dividend', source_name: 'Microsoft Inc' })
    );
  });

  it('refuses to cross directions, so money in is never booked as money out', async () => {
    repo.findById.mockResolvedValue(item({ data: txn({ direction: 'credit' }) }));
    await expect(service.record(ITEM_ID, { as: 'expense', category_id: CATEGORY_ID })).rejects.toThrow(
      /cannot be recorded as an expense/i
    );

    repo.findById.mockResolvedValue(item());
    await expect(service.record(ITEM_ID, { as: 'income', kind: 'salary' })).rejects.toThrow(/cannot be recorded as income/i);
    expect(expenseService.createExpense).not.toHaveBeenCalled();
    expect(incomeService.recordFromInbox).not.toHaveBeenCalled();
  });

  it('will not record a foreign-currency spend, having no rate to turn it into rupees', async () => {
    repo.findById.mockResolvedValue(item({ data: txn({ currency: 'USD', amount: 20 }) }));
    await expect(service.record(ITEM_ID, { as: 'expense', category_id: CATEGORY_ID })).rejects.toThrow(/cannot be recorded in USD/);
  });

  it('leaves an alert the transfer sheet owns alone, so the money is not recorded twice', async () => {
    repo.findById.mockResolvedValue(item({ consumed: { action: 'transfer', transfer_id: 't-1', at: '2026-09-14T00:00:00Z' } }));
    transfers.findByInboxItem.mockResolvedValue({ id: 't-1', status: 'needs_review' });

    await expect(service.record(ITEM_ID, { as: 'expense', category_id: CATEGORY_ID })).rejects.toThrow(/classify it there/i);
    expect(expenseService.createExpense).not.toHaveBeenCalled();
  });

  it('returns the record an alert already produced instead of making a second one', async () => {
    repo.findById.mockResolvedValue(item({ consumed: { action: 'created', expense_id: 'expense-existing', at: '2026-09-14T00:00:00Z' } }));
    expenses.findById.mockResolvedValue({ id: 'expense-existing' });

    const result = await service.record(ITEM_ID, { as: 'expense', category_id: CATEGORY_ID });

    expect(result.expenseId).toBe('expense-existing');
    expect(expenseService.createExpense).not.toHaveBeenCalled();
  });

  it('lets an alert be recorded again once its expense was deleted as "not an expense"', async () => {
    repo.findById.mockResolvedValue(item({ consumed: { action: 'created', expense_id: 'expense-gone', at: '2026-09-14T00:00:00Z' } }));
    expenses.findById.mockResolvedValue(null);

    const result = await service.record(ITEM_ID, { as: 'expense', category_id: CATEGORY_ID });
    expect(result.expenseId).toBe('expense-1');
  });

  it('sets an alert aside without writing any money record', async () => {
    repo.findById.mockResolvedValue(item());
    const result = await service.record(ITEM_ID, { as: 'ignore' });

    expect(result).toMatchObject({ expenseId: null, incomeId: null });
    expect(repo.updateConsumed).toHaveBeenCalledWith(ITEM_ID, expect.objectContaining({ action: 'ignored' }), expect.anything());
    expect(expenseService.createExpense).not.toHaveBeenCalled();
  });

  it('lets a credit be recorded again once its income row was deleted', async () => {
    repo.findById.mockResolvedValue(
      item({
        consumed: { action: 'income', income_id: 'income-gone', at: '2026-09-19T00:00:00Z' },
        data: txn({ direction: 'credit', amount: 3.96, currency: 'USD', merchant: 'Microsoft Inc' }),
      })
    );
    incomeRepo.findById.mockResolvedValue(null);

    const result = await service.record(ITEM_ID, { as: 'income', kind: 'dividend' });
    expect(result.incomeId).toBe('income-1');
  });
});
