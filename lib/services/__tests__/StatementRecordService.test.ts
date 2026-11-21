import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedCardStatement } from '@/lib/statements/cardStatements';

const repos = vi.hoisted(() => ({
  accounts: { listActiveCreditCardAccounts: vi.fn() },
  statements: { listForAccount: vi.fn(), insert: vi.fn(), update: vi.fn() },
  inbox: { updateItem: vi.fn() },
}));

vi.mock('@/lib/repositories/CreditCardOverviewRepository', () => ({
  CreditCardOverviewRepository: class {
    constructor() {
      return repos.accounts as any;
    }
  },
}));
vi.mock('@/lib/repositories/CreditCardStatementRepository', () => ({
  CreditCardStatementRepository: class {
    constructor() {
      return repos.statements as any;
    }
  },
}));
const reconciler = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock('../StatementReconcileService', () => ({
  StatementReconcileService: class {
    constructor() {
      return reconciler as any;
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

import { StatementRecordService, matchCard } from '../StatementRecordService';

const parsed = (over: Partial<ParsedCardStatement> = {}): ParsedCardStatement => ({
  bank: 'HDFC Bank',
  last4: '2101',
  statementDate: '2026-07-08',
  periodStart: '2026-06-09',
  periodEnd: '2026-07-08',
  dueDate: '2026-07-28',
  totalDue: 30350,
  minDue: 1600,
  transactions: [],
  ...over,
});

const ITEM = { id: 'item-1', receivedDate: '2026-07-09' };

const cards = [
  { id: 'acc-2101', name: 'HDFC UPI Rupay CC – 2101', details: { last4: '2101' }, is_active: true },
  { id: 'acc-5179', name: 'Rewards card - 5179', details: { bank: 'HDFC Millennia' }, is_active: true },
];

let service: StatementRecordService;

beforeEach(() => {
  vi.clearAllMocks();
  repos.accounts.listActiveCreditCardAccounts.mockResolvedValue({ data: cards, error: null });
  repos.statements.listForAccount.mockResolvedValue({ data: [], error: null });
  repos.statements.insert.mockResolvedValue({ data: { id: 'st-new' }, error: null });
  repos.statements.update.mockResolvedValue({ data: {}, error: null });
  repos.inbox.updateItem.mockResolvedValue({});
  service = new StatementRecordService({} as any);
});

describe('StatementRecordService.recordCardStatement', () => {
  it('creates the statement for a card and month that has none, and gives the Madal item its dues', async () => {
    const outcome = await service.recordCardStatement(parsed(), ITEM);

    expect(outcome).toEqual({ status: 'created', statementId: 'st-new', accountId: 'acc-2101' });
    expect(repos.statements.listForAccount).toHaveBeenCalledWith('acc-2101', { month: '2026-07' });
    expect(repos.statements.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-2101',
        statement_date: '2026-07-08',
        due_date: '2026-07-28',
        period_start: '2026-06-09',
        period_end: '2026-07-08',
        statement_amount: 30350,
        amount_paid: 0,
      })
    );
    expect(repos.inbox.updateItem).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({
        summary: 'Due 28 Jul 2026 · ••2101',
        data: expect.objectContaining({ totalDue: 30350, dueDate: '2026-07-28', last4: '2101' }),
        consumed: expect.objectContaining({ action: 'statement_recorded', statement_id: 'st-new' }),
      })
    );
  });

  // Every existing statement row was entered by hand; the email must not overwrite it.
  it('leaves a matching hand-entered statement alone and clears attention once it is paid', async () => {
    repos.statements.listForAccount.mockResolvedValue({
      data: [{ id: 'st-manual', statement_amount: 30350, amount_paid: 30350 }],
      error: null,
    });

    const outcome = await service.recordCardStatement(parsed(), ITEM);

    expect(outcome).toEqual({ status: 'unchanged', statementId: 'st-manual', accountId: 'acc-2101' });
    expect(repos.statements.insert).not.toHaveBeenCalled();
    expect(repos.statements.update).not.toHaveBeenCalled();
    expect(repos.inbox.updateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({ needs_attention: false }));
  });

  it('flags, rather than overwrites, a hand-entered amount that disagrees', async () => {
    repos.statements.listForAccount.mockResolvedValue({
      data: [{ id: 'st-manual', statement_amount: 30000, amount_paid: 0 }],
      error: null,
    });

    const outcome = await service.recordCardStatement(parsed(), ITEM);

    expect(outcome).toMatchObject({ status: 'amount_mismatch', recorded: 30000, parsed: 30350 });
    expect(repos.statements.update).not.toHaveBeenCalled();
    expect(repos.inbox.updateItem).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ needs_attention: true, attention_reason: expect.stringMatching(/^Statement .*30,350.* vs entered .*30,000/) })
    );
  });

  it('fills an existing statement that has no amount', async () => {
    repos.statements.listForAccount.mockResolvedValue({ data: [{ id: 'st-empty', statement_amount: 0, amount_paid: 0 }], error: null });

    expect(await service.recordCardStatement(parsed(), ITEM)).toMatchObject({ status: 'filled' });
    expect(repos.statements.update).toHaveBeenCalledWith('st-empty', { statement_amount: 30350 });
  });

  it('flags a card that is not in Selvam', async () => {
    const outcome = await service.recordCardStatement(parsed({ last4: '0000' }), ITEM);

    expect(outcome).toEqual({ status: 'unknown_card', last4: '0000' });
    expect(repos.statements.insert).not.toHaveBeenCalled();
    expect(repos.inbox.updateItem).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ needs_attention: true, attention_reason: 'Card ••0000 is not in Selvam' })
    );
  });

  it('records nothing when the statement could not be read fully', async () => {
    expect(await service.recordCardStatement(parsed({ totalDue: null, dueDate: null }), ITEM)).toEqual({
      status: 'incomplete',
      missing: ['dueDate', 'totalDue'],
    });
    expect(repos.accounts.listActiveCreditCardAccounts).not.toHaveBeenCalled();
    expect(repos.inbox.updateItem).not.toHaveBeenCalled();
  });
});

describe('StatementRecordService reconciliation', () => {
  it("reconciles the statement's lines for its owner and says so on the item", async () => {
    reconciler.reconcile.mockResolvedValue({ status: 'reconciled', lines: 3, counts: { matched: 2, added: 1, unmatched: 0, ignored: 0 } });
    const transactions = [{ date: '2026-07-05', description: 'RAZ*SwiggyBangalore', amount: 456, direction: 'debit' as const }];

    const outcome = await service.recordCardStatement(parsed({ transactions }), { ...ITEM, owner: 'alice' });

    expect(reconciler.reconcile).toHaveBeenCalledWith({
      statementId: 'st-new',
      accountId: 'acc-2101',
      owner: 'alice',
      bank: 'HDFC Bank',
      last4: '2101',
      transactions,
    });
    expect(outcome).toMatchObject({ status: 'created', reconcile: { status: 'reconciled' } });
    expect(repos.inbox.updateItem).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ summary: 'Due 28 Jul 2026 · ••2101 · 2 matched, 1 added for review' })
    );
  });

  it('still records the statement when reconciliation fails', async () => {
    reconciler.reconcile.mockRejectedValue(new Error('Failed to save statement lines: timeout'));
    const outcome = await service.recordCardStatement(parsed(), { ...ITEM, owner: 'alice' });
    expect(outcome).toMatchObject({ status: 'created', reconcile: { status: 'skipped', reason: 'Failed to save statement lines: timeout' } });
  });
});

describe('matchCard', () => {
  it('matches on details.last4 first, then digits in the account name', () => {
    expect(matchCard(cards as any, '2101')?.id).toBe('acc-2101');
    expect(matchCard(cards as any, '5179')?.id).toBe('acc-5179');
    expect(matchCard(cards as any, '9999')).toBeNull();
    expect(matchCard(cards as any, null)).toBeNull();
  });
});
