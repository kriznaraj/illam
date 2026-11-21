import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MadalDecision, Transfer } from '@/types';
import { createSupabaseMock } from '@/lib/repositories/__tests__/supabaseMock';

const decisions = vi.hoisted(() => ({ record: vi.fn(), delete: vi.fn(), findById: vi.fn(), markUndone: vi.fn(), update: vi.fn() }));
const transfers = vi.hoisted(() => ({ update: vi.fn(), findById: vi.fn() }));
const expenses = vi.hoisted(() => ({ update: vi.fn() }));
const inbox = vi.hoisted(() => ({ clearAttention: vi.fn(), updateConsumed: vi.fn() }));
const payments = vi.hoisted(() => ({ recordOnce: vi.fn(), delete: vi.fn() }));
const invalidate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repositories/MadalDecisionRepository', () => ({ MadalDecisionRepository: class { constructor() { return decisions as any; } } }));
vi.mock('@/lib/repositories/TransferRepository', () => ({ TransferRepository: class { constructor() { return transfers as any; } } }));
vi.mock('@/lib/repositories/ExpenseRepository', () => ({ ExpenseRepository: class { constructor() { return expenses as any; } } }));
vi.mock('@/lib/repositories/InboxRepository', () => ({ InboxRepository: class { constructor() { return inbox as any; } } }));
vi.mock('@/lib/repositories/CommitmentRepository', () => ({ CommitmentPaymentRepository: class { constructor() { return payments as any; } } }));
vi.mock('@/lib/cache-invalidation', () => ({ invalidateInsightsCache: invalidate }));

import { MadalDecisionService } from '../MadalDecisionService';

const filed = (over: Partial<Transfer> = {}): Transfer =>
  ({
    id: 't-49k',
    inbox_item_id: 'item-49k',
    owner: 'alice',
    date: '2026-08-07',
    amount: 47775,
    direction: 'debit',
    counterparty: 'INDMONEY',
    payment_method: 'HDFC Bank account ••3101',
    kind: 'investment',
    account_id: 'acc-us',
    portfolio_investment_id: 'inv-1',
    credit_card_statement_id: null,
    expense_id: null,
    note: 'Account transfer (NEFT/IMPS)',
    status: 'confirmed',
    sip_fund: null,
    sip_month: null,
    created_at: '2026-08-07T10:00:00Z',
    updated_at: '2026-08-07T10:00:00Z',
    ...over,
  }) as Transfer;

/** The row TransferService.recordInvestment inserts for a confirmed investment transfer. */
const createdRow = {
  id: 'inv-1',
  account_id: 'acc-us',
  investment_date: '2026-08-07',
  amount: 47775,
  kind: 'adhoc',
  note: 'INDMONEY · HDFC Bank account ••3101',
  transfer_id: 't-49k',
};

const refile = { note: 'Statement: …1303-TPT-…-K BOB', reason: 'The bank statement shows this went to Bob…', evidence: '…1303-TPT-…-K BOB' };

beforeEach(() => {
  vi.clearAllMocks();
  decisions.record.mockImplementation(async (row: object) => ({ id: 'decision-1', created_at: 'now', undone_at: null, ...row }));
  transfers.update.mockResolvedValue({});
});

describe('MadalDecisionService.refileAsFamily', () => {
  it('records the undo first, then deletes the contribution the transfer created and refiles it', async () => {
    const db = createSupabaseMock([{ data: createdRow, error: null }, { data: null, error: null }]);
    const service = new MadalDecisionService(db.client);

    await service.refileAsFamily(filed(), refile);

    expect(decisions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        decided_by: 'statement',
        action: 'refiled',
        kind: 'family',
        before: {
          transfer: expect.objectContaining({ kind: 'investment', account_id: 'acc-us', portfolio_investment_id: 'inv-1', status: 'confirmed' }),
          investments: [{ row: createdRow, removal: 'deleted' }],
        },
      })
    );
    expect(db.argsFor('delete')).toEqual([[]]);
    expect(transfers.update).toHaveBeenCalledWith('t-49k', expect.objectContaining({ kind: 'family', portfolio_investment_id: null, account_id: null, status: 'confirmed' }));
    // The record precedes the change: no refile without its undo.
    expect(decisions.record.mock.invocationCallOrder[0]).toBeLessThan(transfers.update.mock.invocationCallOrder[0]);
  });

  it('only unlinks a hand-entered contribution the transfer had linked', async () => {
    const handEntry = { ...createdRow, note: 'typed by hand', investment_date: '2026-08-06' };
    const db = createSupabaseMock([{ data: handEntry, error: null }, { data: null, error: null }]);
    const service = new MadalDecisionService(db.client);

    await service.refileAsFamily(filed(), refile);

    expect(db.argsFor('delete')).toEqual([]);
    expect(db.argsFor('update')).toEqual([[{ transfer_id: null }]]);
  });

  it('changes nothing when the undo record cannot be written', async () => {
    const db = createSupabaseMock({ data: createdRow, error: null });
    decisions.record.mockRejectedValueOnce(new Error("Could not find the table 'public.madal_decisions'"));
    const service = new MadalDecisionService(db.client);

    await expect(service.refileAsFamily(filed(), refile)).rejects.toThrow(/madal_decisions/);
    expect(transfers.update).not.toHaveBeenCalled();
    expect(db.argsFor('delete')).toEqual([]);
  });
});

describe('MadalDecisionService.undo', () => {
  const decision = (over: Partial<MadalDecision>): MadalDecision => ({
    id: 'decision-1',
    inbox_item_id: 'item-49k',
    transfer_id: 't-49k',
    expense_id: null,
    decided_by: 'statement',
    action: 'refiled',
    kind: 'family',
    reason: 'r',
    evidence: 'e',
    evidence_key: 'e',
    before: {},
    model: null,
    created_at: 'then',
    undone_at: null,
    ...over,
  });

  it('puts the contribution back, then the transfer as it was', async () => {
    const db = createSupabaseMock({ data: null, error: null });
    const service = new MadalDecisionService(db.client);
    const before = { transfer: { kind: 'investment', account_id: 'acc-us', portfolio_investment_id: 'inv-1', status: 'confirmed' }, investments: [{ row: createdRow, removal: 'deleted' }] };
    decisions.findById.mockResolvedValue(decision({ before }));
    transfers.findById.mockResolvedValue(filed({ kind: 'family' }));

    await service.undo('decision-1', new Date('2026-10-19T00:00:00Z'));

    expect(db.argsFor('insert')).toEqual([[[createdRow]]]);
    expect(transfers.update).toHaveBeenCalledWith('t-49k', before.transfer);
    expect(decisions.markUndone).toHaveBeenCalledWith('decision-1', '2026-10-19T00:00:00.000Z');
  });

  it('restores the category an AI re-file replaced', async () => {
    const service = new MadalDecisionService(createSupabaseMock({ data: null, error: null }).client);
    decisions.findById.mockResolvedValue(
      decision({ action: 'categorised', transfer_id: null, expense_id: 'exp-1', before: { category_id: 'cat-misc' } })
    );

    await service.undo('decision-1');

    expect(expenses.update).toHaveBeenCalledWith('exp-1', { category_id: 'cat-misc' });
  });

  it('refuses to undo twice', async () => {
    const service = new MadalDecisionService(createSupabaseMock({ data: null, error: null }).client);
    decisions.findById.mockResolvedValue(decision({ undone_at: 'already' }));

    await expect(service.undo('decision-1')).rejects.toThrow(/already undone/);
  });
});

describe('MadalDecisionService.commitExpense', () => {
  const premium = {
    id: 'e-ergo',
    date: '2026-10-15',
    amount: 68516.22,
    description: 'HDFC ERGO GIC OTHER',
    merchant: 'HDFC ERGO GIC OTHER',
    inbox_item_id: 'item-ergo',
    category: { name: 'Miscellaneous' },
    expense_tags: [{ tag_id: 'tag-auto' }],
  };
  const match = { commitment: { id: 'c-ergo', name: 'HDFC ERGO family health' } as any, dueMonth: '2026-10' };

  it('records the payment, removes the expense and consumes its alert as the commitment', async () => {
    const db = createSupabaseMock({ data: null, error: null });
    payments.recordOnce.mockResolvedValue({ payment: { id: 'p-ergo' }, created: true });

    await new MadalDecisionService(db.client).commitExpense(premium as any, match);

    expect(decisions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'committed',
        expense_id: 'e-ergo',
        // The joined category is not a column, so it is not kept for re-insert.
        before: { expense: expect.not.objectContaining({ category: expect.anything() }), tag_ids: ['tag-auto'], payment_id: null },
      })
    );
    expect(payments.recordOnce).toHaveBeenCalledWith(expect.objectContaining({ commitment_id: 'c-ergo', due_month: '2026-10', amount: 68516.22, source: 'alert' }));
    expect(decisions.update).toHaveBeenCalledWith('decision-1', { before: expect.objectContaining({ payment_id: 'p-ergo' }) });
    expect(db.argsFor('from')).toEqual([['expense_tags'], ['expenses']]);
    expect(inbox.updateConsumed).toHaveBeenCalledWith('item-ergo', expect.objectContaining({ action: 'ignored', reason: 'commitment: HDFC ERGO family health' }), expect.anything());
    expect(invalidate).toHaveBeenCalledWith(expect.anything(), '2026-10-15');
  });

  it('undoes it: the expense, its tags and its alert come back, the payment goes', async () => {
    const db = createSupabaseMock({ data: null, error: null });
    decisions.findById.mockResolvedValue({
      id: 'decision-1',
      action: 'committed',
      transfer_id: null,
      expense_id: 'e-ergo',
      undone_at: null,
      before: { expense: { id: 'e-ergo', date: '2026-10-15', amount: 68516.22, inbox_item_id: 'item-ergo' }, tag_ids: ['tag-auto'], payment_id: 'p-ergo' },
    });

    await new MadalDecisionService(db.client).undo('decision-1');

    expect(db.argsFor('insert')).toEqual([[[{ id: 'e-ergo', date: '2026-10-15', amount: 68516.22, inbox_item_id: 'item-ergo' }]], [[{ expense_id: 'e-ergo', tag_id: 'tag-auto' }]]]);
    expect(payments.delete).toHaveBeenCalledWith('p-ergo');
    expect(inbox.updateConsumed).toHaveBeenCalledWith('item-ergo', expect.objectContaining({ action: 'created', expense_id: 'e-ergo' }));
  });
});
