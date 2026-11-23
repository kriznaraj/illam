import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InboxItem, InboxTransactionData } from '@/types';
import type { PriorExpense } from '@/lib/expenses/merchantHistory';

const repos = vi.hoisted(() => ({
  inbox: {
    listUnconsumed: vi.fn(),
    markConsumed: vi.fn(),
    listTransactionsBetween: vi.fn(async () => [] as InboxItem[]),
    findByIds: vi.fn(async (): Promise<InboxItem[]> => []),
    updateItem: vi.fn(async () => undefined),
  },
  expenses: {
    findMatchCandidates: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    findByMerchant: vi.fn(async (): Promise<PriorExpense[]> => []),
    linkTags: vi.fn(async () => undefined),
  },
  tags: { findByName: vi.fn(async () => ({ id: 'tag-auto', name: 'auto' })) },
  // Implemented rather than stubbed, so vi.clearAllMocks keeps the default between tests.
  transfers: {
    create: vi.fn(),
    findByInboxItem: vi.fn(),
    listLinkedStatements: vi.fn(async () => new Map<string, string | null>()),
    list: vi.fn(async (): Promise<unknown[]> => []),
    delete: vi.fn(async () => undefined),
  },
  rules: { listNewestFirst: vi.fn() },
  statements: { listSince: vi.fn(), update: vi.fn() },
  users: { findByUsername: vi.fn() },
  categories: { findAllSorted: vi.fn() },
  appConfig: { getKeys: vi.fn() },
  transferService: { apply: vi.fn(), autoResolve: vi.fn(async (_transfer: object): Promise<unknown> => null) },
  invalidate: vi.fn(),
  commitments: { listAll: vi.fn(async (): Promise<unknown[]> => []) },
  commitmentPayments: { recordOnce: vi.fn() },
  categorizer: { suggestOne: vi.fn() },
}));

vi.mock('@/lib/repositories/InboxRepository', () => ({ InboxRepository: class { constructor() { return repos.inbox as any; } } }));
vi.mock('@/lib/repositories/ExpenseRepository', () => ({ ExpenseRepository: class { constructor() { return repos.expenses as any; } } }));
vi.mock('@/lib/repositories/TransferRepository', () => ({ TransferRepository: class { constructor() { return repos.transfers as any; } } }));
vi.mock('@/lib/repositories/TransactionRuleRepository', () => ({ TransactionRuleRepository: class { constructor() { return repos.rules as any; } } }));
vi.mock('@/lib/repositories/CreditCardStatementRepository', () => ({ CreditCardStatementRepository: class { constructor() { return repos.statements as any; } } }));
vi.mock('@/lib/repositories/UserRepository', () => ({ UserRepository: class { constructor() { return repos.users as any; } } }));
vi.mock('@/lib/repositories/CategoryRepository', () => ({ CategoryRepository: class { constructor() { return repos.categories as any; } } }));
vi.mock('@/lib/repositories/AppConfigRepository', () => ({ AppConfigRepository: class { constructor() { return repos.appConfig as any; } } }));
vi.mock('@/lib/repositories/TagRepository', () => ({ TagRepository: class { constructor() { return repos.tags as any; } } }));
vi.mock('../TransferService', () => ({ TransferService: class { constructor() { return repos.transferService as any; } } }));
vi.mock('@/lib/cache-invalidation', () => ({ invalidateInsightsCache: repos.invalidate }));
// The Claude step at the end of a run has its own tests (TransferResolverService.test.ts).
vi.mock('../TransferResolverService', () => ({
  TransferResolverService: class { run = async () => ({ classified: 0, suggested: 0, categorised: 0 }); },
}));
vi.mock('../ExpenseCategorizationService', () => ({
  ExpenseCategorizationService: class { constructor() { return repos.categorizer as any; } },
}));
vi.mock('@/lib/repositories/CommitmentRepository', () => ({
  CommitmentRepository: class { constructor() { return repos.commitments as any; } },
  CommitmentPaymentRepository: class { constructor() { return repos.commitmentPayments as any; } },
}));

import { InboxAutomationService } from '../InboxAutomationService';

const NOW = new Date('2026-09-20T12:00:00Z');
const ALICE = 'user-alice';

let seq = 0;
const alert = (data: Partial<InboxTransactionData> = {}, over: Partial<InboxItem> = {}): InboxItem =>
  ({
    id: `item-${++seq}`,
    owner: 'alice',
    kind: 'transaction',
    title: data.merchant ?? 'Payment',
    received_at: '2026-09-18T06:00:00Z',
    consumed: null,
    data: {
      kind: 'transaction',
      bank: 'HDFC Bank',
      amount: 225,
      currency: 'INR',
      direction: 'debit',
      instrument: 'upi',
      last4: '2101',
      merchant: null,
      txnDate: '2026-09-18',
      available: null,
      outcome: 'success',
      international: false,
      ...data,
    },
    ...over,
  }) as InboxItem;

let service: InboxAutomationService;

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  repos.rules.listNewestFirst.mockResolvedValue([]);
  repos.statements.listSince.mockResolvedValue({ data: [], error: null });
  repos.statements.update.mockResolvedValue({ data: {}, error: null });
  repos.expenses.findMatchCandidates.mockResolvedValue([]);
  repos.expenses.update.mockResolvedValue({});
  repos.expenses.findByMerchant.mockResolvedValue([]);
  repos.expenses.create.mockImplementation(async (row: object) => ({ id: 'expense-new', ...row }));
  repos.commitments.listAll.mockResolvedValue([]);
  // No AI unless a test says so: the keyword matcher and Miscellaneous decide as before.
  repos.categorizer.suggestOne.mockResolvedValue({ categoryId: null, categoryName: null, confidence: 'low', source: 'none' });
  repos.transfers.create.mockImplementation(async (row: object) => ({ id: 'transfer-new', ...row }));
  repos.categories.findAllSorted.mockResolvedValue([
    { id: 'cat-misc', name: 'Miscellaneous' },
    { id: 'cat-dining', name: 'Dining Out' },
  ]);
  repos.appConfig.getKeys.mockResolvedValue({ data: [{ key: 'inbox_auto_add_from', value: '2026-09-15' }], error: null });
  repos.users.findByUsername.mockImplementation(async (username: string) =>
    username === 'alice' ? { id: ALICE } : { id: 'user-bob' }
  );
  repos.inbox.markConsumed.mockResolvedValue(true);
  service = new InboxAutomationService({} as any);
});

describe('InboxAutomationService.process', () => {
  it('links a matching hand-entered expense and only adds how it was paid', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'ACME ASSOCIATES' })]);
    repos.expenses.findMatchCandidates.mockResolvedValue([
      { id: 'exp-salon', date: '2026-09-17', amount: 225, user_id: ALICE, created_at: '2026-09-17T10:00:00Z', inbox_item_id: null },
    ]);

    const result = await service.process({ now: NOW });

    expect(result.counts.linked).toBe(1);
    expect(repos.expenses.update).toHaveBeenCalledWith('exp-salon', {
      inbox_item_id: 'item-1',
      payment_method: 'HDFC Bank UPI ••2101',
      merchant: 'ACME ASSOCIATES',
      // The alert printed no time; it arrived at 06:00Z = 11:30 IST on the spend's own day.
      spent_time: '11:30:00',
      spent_time_approx: true,
    });
    expect(repos.expenses.create).not.toHaveBeenCalled();
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith('item-1', expect.objectContaining({ action: 'linked', expense_id: 'exp-salon' }), undefined);
  });

  it('records a premium against its commitment and makes nothing else of it', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'TATA AIA LIFE INSURANCE', amount: 10470, txnDate: '2026-09-08' })]);
    // Read twice per run: by the sweep of recorded expenses, then by the alert's own check.
    repos.commitments.listAll.mockResolvedValue([
      { id: 'c-term', name: 'Tata AIA term', kind: 'insurance', amount: 10470, frequency: 'monthly', start_month: '2026-01', due_day: 8, end_month: null, match_text: 'TATA AIA', active: true },
    ]);
    repos.commitmentPayments.recordOnce.mockImplementation(async (p: object) => ({ payment: { id: 'p-1', ...p }, created: true }));

    const result = await service.process({ now: NOW });

    expect(repos.commitmentPayments.recordOnce).toHaveBeenCalledWith(
      expect.objectContaining({ commitment_id: 'c-term', due_month: '2026-09', source: 'alert', inbox_item_id: 'item-1' })
    );
    expect(repos.expenses.create).not.toHaveBeenCalled();
    expect(repos.transfers.create).not.toHaveBeenCalled();
    expect(result.counts.ignored).toBe(1);
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ action: 'ignored', reason: 'commitment: Tata AIA term' }),
      { needs_attention: false, attention_reason: null }
    );
  });

  /*
   * 23 of the 86 review expenses carrying a payee on 2026-09-20 had an earlier confirmed
   * expense from that same payee, and every one had still been filed under Miscellaneous.
   */
  it('files a new spend where this payee was confirmed before', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'KERALA SNACK STORE' })]);
    repos.expenses.findByMerchant.mockResolvedValue([
      { date: '2026-08-02', merchant: 'KERALA SNACK STORE', description: 'KERALA SNACK STORE', category_id: 'cat-quick', category_name: 'Quick bites', needs_review: false },
    ]);

    await service.process({ now: NOW });

    expect(repos.expenses.create).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'cat-quick', merchant: 'KERALA SNACK STORE' }));
  });

  it('ignores an unconfirmed precedent, so Miscellaneous cannot teach itself', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'SRI SWEETS' })]);
    repos.expenses.findByMerchant.mockResolvedValue([
      { date: '2026-08-02', merchant: 'SRI SWEETS', description: 'SRI SWEETS', category_id: 'cat-misc', category_name: 'Miscellaneous', needs_review: true },
    ]);

    await service.process({ now: NOW });

    expect(repos.expenses.create).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'cat-misc' }));
  });

  it('records the spend anyway when the history lookup fails', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'PIZZA PLACE' })]);
    repos.expenses.findByMerchant.mockRejectedValue(new Error('Gateway Timeout'));

    const result = await service.process({ now: NOW });

    expect(result.counts.created).toBe(1);
    expect(repos.expenses.create).toHaveBeenCalled();
  });

  /*
   * The grace period was 24 hours until 2026-09-26, so that a spend logged by hand later in
   * the day would not collide with an auto-added row. It bought nothing the merge paths do
   * not already cover (ExpenseService.createExpense merges a hand entry into the row it
   * repeats) and cost a day of the list being wrong, so the user set it to zero.
   */
  it('adds a spend that arrived minutes ago, without waiting out a grace period', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({}, { received_at: '2026-09-20T11:45:00Z' })]);

    const result = await service.process({ now: NOW });

    expect(result.counts.waiting).toBe(0);
    expect(result.counts.created).toBe(1);
    expect(repos.expenses.create).toHaveBeenCalled();
  });

  it('labels what it created "auto", so the list can say the row was not typed', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert()]);
    repos.expenses.create.mockResolvedValue({ id: 'exp-new' });

    await service.process({ now: NOW });

    expect(repos.expenses.linkTags).toHaveBeenCalledWith('exp-new', ['tag-auto']);
  });

  /*
   * The label is provenance, not money. The expense row is already written by the time it is
   * applied, so a failure here must not throw: that would leave the alert unconsumed and the
   * spend re-decided on the next pass, losing a real record over a cosmetic miss.
   */
  it('still records the spend when the label cannot be applied', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert()]);
    repos.expenses.create.mockResolvedValue({ id: 'exp-new' });
    repos.expenses.linkTags.mockRejectedValueOnce(new Error('Gateway Timeout'));

    const result = await service.process({ now: NOW });

    expect(result.counts.created).toBe(1);
    expect(repos.inbox.markConsumed).toHaveBeenCalled();
  });

  it('applies no label before migration 036 has created the tag', async () => {
    repos.tags.findByName.mockResolvedValueOnce(null as any);
    repos.inbox.listUnconsumed.mockResolvedValue([alert()]);
    repos.expenses.create.mockResolvedValue({ id: 'exp-new' });

    const result = await service.process({ now: NOW });

    expect(result.counts.created).toBe(1);
    expect(repos.expenses.linkTags).not.toHaveBeenCalled();
  });

  it('adds an unlogged spend it cannot place, and asks for a category', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert()]);

    const result = await service.process({ now: NOW });

    expect(result.counts.created).toBe(1);
    expect(repos.expenses.create).toHaveBeenCalledWith({
      date: '2026-09-18',
      amount: 225,
      category_id: 'cat-misc',
      // Never the payment method: that told the user nothing about what was bought.
      description: 'Unknown payee',
      user_id: ALICE,
      source: 'inbox',
      inbox_item_id: 'item-1',
      payment_method: 'HDFC Bank UPI ••2101',
      merchant: null,
      needs_review: true,
      spent_time: '11:30:00',
      spent_time_approx: true,
    });
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ action: 'created', expense_id: 'expense-new' }),
      { needs_attention: true, attention_reason: 'Expense added · pick a category' }
    );
    // An auto-added row counts from the moment it exists (migration 036), so the cached
    // insights for its month are stale even though nobody has reviewed it yet. Before 036
    // this asserted the opposite, because the row was in no total until Confirm.
    expect(repos.invalidate).toHaveBeenCalledWith(expect.anything(), '2026-09-18');
  });

  it('writes the time the bank printed, not the arrival time', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'BHARTI AIRTEL LIMI', txnTime: '16:50:04' })]);

    await service.process({ now: NOW });

    expect(repos.expenses.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'BHARTI AIRTEL LIMI', spent_time: '16:50:04', spent_time_approx: false })
    );
  });

  it('asks Haiku only when history and keywords cannot place the payee', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'KAVERI NILAYAM' })]);
    repos.categorizer.suggestOne.mockResolvedValue({ categoryId: 'cat-dining', categoryName: 'Dining Out', confidence: 'high', source: 'ai' });

    await service.process({ now: NOW });

    expect(repos.categorizer.suggestOne).toHaveBeenCalledWith('KAVERI NILAYAM', expect.any(Array));
    expect(repos.expenses.create).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'cat-dining', needs_review: true }));
    // Placed, so no To-do — but the provenance is kept for auditing the AI step.
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ action: 'created', category_source: 'ai' }),
      { needs_attention: false, attention_reason: null }
    );
  });

  it('ignores a low-confidence AI answer and files Miscellaneous', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'KAVERI NILAYAM' })]);
    repos.categorizer.suggestOne.mockResolvedValue({ categoryId: 'cat-dining', categoryName: 'Dining Out', confidence: 'low', source: 'ai' });

    await service.process({ now: NOW });

    expect(repos.expenses.create).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'cat-misc' }));
  });

  it('never asks Haiku when the household already answered for that payee', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'SWIGGY RESTAURANT' })]);
    repos.expenses.findByMerchant.mockResolvedValue([
      { date: '2026-09-01', merchant: 'SWIGGY RESTAURANT', description: null, category_id: 'cat-dining', category_name: 'Dining Out', needs_review: false },
    ]);

    await service.process({ now: NOW });

    expect(repos.categorizer.suggestOne).not.toHaveBeenCalled();
  });

  it('files an AI failure under Miscellaneous instead of failing the expense', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'KAVERI NILAYAM' })]);
    repos.categorizer.suggestOne.mockRejectedValue(new Error('network down'));

    const result = await service.process({ now: NOW });

    expect(result.counts.created).toBe(1);
    expect(repos.expenses.create).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'cat-misc' }));
  });

  // The user, 2026-10-03: "I cannot confirm every email — only conflicts need review".
  it('adds a spend it could place without raising a To-do, though it stays unconfirmed', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'SWIGGY RESTAURANT' })]);
    repos.expenses.findByMerchant.mockResolvedValue([
      { date: '2026-09-01', merchant: 'SWIGGY RESTAURANT', description: null, category_id: 'cat-dining', category_name: 'Dining Out', needs_review: false },
    ]);

    await service.process({ now: NOW });

    expect(repos.expenses.create).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'cat-dining', needs_review: true }));
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith('item-1', expect.objectContaining({ action: 'created' }), {
      needs_attention: false,
      attention_reason: null,
    });
  });

  it('lets a transfer the evidence settles skip the review queue', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'CBDT TIN 2 0', amount: 100898 })]);
    repos.transferService.autoResolve.mockImplementationOnce(async (t: object) => ({ ...t, status: 'confirmed' }));

    const result = await service.process({ now: NOW });

    expect(result.counts.transfer).toBe(1);
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith('item-1', expect.objectContaining({ action: 'transfer' }), {
      needs_attention: false,
      attention_reason: null,
    });
  });

  it('gives transfers already waiting another chance to settle on every run', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([]);
    const waiting = [{ id: 't-1', status: 'needs_review' }, { id: 't-2', status: 'needs_review' }];
    repos.transfers.list.mockResolvedValueOnce(waiting);
    repos.transferService.autoResolve.mockImplementationOnce(async (t: object) => ({ ...t, status: 'confirmed' }));

    const result = await service.process({ now: NOW });

    expect(repos.transfers.list).toHaveBeenCalledWith({ status: 'needs_review', limit: 200 });
    expect(repos.transferService.autoResolve).toHaveBeenCalledTimes(2);
    expect(result.resolved).toBe(1);
  });

  // The classifier improves; the transfers it queued under older rules should not wait forever.
  it('releases a waiting transfer whose alert is no longer a transfer, and decides it in the same run', async () => {
    const card = alert({ merchant: 'AMAZON PAY ECOM', amount: 30737, instrument: 'card', last4: '4123', bank: 'ICICI Bank' });
    const neft = alert({ amount: 40000, instrument: 'account', last4: '3101' });
    repos.transfers.list.mockResolvedValueOnce([
      { id: 't-card', status: 'needs_review', direction: 'debit', kind: 'other', inbox_item_id: card.id },
      { id: 't-neft', status: 'needs_review', direction: 'debit', kind: 'other', inbox_item_id: neft.id },
    ]);
    repos.inbox.findByIds.mockResolvedValueOnce([card, neft]);
    repos.inbox.listUnconsumed.mockResolvedValue([{ ...card, consumed: null }]);

    const result = await service.process({ now: NOW });

    expect(repos.transfers.delete).toHaveBeenCalledTimes(1);
    expect(repos.transfers.delete).toHaveBeenCalledWith('t-card');
    expect(repos.inbox.updateItem).toHaveBeenCalledWith(card.id, { consumed: null });
    // A card purchase: decided as an expense by the ordinary path.
    expect(result.counts.created).toBe(1);
  });

  it('settles both halves of money moved between the two of them', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([]);
    const debit = { id: 't-out', owner: 'alice', date: '2026-10-07', amount: 40000, direction: 'debit', kind: 'other', status: 'needs_review', created_at: '2026-10-06T18:43:00Z' };
    const credit = { id: 't-in', owner: 'bob', date: '2026-10-07', amount: 40000, direction: 'credit', kind: 'other', status: 'needs_review', created_at: '2026-10-06T19:21:00Z' };
    // Read once to re-decide and resolve, and again to pair.
    repos.transfers.list.mockResolvedValueOnce([debit, credit]).mockResolvedValueOnce([debit, credit]);
    repos.transferService.apply
      .mockResolvedValueOnce({ transfer: null, expenseId: null })
      .mockResolvedValueOnce({ transfer: null, expenseId: null });

    const result = await service.process({ now: NOW });

    expect(repos.transferService.apply).toHaveBeenCalledWith(debit, { kind: 'family', note: 'Household transfer · to Bob' });
    expect(repos.transferService.apply).toHaveBeenCalledWith(credit, { kind: 'family', note: 'Household transfer · from Alice' });
    expect(result.resolved).toBe(2);
  });

  it('never settles anything on a dry run', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([]);
    repos.transfers.list.mockResolvedValueOnce([{ id: 't-1', status: 'needs_review' }]);

    await service.process({ now: NOW, dryRun: true });

    expect(repos.transferService.autoResolve).not.toHaveBeenCalled();
  });

  it('never creates expenses for alerts dated before go-live', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ txnDate: '2026-07-05' }, { received_at: '2026-07-05T06:00:00Z' })]);

    const result = await service.process({ now: NOW });

    expect(result.counts.history_unmatched).toBe(1);
    expect(repos.expenses.create).not.toHaveBeenCalled();
  });

  it('never creates expenses when no go-live date is configured', async () => {
    repos.appConfig.getKeys.mockResolvedValue({ data: [], error: null });
    repos.inbox.listUnconsumed.mockResolvedValue([alert()]);

    const result = await service.process({ now: NOW });

    expect(result.counts.history_unmatched).toBe(1);
    expect(repos.expenses.create).not.toHaveBeenCalled();
  });

  it('links a bill payment to a statement already marked paid by hand, leaving its figures alone', async () => {
    repos.statements.listSince.mockResolvedValue({
      data: [{ id: 'st-aug', account_id: 'acc-1909', statement_date: '2026-09-08', statement_amount: 6968, amount_paid: 6968, payment_date: '2026-09-18' }],
      error: null,
    });
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'Indmoney1', amount: 6968 })]);

    const result = await service.process({ now: NOW });

    expect(result.counts.card_bill).toBe(1);
    expect(repos.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'card_bill', status: 'confirmed', credit_card_statement_id: 'st-aug' })
    );
    expect(repos.statements.update).not.toHaveBeenCalled();
  });

  // Statement claims used to last one run. With a bulk paid-on date accepted, a later
  // payment of the same amount would otherwise settle an already-settled statement again.
  it('never re-links a statement that a different alert settled in an earlier run', async () => {
    repos.statements.listSince.mockResolvedValue({
      data: [{ id: 'st-aug', account_id: 'acc-1909', statement_date: '2026-09-08', statement_amount: 6968, amount_paid: 6968, payment_date: '2026-09-18' }],
      error: null,
    });
    repos.transfers.listLinkedStatements.mockResolvedValueOnce(new Map([['st-aug', 'item-earlier']]));
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'Indmoney1', amount: 6968 })]);

    const result = await service.process({ now: NOW });

    expect(result.counts.card_bill).toBe(0);
    expect(repos.transfers.create).not.toHaveBeenCalledWith(expect.objectContaining({ credit_card_statement_id: 'st-aug' }));
  });

  it('still links the alert that settled a statement when that alert is decided again', async () => {
    repos.statements.listSince.mockResolvedValue({
      data: [{ id: 'st-aug', account_id: 'acc-1909', statement_date: '2026-09-08', statement_amount: 6968, amount_paid: 6968, payment_date: '2026-09-18' }],
      error: null,
    });
    repos.transfers.listLinkedStatements.mockResolvedValueOnce(new Map([['st-aug', 'item-1']]));
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'Indmoney1', amount: 6968 })]);

    const result = await service.process({ now: NOW });

    expect(result.counts.card_bill).toBe(1);
  });

  it('marks a card bill paid and logs it as a confirmed transfer', async () => {
    repos.statements.listSince.mockResolvedValue({
      data: [{ id: 'st-aug', account_id: 'acc-1909', statement_date: '2026-09-08', statement_amount: 6968, amount_paid: 0, payment_date: null }],
      error: null,
    });
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'Indmoney1', amount: 6968 })]);

    const result = await service.process({ now: NOW });

    expect(result.counts.card_bill).toBe(1);
    expect(repos.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'card_bill', status: 'confirmed', credit_card_statement_id: 'st-aug', account_id: 'acc-1909' })
    );
    expect(repos.statements.update).toHaveBeenCalledWith('st-aug', { amount_paid: 6968, payment_date: '2026-09-18' });
  });

  it('logs an ad-hoc transfer for review and flags it in Madal', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'ALICE', amount: 47500, last4: '3101' })]);

    const result = await service.process({ now: NOW });

    expect(result.counts.transfer).toBe(1);
    expect(repos.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'own_account', status: 'needs_review', amount: 47500, counterparty: 'ALICE' })
    );
    expect(repos.transferService.apply).not.toHaveBeenCalled();
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ action: 'transfer', transfer_id: 'transfer-new' }),
      { needs_attention: true, attention_reason: 'Transfer to classify' }
    );
  });

  const rule = (over: Record<string, unknown>) => ({
    id: 'rule-1',
    owner: 'alice',
    match_counterparty: 'alice',
    match_payment_method: null,
    action: 'transfer',
    category_id: null,
    transfer_kind: 'investment',
    account_id: 'acc-us',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  });

  // A debit may already be on record as a hand entry, an auto-monthly row or a SIP instalment,
  // so an investment rule never writes on its own: it prefills the account and waits.
  it('lets a saved investment rule prefill the account but leaves the transfer for review', async () => {
    repos.rules.listNewestFirst.mockResolvedValue([rule({})]);
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'ALICE', amount: 47500 })]);

    await service.process({ now: NOW });

    expect(repos.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'investment', status: 'needs_review', account_id: 'acc-us' })
    );
    expect(repos.transferService.apply).not.toHaveBeenCalled();
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith('item-1', expect.anything(), {
      needs_attention: true,
      attention_reason: 'Transfer to classify',
    });
  });

  it('applies a saved rule that writes no money, instead of asking again', async () => {
    repos.rules.listNewestFirst.mockResolvedValue([rule({ match_counterparty: 'hdfc atm', transfer_kind: 'cash', account_id: null })]);
    repos.transferService.apply.mockResolvedValue({ transfer: { id: 'transfer-new', kind: 'cash', status: 'confirmed' }, expenseId: null });
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'HDFC ATM', amount: 3000 })]);

    await service.process({ now: NOW });

    expect(repos.transferService.apply).toHaveBeenCalledWith(expect.objectContaining({ id: 'transfer-new' }), {
      kind: 'cash',
      account_id: null,
    });
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith('item-1', expect.anything(), {
      needs_attention: false,
      attention_reason: null,
    });
  });

  it('writes nothing on a dry run', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([
      alert({ merchant: 'ALICE', amount: 47500 }),
      alert(),
      alert({ outcome: 'declined' }),
    ]);

    const result = await service.process({ now: NOW, dryRun: true });

    expect(result.counts).toMatchObject({ transfer: 1, created: 1, ignored: 1 });
    expect(repos.transfers.create).not.toHaveBeenCalled();
    expect(repos.expenses.create).not.toHaveBeenCalled();
    expect(repos.expenses.update).not.toHaveBeenCalled();
    expect(repos.statements.update).not.toHaveBeenCalled();
    expect(repos.inbox.markConsumed).not.toHaveBeenCalled();
  });

  // The first live run was killed by the 60 s limit; anything half-done must be finished, not redone.
  it('records a transfer an earlier, interrupted run already logged, instead of retrying forever', async () => {
    repos.transfers.create.mockRejectedValue(new Error('Failed to create transfers: duplicate key value violates unique constraint'));
    repos.transfers.findByInboxItem.mockResolvedValue({ id: 'transfer-old', kind: 'cash', status: 'needs_review' });
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'HDFC ATM', amount: 3000 })]);

    const result = await service.process({ now: NOW });

    expect(result.counts.transfer).toBe(1);
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ action: 'transfer', transfer_id: 'transfer-old' }),
      { needs_attention: true, attention_reason: 'Transfer to classify' }
    );
  });

  it('records a link an interrupted run already made, without linking again', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert()]);
    repos.expenses.findMatchCandidates.mockResolvedValue([
      { id: 'exp-linked', date: '2026-09-18', amount: 225, user_id: ALICE, created_at: '2026-09-18T10:00:00Z', inbox_item_id: 'item-1' },
    ]);

    const result = await service.process({ now: NOW });

    expect(result.counts.linked).toBe(1);
    expect(repos.expenses.update).not.toHaveBeenCalled();
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith('item-1', expect.objectContaining({ action: 'linked', expense_id: 'exp-linked' }), undefined);
  });

  it('stops starting new items once the time budget is spent, and reports what is left', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert(), alert(), alert()]);

    const result = await service.process({ now: NOW, timeBudgetMs: 0 });

    expect(result.remaining).toBe(3);
    expect(result.actions).toEqual([]);
    expect(repos.expenses.create).not.toHaveBeenCalled();
  });

  it('keeps each alert to its own expense when several run at once', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ amount: 70 }), alert({ amount: 70 })]);
    repos.expenses.findMatchCandidates.mockResolvedValue([
      { id: 'exp-a', date: '2026-09-18', amount: 70, user_id: ALICE, created_at: '2026-09-18T08:00:00Z', inbox_item_id: null },
      { id: 'exp-b', date: '2026-09-18', amount: 70, user_id: ALICE, created_at: '2026-09-18T09:00:00Z', inbox_item_id: null },
    ]);

    const result = await service.process({ now: NOW, concurrency: 2 });

    expect(result.counts.linked).toBe(2);
    const linkedIds = repos.expenses.update.mock.calls.map((call) => call[0]).sort();
    expect(linkedIds).toEqual(['exp-a', 'exp-b']);
  });

  it('keeps going when one item fails, and leaves that item for the next run', async () => {
    repos.inbox.listUnconsumed.mockResolvedValue([alert({ merchant: 'HDFC ATM', amount: 3000 }), alert({ merchant: 'CBDT TIN 2 0', amount: 100898 })]);
    repos.transfers.create
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockImplementation(async (row: object) => ({ id: 'transfer-2', ...row }));

    const result = await service.process({ now: NOW });

    expect(result.counts).toMatchObject({ error: 1, transfer: 1 });
    expect(repos.inbox.markConsumed).toHaveBeenCalledTimes(1);
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith('item-2', expect.anything(), expect.anything());
  });
});

describe('InboxAutomationService duplicate alerts', () => {
  // The real pair of 2026-08-23: ICICI sent one ₹5,699.95 alert as two Gmail messages.
  it('acts on the first copy of a double-sent alert and ignores the second', async () => {
    const data = { bank: 'ICICI Bank', amount: 5699.95, instrument: 'card' as const, last4: '4123', merchant: 'AMAZON PAY IN E COMMERCE' };
    const first = alert(data, { source: 'icici_card_statement', gmail_message_id: '1a02fd83127dc3bb', received_at: '2026-09-18T06:00:00Z' });
    const second = alert(data, { source: 'icici_card_statement', gmail_message_id: '1a02fd84d905ab9b', received_at: '2026-09-18T06:00:00Z' });
    repos.inbox.listUnconsumed.mockResolvedValue([first, second]);
    repos.inbox.listTransactionsBetween.mockResolvedValue([first, second]);
    repos.inbox.markConsumed.mockResolvedValue(true);

    const result = await service.process({ now: NOW });

    expect(result.actions.find((a) => a.itemId === second.id)).toMatchObject({ outcome: 'ignored', detail: `duplicate of ${first.id}` });
    expect(result.actions.find((a) => a.itemId === first.id)?.outcome).not.toBe('ignored');
    expect(repos.inbox.markConsumed).toHaveBeenCalledWith(second.id, expect.objectContaining({ action: 'ignored', reason: 'duplicate alert' }), undefined);
  });
});
