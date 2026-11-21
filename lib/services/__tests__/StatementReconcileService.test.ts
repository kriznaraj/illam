import { describe, it, expect, vi, beforeEach } from 'vitest';

const repos = vi.hoisted(() => ({
  lines: { listForStatement: vi.fn(), listExpenseIdsBetween: vi.fn(), upsertMany: vi.fn() },
  expenses: { findReconcileCandidates: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
  inbox: { listTransactionsBetween: vi.fn(), updateItem: vi.fn(), updateConsumed: vi.fn() },
  categories: { findAllSorted: vi.fn() },
  users: { findByUsername: vi.fn() },
  appConfig: { getKeys: vi.fn() },
}));

const mockAs = vi.hoisted(
  () => (repo: unknown) =>
    class {
      constructor() {
        return repo as any;
      }
    }
);
vi.mock('@/lib/repositories/StatementTransactionRepository', () => ({ StatementTransactionRepository: mockAs(repos.lines) }));
vi.mock('@/lib/repositories/ExpenseRepository', () => ({ ExpenseRepository: mockAs(repos.expenses) }));
vi.mock('@/lib/repositories/InboxRepository', () => ({ InboxRepository: mockAs(repos.inbox) }));
vi.mock('@/lib/repositories/CategoryRepository', () => ({ CategoryRepository: mockAs(repos.categories) }));
vi.mock('@/lib/repositories/UserRepository', () => ({ UserRepository: mockAs(repos.users) }));
vi.mock('@/lib/repositories/AppConfigRepository', () => ({ AppConfigRepository: mockAs(repos.appConfig) }));

import { StatementReconcileService } from '../StatementReconcileService';

/*
 * Shaped like the real Axis ••2303 statement of Jun–Jul 2026: most lines already had
 * an expense, the two "Payment" alerts (Velmurugan ₹230, Apollo ₹156.92) did not name
 * their merchant, and fuel surcharges had no alert at all. Handles and ids invented.
 */
const alert = (id: string, date: string, amount: number, over: Record<string, unknown> = {}, consumed: unknown = null) => ({
  id,
  owner: 'alice',
  received_at: `${date}T10:00:00+05:30`,
  kind: 'transaction',
  title: 'Payment',
  consumed,
  data: {
    kind: 'transaction',
    bank: 'Axis Bank',
    amount,
    currency: 'INR',
    direction: 'debit',
    instrument: 'card',
    last4: '2303',
    merchant: null,
    txnDate: date,
    available: null,
    outcome: 'success',
    international: false,
    ...over,
  },
});

const expense = (over: Record<string, unknown>) => ({
  user_id: 'u-alice',
  created_at: '2026-07-01T00:00:00Z',
  inbox_item_id: null,
  merchant: null,
  payment_method: null,
  source: 'manual',
  needs_review: false,
  ...over,
});

const transactions = [
  { date: '2026-05-20', description: 'UPI/ESWARAN/Q12341111@YBL/12340001@SUPE', amount: 101, direction: 'debit' as const },
  { date: '2026-07-02', description: 'PAYMENT RECEIVED', amount: 4963, direction: 'credit' as const },
  { date: '2026-07-06', description: 'UPI/TEST GROCER/grocer@okaxis', amount: 500, direction: 'debit' as const },
  { date: '2026-07-09', description: 'CC-UPI FUEL SURCHARGE RUPAY CARD', amount: 10, direction: 'debit' as const },
  { date: '2026-07-12', description: 'UPI/VELMURUGAN  NATARAJAN/Q12340000@YBL/8', amount: 230, direction: 'debit' as const },
  { date: '2026-07-14', description: 'UPI/APOLLO PHARMACY/APOLLOPHARMACYTNPL@Y', amount: 156.92, direction: 'debit' as const },
];

const input = {
  statementId: 'st-1',
  accountId: 'acc-2303',
  owner: 'alice' as const,
  bank: 'Axis Bank',
  last4: '2303',
  transactions,
  now: new Date('2026-09-14T06:00:00Z'),
};

let service: StatementReconcileService;

beforeEach(() => {
  vi.clearAllMocks();
  repos.lines.listForStatement.mockResolvedValue([]);
  repos.lines.listExpenseIdsBetween.mockResolvedValue(new Set());
  repos.lines.upsertMany.mockResolvedValue(undefined);
  repos.expenses.findReconcileCandidates.mockResolvedValue([
    expense({ id: 'exp-230', date: '2026-07-12', amount: 230, inbox_item_id: 'alert-230', payment_method: 'Axis Bank card ••2303', description: 'Axis Bank card ••2303 payment', source: 'inbox', needs_review: true }),
    expense({ id: 'exp-upi-500', date: '2026-07-06', amount: 500, inbox_item_id: 'alert-upi', merchant: 'Shop', payment_method: 'HDFC Bank UPI ••3101', description: 'Shop', source: 'inbox' }),
    expense({ id: 'exp-manual-500', date: '2026-07-06', amount: 500, user_id: 'u-bob', description: 'Groceries' }),
  ]);
  repos.expenses.update.mockResolvedValue({});
  repos.expenses.create.mockResolvedValueOnce({ id: 'exp-new-1' }).mockResolvedValueOnce({ id: 'exp-new-2' });
  repos.inbox.listTransactionsBetween.mockResolvedValue([
    alert('alert-230', '2026-07-12', 230),
    alert('alert-145', '2026-07-14', 156.92, {}, { action: 'history_unmatched', at: '2026-09-14T00:00:00Z' }),
    alert('alert-upi', '2026-07-05', 500, { bank: 'HDFC Bank', instrument: 'upi', last4: '3101', merchant: 'Shop' }),
  ]);
  repos.inbox.updateItem.mockResolvedValue(undefined);
  repos.inbox.updateConsumed.mockResolvedValue(undefined);
  repos.categories.findAllSorted.mockResolvedValue([{ id: 'cat-misc', name: 'Miscellaneous' }]);
  repos.users.findByUsername.mockResolvedValue({ id: 'u-alice' });
  repos.appConfig.getKeys.mockResolvedValue({ data: [{ key: 'inbox_auto_add_from', value: '2026-06-01' }], error: null });
  service = new StatementReconcileService({} as any);
});

describe('StatementReconcileService.reconcile', () => {
  it('matches, adds, leaves and ignores each line, and stores every line', async () => {
    const outcome = await service.reconcile(input);

    expect(outcome).toEqual({ status: 'reconciled', lines: 6, counts: { matched: 2, added: 2, unmatched: 1, ignored: 1 } });
    const rows = repos.lines.upsertMany.mock.calls[0][0];
    expect(rows.map((r: any) => [r.line_no, r.status, r.expense_id, r.inbox_item_id])).toEqual([
      [1, 'unmatched', null, null],
      [2, 'ignored', null, null],
      [3, 'matched', 'exp-manual-500', null],
      [4, 'added', 'exp-new-1', null],
      [5, 'matched', 'exp-230', 'alert-230'],
      [6, 'added', 'exp-new-2', 'alert-145'],
    ]);
    expect(JSON.stringify(rows)).not.toContain('@YBL');
  });

  // A hand-entered expense keeps its own words; it only gains how it was paid and where.
  it("enriches matched expenses without touching a person's description", async () => {
    await service.reconcile(input);

    expect(repos.expenses.update).toHaveBeenCalledWith('exp-manual-500', { payment_method: 'Axis Bank card ••2303', merchant: 'TEST GROCER' });
    expect(repos.expenses.update).toHaveBeenCalledWith('exp-230', { merchant: 'VELMURUGAN NATARAJAN', description: 'VELMURUGAN NATARAJAN' });
    expect(repos.expenses.update).not.toHaveBeenCalledWith('exp-upi-500', expect.anything());
    expect(repos.inbox.updateItem).toHaveBeenCalledWith('alert-230', {
      title: 'VELMURUGAN NATARAJAN',
      data: expect.objectContaining({ merchant: 'VELMURUGAN NATARAJAN' }),
    });
  });

  it('adds an unmatched debit for review, taking over its alert', async () => {
    await service.reconcile(input);

    expect(repos.expenses.create).toHaveBeenCalledWith({
      date: '2026-07-14',
      amount: 156.92,
      category_id: 'cat-misc',
      description: 'APOLLO PHARMACY',
      user_id: 'u-alice',
      source: 'statement',
      inbox_item_id: 'alert-145',
      payment_method: 'Axis Bank card ••2303',
      merchant: 'APOLLO PHARMACY',
      needs_review: true,
    });
    expect(repos.inbox.updateConsumed).toHaveBeenCalledWith(
      'alert-145',
      { action: 'created', expense_id: 'exp-new-2', at: '2026-09-14T06:00:00.000Z' },
      { needs_attention: true, attention_reason: 'Expense added · review' }
    );
    expect(repos.expenses.create).toHaveBeenCalledWith(expect.objectContaining({ description: 'CC-UPI FUEL SURCHARGE RUPAY CARD', inbox_item_id: null }));
  });

  it('never adds a line again once it was matched, added or ignored', async () => {
    repos.lines.listForStatement.mockResolvedValue(
      transactions.map((_, i) => ({ line_no: i + 1, status: i === 0 ? 'unmatched' : i === 1 ? 'ignored' : 'added' }))
    );
    repos.appConfig.getKeys.mockResolvedValue({ data: [{ key: 'inbox_auto_add_from', value: '2026-09-14' }], error: null });

    const outcome = await service.reconcile(input);

    expect(repos.expenses.create).not.toHaveBeenCalled();
    expect(repos.lines.upsertMany.mock.calls[0][0].map((r: any) => r.line_no)).toEqual([1]);
    expect(outcome).toMatchObject({ counts: { added: 4, ignored: 1, unmatched: 1, matched: 0 } });
  });

  it('ignores a debit its alert already logged as a transfer', async () => {
    repos.inbox.listTransactionsBetween.mockResolvedValue([
      alert('alert-bill', '2026-07-09', 10, {}, { action: 'transfer', transfer_id: 't-1', at: '2026-09-14T00:00:00Z' }),
    ]);
    await service.reconcile({ ...input, transactions: [transactions[3]] });

    expect(repos.expenses.create).not.toHaveBeenCalled();
    expect(repos.lines.upsertMany.mock.calls[0][0][0]).toMatchObject({ status: 'ignored', inbox_item_id: 'alert-bill' });
  });

  it('ignores an EMI principal repayment — the purchase was spent earlier', async () => {
    await service.reconcile({ ...input, transactions: [{ date: '2026-07-20', description: 'OFFUS EMI,PRIN NB:04, (Ref# )', amount: 2248, direction: 'debit' }] });

    expect(repos.expenses.create).not.toHaveBeenCalled();
    expect(repos.lines.upsertMany.mock.calls[0][0][0]).toMatchObject({ status: 'ignored' });
  });

  // Seen live: HDFC UPI alerts print no last 4, so a statement line added a second ₹350 beside
  // the hand-logged "Chicken" already linked to that alert. A resend has to undo it.
  it('removes an untouched expense it added once an expense for the spend turns up', async () => {
    repos.lines.listForStatement.mockResolvedValue([{ line_no: 1, status: 'added', expense_id: 'exp-dup' }]);
    repos.lines.listExpenseIdsBetween.mockResolvedValue(new Set(['exp-dup']));
    repos.expenses.findReconcileCandidates.mockResolvedValue([
      expense({ id: 'exp-dup', date: '2026-06-20', amount: 350, description: 'CITY MUTTON STALL', source: 'statement', needs_review: true }),
      expense({ id: 'exp-manual', date: '2026-06-20', amount: 350, description: 'Chicken', inbox_item_id: 'alert-noid', payment_method: 'Axis Bank UPI' }),
    ]);
    repos.inbox.listTransactionsBetween.mockResolvedValue([alert('alert-noid', '2026-06-20', 350, { instrument: 'upi', last4: null })]);

    const outcome = await service.reconcile({
      ...input,
      transactions: [{ date: '2026-06-20', description: 'UPI/CITY MUTTON STALL/x@ybl', amount: 350, direction: 'debit' }],
    });

    expect(repos.expenses.delete).toHaveBeenCalledWith('exp-dup');
    expect(repos.lines.upsertMany.mock.calls[0][0][0]).toMatchObject({ line_no: 1, status: 'matched', expense_id: 'exp-manual' });
    expect(repos.expenses.update).toHaveBeenCalledWith('exp-manual', { merchant: 'CITY MUTTON STALL' });
    expect(outcome).toMatchObject({ counts: { matched: 1, added: 0 } });
  });

  it('keeps an added expense someone has confirmed', async () => {
    repos.lines.listForStatement.mockResolvedValue([{ line_no: 1, status: 'added', expense_id: 'exp-kept' }]);
    repos.expenses.findReconcileCandidates.mockResolvedValue([
      expense({ id: 'exp-kept', date: '2026-06-20', amount: 350, description: 'Mutton', source: 'statement', needs_review: false }),
      expense({ id: 'exp-manual', date: '2026-06-20', amount: 350, description: 'Chicken' }),
    ]);

    await service.reconcile({ ...input, transactions: [{ date: '2026-06-20', description: 'UPI/CITY MUTTON STALL/x@ybl', amount: 350, direction: 'debit' }] });

    expect(repos.expenses.delete).not.toHaveBeenCalled();
  });

  it('skips quietly before migration 032 has created its table', async () => {
    repos.lines.listForStatement.mockRejectedValue(new Error('Failed to load statement lines: relation "statement_transactions" does not exist'));
    expect(await service.reconcile(input)).toMatchObject({ status: 'skipped' });
    expect(repos.expenses.create).not.toHaveBeenCalled();
  });
});
