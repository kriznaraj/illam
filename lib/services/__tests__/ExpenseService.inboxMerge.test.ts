import { describe, it, expect, vi, beforeEach } from 'vitest';

const repos = vi.hoisted(() => ({
  expense: {
    findUnreviewedInboxExpense: vi.fn(),
    createWithTags: vi.fn(),
    update: vi.fn(),
    updateTags: vi.fn(),
    findById: vi.fn(),
  },
  inbox: { clearAttention: vi.fn() },
}));

vi.mock('@/lib/repositories/ExpenseRepository', () => ({
  ExpenseRepository: class {
    constructor() {
      return repos.expense as any;
    }
  },
}));
vi.mock('@/lib/repositories/InboxRepository', () => ({
  InboxRepository: class {
    constructor() {
      return repos.inbox as any;
    }
  },
}));

import { ExpenseService } from '../ExpenseService';

const AUTO_ID = '123e4567-e89b-12d3-a456-426614174000';

const handEntry = {
  date: '2026-09-19',
  amount: 225,
  category_id: 'cat-grooming',
  description: 'Saloon',
  user_id: 'user-alice',
  tag_ids: ['tag-1'],
};

let service: ExpenseService;

beforeEach(() => {
  vi.clearAllMocks();
  repos.expense.createWithTags.mockResolvedValue({ id: 'new-expense', ...handEntry });
  repos.expense.update.mockResolvedValue({ id: AUTO_ID, inbox_item_id: 'item-1' });
  repos.expense.findById.mockResolvedValue({ id: AUTO_ID, inbox_item_id: 'item-1' });
  service = new ExpenseService({} as any);
});

// Madal auto-adds an unlogged spend after 24 h. If the person logs it by hand
// afterwards, the hand entry must replace the auto-added row, not sit beside it.
describe('ExpenseService.createExpense with auto-added duplicates', () => {
  it('folds a hand entry into the matching auto-added expense and confirms it', async () => {
    repos.expense.findUnreviewedInboxExpense.mockResolvedValue({ id: AUTO_ID, date: '2026-09-18', amount: 225 });

    const result = await service.createExpense(handEntry);

    expect(repos.expense.findUnreviewedInboxExpense).toHaveBeenCalledWith(225, '2026-09-19', 2);
    expect(repos.expense.createWithTags).not.toHaveBeenCalled();
    expect(repos.expense.update).toHaveBeenCalledWith(
      AUTO_ID,
      expect.objectContaining({ category_id: 'cat-grooming', description: 'Saloon', user_id: 'user-alice', needs_review: false })
    );
    expect(repos.expense.updateTags).toHaveBeenCalledWith(AUTO_ID, ['tag-1']);
    expect(repos.inbox.clearAttention).toHaveBeenCalledWith('item-1');
    expect(result.id).toBe(AUTO_ID);
  });

  it('creates normally when nothing was auto-added', async () => {
    repos.expense.findUnreviewedInboxExpense.mockResolvedValue(null);

    const result = await service.createExpense(handEntry);

    expect(repos.expense.createWithTags).toHaveBeenCalled();
    expect(result.id).toBe('new-expense');
  });

  // Before migration 030 the lookup's columns do not exist. Logging an expense must still work.
  it('still creates the expense when the duplicate lookup fails', async () => {
    repos.expense.findUnreviewedInboxExpense.mockRejectedValue(new Error('column expenses.source does not exist'));

    const result = await service.createExpense(handEntry);

    expect(repos.expense.createWithTags).toHaveBeenCalled();
    expect(result.id).toBe('new-expense');
  });

  it('does not look for duplicates when the expense itself comes from the inbox', async () => {
    await service.createExpense({ ...handEntry, source: 'inbox' });
    expect(repos.expense.findUnreviewedInboxExpense).not.toHaveBeenCalled();
  });
});
