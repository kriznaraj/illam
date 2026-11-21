import { describe, it, expect, vi, beforeEach } from 'vitest';

const repos = vi.hoisted(() => ({
  expenses: { findById: vi.fn(), delete: vi.fn(), update: vi.fn(), findReconcileCandidates: vi.fn() },
  inbox: { updateConsumed: vi.fn() },
  lines: { repointExpense: vi.fn(), ignoreExpense: vi.fn() },
}));
const mockAs = vi.hoisted(
  () => (repo: unknown) =>
    class {
      constructor() {
        return repo as any;
      }
    }
);
vi.mock('@/lib/repositories/ExpenseRepository', () => ({ ExpenseRepository: mockAs(repos.expenses) }));
vi.mock('@/lib/repositories/InboxRepository', () => ({ InboxRepository: mockAs(repos.inbox) }));
vi.mock('@/lib/repositories/StatementTransactionRepository', () => ({ StatementTransactionRepository: mockAs(repos.lines) }));

import { ExpenseReviewService } from '../ExpenseReviewService';

// The real double of 2026-08-23: an auto-added copy of a hand-logged Amazon order.
const AUTO = '725ecdfe-12c1-4e31-97db-812d31d0c5f0';
const MANUAL = '5962e066-ce94-44c5-bca4-a2e216eed719';
const auto = {
  id: AUTO,
  date: '2026-08-23',
  amount: 5699.95,
  description: 'AMAZON PAY IN E COMMERCE',
  needs_review: true,
  source: 'inbox',
  inbox_item_id: 'alert-2',
  payment_method: 'ICICI Bank card ••4123',
  merchant: 'AMAZON PAY IN E COMMERCE',
};
const manual = { id: MANUAL, date: '2026-08-23', amount: 5699.95, description: 'Online purchase', needs_review: false, source: 'manual', inbox_item_id: null, payment_method: null, merchant: null };

let service: ExpenseReviewService;

beforeEach(() => {
  vi.clearAllMocks();
  repos.expenses.findById.mockImplementation(async (id: string) => (id === AUTO ? auto : id === MANUAL ? manual : null));
  service = new ExpenseReviewService({} as any);
});

describe('ExpenseReviewService', () => {
  it('lists same-amount expenses nearby, confirmed first', async () => {
    repos.expenses.findReconcileCandidates.mockResolvedValue([
      { ...auto },
      { id: 'other-review', date: '2026-08-23', amount: 5699.95, needs_review: true },
      { id: MANUAL, date: '2026-08-24', amount: 5699.95, needs_review: false },
      { id: 'different', date: '2026-08-23', amount: 100, needs_review: false },
    ]);

    const candidates = await service.duplicateCandidates(AUTO);

    expect(repos.expenses.findReconcileCandidates).toHaveBeenCalledWith('2026-08-20', '2026-08-26');
    expect(candidates.map((c) => c.id)).toEqual([MANUAL, 'other-review']);
  });

  it('merges a duplicate into the kept expense, moving its alert, statement lines and payment details', async () => {
    await service.mergeInto(AUTO, MANUAL);

    expect(repos.lines.repointExpense).toHaveBeenCalledWith(AUTO, MANUAL);
    expect(repos.expenses.delete).toHaveBeenCalledWith(AUTO);
    expect(repos.expenses.update).toHaveBeenCalledWith(MANUAL, {
      payment_method: 'ICICI Bank card ••4123',
      merchant: 'AMAZON PAY IN E COMMERCE',
      inbox_item_id: 'alert-2',
    });
    expect(repos.inbox.updateConsumed).toHaveBeenCalledWith(
      'alert-2',
      expect.objectContaining({ action: 'linked', expense_id: MANUAL }),
      { needs_attention: false, attention_reason: null }
    );
    // The duplicate must be gone before the kept expense takes its alert (one alert, one expense).
    expect(repos.expenses.delete.mock.invocationCallOrder[0]).toBeLessThan(repos.expenses.update.mock.invocationCallOrder[0]);
  });

  it('dismisses an expense that was not spending, so its alert and lines never add it back', async () => {
    await service.dismiss(AUTO);

    expect(repos.lines.ignoreExpense).toHaveBeenCalledWith(AUTO);
    expect(repos.expenses.delete).toHaveBeenCalledWith(AUTO);
    expect(repos.inbox.updateConsumed).toHaveBeenCalledWith(
      'alert-2',
      expect.objectContaining({ action: 'ignored' }),
      { needs_attention: false, attention_reason: null }
    );
  });

  it('refuses to merge or dismiss an expense someone already confirmed, or across amounts', async () => {
    await expect(service.dismiss(MANUAL)).rejects.toThrow('Only an expense awaiting review');
    repos.expenses.findById.mockImplementation(async (id: string) => (id === AUTO ? auto : { ...manual, amount: 100 }));
    await expect(service.mergeInto(AUTO, MANUAL)).rejects.toThrow('same amount');
    expect(repos.expenses.delete).not.toHaveBeenCalled();
  });
});
