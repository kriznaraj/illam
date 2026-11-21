import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transfer } from '@/types';

const ai = vi.hoisted(() => ({ complete: vi.fn(), enabled: true }));
const transfers = vi.hoisted(() => ({ list: vi.fn() }));
const log = vi.hoisted(() => ({ decidedKeys: vi.fn() }));
const decisions = vi.hoisted(() => ({ classify: vi.fn(), suggest: vi.fn(), categorise: vi.fn(), noteExpenseTried: vi.fn() }));
const expenses = vi.hoisted(() => ({ findUndecidedInboxExpenses: vi.fn() }));
const categories = vi.hoisted(() => ({ findAllSorted: vi.fn() }));
const categorizer = vi.hoisted(() => ({ suggestOne: vi.fn() }));

vi.mock('@/lib/ai', () => ({
  getProvider: () => ({ complete: ai.complete }),
  isAIEnabled: () => ai.enabled,
  TASKS: { 'classify-expense': { model: 'claude-haiku-5-5' } },
}));
vi.mock('@/lib/repositories/TransferRepository', () => ({ TransferRepository: class { constructor() { return transfers as any; } } }));
vi.mock('@/lib/repositories/MadalDecisionRepository', () => ({ MadalDecisionRepository: class { constructor() { return log as any; } } }));
vi.mock('../MadalDecisionService', () => ({ MadalDecisionService: class { constructor() { return decisions as any; } } }));
vi.mock('@/lib/repositories/ExpenseRepository', () => ({ ExpenseRepository: class { constructor() { return expenses as any; } } }));
vi.mock('@/lib/repositories/CategoryRepository', () => ({ CategoryRepository: class { constructor() { return categories as any; } } }));
vi.mock('@/lib/repositories/CommitmentRepository', () => ({ CommitmentRepository: class { listAll = async () => []; } }));
vi.mock('../ExpenseCategorizationService', () => ({ ExpenseCategorizationService: class { constructor() { return categorizer as any; } } }));

import { TransferResolverService } from '../TransferResolverService';
import { evidenceKey } from '@/lib/inbox/automation/claudeResolve';

const NOW = new Date('2026-10-18T12:00:00Z');
const waiting = (over: Partial<Transfer> = {}): Transfer =>
  ({
    id: 't-1',
    inbox_item_id: 'item-1',
    owner: 'alice',
    date: '2026-09-08',
    amount: 25000,
    direction: 'debit',
    counterparty: null,
    payment_method: 'HDFC Bank account ••3101',
    kind: 'other',
    note: 'Statement: NEFT DR-HDFC0000001-BOB K-NETBANK',
    status: 'needs_review',
    ...over,
  }) as Transfer;

const answer = (data: object) => ({ ok: true, data, usage: { model: 'claude-sonnet-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 } });
const run = () => new TransferResolverService({} as any).run({ now: NOW, deadline: Date.now() + 60_000 });

beforeEach(() => {
  vi.clearAllMocks();
  ai.enabled = true;
  log.decidedKeys.mockResolvedValue(new Set());
  expenses.findUndecidedInboxExpenses.mockResolvedValue([]);
  categories.findAllSorted.mockResolvedValue([{ id: 'cat-misc', name: 'Miscellaneous' }, { id: 'cat-health', name: 'Healthcare' }]);
});

describe('TransferResolverService.run', () => {
  it('applies a confident answer whose quote is really in the statement line', async () => {
    transfers.list.mockResolvedValue([waiting()]);
    ai.complete.mockResolvedValue(answer({ kind: 'family', confidence: 'high', reason: 'To Bob.', quote: 'BOB K-NETBANK' }));

    const outcome = await run();

    expect(decisions.classify).toHaveBeenCalledWith(expect.objectContaining({ id: 't-1' }), expect.objectContaining({ kind: 'family', evidence: 'BOB K-NETBANK' }));
    expect(outcome.classified).toBe(1);
  });

  it('only suggests when the quote is not in the evidence', async () => {
    transfers.list.mockResolvedValue([waiting()]);
    ai.complete.mockResolvedValue(answer({ kind: 'family', confidence: 'high', reason: 'To Bob.', quote: 'Transfer to wife' }));

    const outcome = await run();

    expect(decisions.classify).not.toHaveBeenCalled();
    expect(decisions.suggest).toHaveBeenCalledWith(expect.objectContaining({ id: 't-1' }), expect.objectContaining({ kind: 'family' }));
    expect(outcome.suggested).toBe(1);
  });

  it('does not ask about a transfer still waiting on its statement', async () => {
    transfers.list.mockResolvedValue([waiting({ date: '2026-10-14', note: 'Account transfer (NEFT/IMPS)' })]);

    await run();

    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('does not ask twice on the same evidence', async () => {
    const t = waiting();
    transfers.list.mockResolvedValue([t]);
    log.decidedKeys.mockResolvedValue(new Set([`t-1|${evidenceKey(t)}`]));

    await run();

    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('records nothing when the call fails, so the next run asks again', async () => {
    transfers.list.mockResolvedValue([waiting()]);
    ai.complete.mockResolvedValue({ ok: false, error: { kind: 'timeout', message: 'slow' } });

    await run();

    expect(decisions.classify).not.toHaveBeenCalled();
    expect(decisions.suggest).not.toHaveBeenCalled();
  });

  it('does nothing at all without a key', async () => {
    ai.enabled = false;
    transfers.list.mockResolvedValue([waiting()]);

    expect(await run()).toEqual({ classified: 0, suggested: 0, categorised: 0 });
    expect(transfers.list).not.toHaveBeenCalled();
  });

  it('re-files an expense left in Miscellaneous when Claude is confident', async () => {
    transfers.list.mockResolvedValue([]);
    expenses.findUndecidedInboxExpenses.mockResolvedValue([
      { id: 'exp-ergo', merchant: 'HDFC ERGO GIC OTHER', description: 'HDFC ERGO GIC OTHER', amount: 68516.22, category_id: 'cat-misc', inbox_item_id: 'item-ergo' },
    ]);
    categorizer.suggestOne.mockResolvedValue({ categoryId: 'cat-health', categoryName: 'Healthcare', confidence: 'high', source: 'ai', reasoning: 'Health insurer.' });

    const outcome = await run();

    expect(decisions.categorise).toHaveBeenCalledWith(expect.objectContaining({ id: 'exp-ergo' }), expect.objectContaining({ categoryId: 'cat-health' }));
    expect(outcome.categorised).toBe(1);
  });
});
