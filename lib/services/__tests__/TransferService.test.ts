import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transfer } from '@/types';

const mocks = vi.hoisted(() => ({
  transfers: {
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    listInvestmentTransfers: vi.fn(),
    listLinkedInvestmentIds: vi.fn(),
    listSipClaims: vi.fn(),
    listSipClaimsEverywhere: vi.fn(),
  },
  investments: {
    create: vi.fn(),
    findByTransfer: vi.fn(),
    linkToTransfer: vi.fn(),
    listForMatching: vi.fn(),
    sipFunds: vi.fn(),
    sipSchedules: vi.fn(),
  },
  rules: { create: vi.fn() },
  inbox: { clearAttention: vi.fn(), updateConsumed: vi.fn() },
  users: { findByUsername: vi.fn() },
  income: { create: vi.fn() },
}));

vi.mock('@/lib/repositories/TransferRepository', () => ({ TransferRepository: class { constructor() { return mocks.transfers as any; } } }));
vi.mock('@/lib/repositories/TransactionRuleRepository', () => ({ TransactionRuleRepository: class { constructor() { return mocks.rules as any; } } }));
vi.mock('@/lib/repositories/InboxRepository', () => ({ InboxRepository: class { constructor() { return mocks.inbox as any; } } }));
vi.mock('@/lib/repositories/UserRepository', () => ({ UserRepository: class { constructor() { return mocks.users as any; } } }));
vi.mock('../PortfolioInvestmentService', () => ({ PortfolioInvestmentService: class { constructor() { return mocks.investments as any; } } }));
vi.mock('../ExpenseService', () => ({ ExpenseService: class {} }));
vi.mock('../IncomeService', () => ({ IncomeService: class { constructor() { return mocks.income as any; } } }));
vi.mock('@/lib/cache-invalidation', () => ({ invalidateInsightsCache: vi.fn() }));

import { TransferService } from '../TransferService';

const TRANSFER_ID = '5f0c6a8e-1d2b-4c3a-9e7f-2a1b3c4d5e6f';
const ACCOUNT_US = 'e451f10d-5beb-4089-82a1-8bed74a5d457';

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: TRANSFER_ID,
  inbox_item_id: 'item-1',
  owner: 'alice',
  date: '2026-07-08',
  amount: 47500,
  direction: 'debit',
  counterparty: 'ALICE',
  payment_method: 'HDFC Bank UPI ••3101',
  kind: 'own_account',
  account_id: null,
  portfolio_investment_id: null,
  credit_card_statement_id: null,
  expense_id: null,
  note: 'Paid to yourself',
  status: 'needs_review',
  created_at: '2026-07-08T10:00:00Z',
  updated_at: '2026-07-08T10:00:00Z',
  ...over,
});

let service: TransferService;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transfers.findById.mockResolvedValue(transfer());
  mocks.transfers.update.mockImplementation(async (_id: string, patch: Partial<Transfer>) => ({ ...transfer(), ...patch }));
  mocks.transfers.listInvestmentTransfers.mockResolvedValue([]);
  mocks.transfers.listLinkedInvestmentIds.mockResolvedValue(new Set());
  mocks.transfers.listSipClaims.mockResolvedValue(new Set());
  mocks.investments.listForMatching.mockResolvedValue([]);
  mocks.investments.sipFunds.mockResolvedValue([]);
  mocks.investments.sipSchedules.mockResolvedValue([]);
  mocks.transfers.listSipClaimsEverywhere.mockResolvedValue(new Set());
  mocks.investments.findByTransfer.mockResolvedValue(null);
  mocks.investments.create.mockResolvedValue({ id: 'row-new' });
  mocks.inbox.clearAttention.mockResolvedValue(undefined);
  mocks.users.findByUsername.mockResolvedValue({ id: 'user-alice' });
  mocks.income.create.mockResolvedValue({ id: 'income-1' });
  service = new TransferService({} as any);
});

describe('TransferService — investments', () => {
  it('records a new contribution that carries the transfer it came from', async () => {
    const result = await service.confirm(TRANSFER_ID, { kind: 'investment', account_id: ACCOUNT_US });

    expect(mocks.investments.create).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: ACCOUNT_US, investment_date: '2026-07-08', amount: 47500, transfer_id: TRANSFER_ID })
    );
    expect(result.transfer).toMatchObject({ status: 'confirmed', kind: 'investment', portfolio_investment_id: 'row-new' });
  });

  it('reuses the row an interrupted confirm already created instead of inserting again', async () => {
    mocks.investments.findByTransfer.mockResolvedValue({ id: 'row-from-earlier-attempt' });

    const result = await service.confirm(TRANSFER_ID, { kind: 'investment', account_id: ACCOUNT_US });

    expect(mocks.investments.create).not.toHaveBeenCalled();
    expect(result.transfer?.portfolio_investment_id).toBe('row-from-earlier-attempt');
  });

  it('links the hand-entered contribution for the same deposit instead of adding a second row', async () => {
    mocks.investments.listForMatching.mockResolvedValue([
      { id: 'hand-0708', investment_date: '2026-07-08', amount: 47500, note: null, transfer_id: null },
    ]);
    mocks.investments.linkToTransfer.mockResolvedValue({ id: 'hand-0708' });

    const offered = await service.candidates(TRANSFER_ID, ACCOUNT_US);
    expect(offered.preselected).toMatchObject({ kind: 'manual', rowId: 'hand-0708' });

    const result = await service.confirm(TRANSFER_ID, {
      kind: 'investment',
      account_id: ACCOUNT_US,
      link: { kind: 'manual', row_id: 'hand-0708' },
    });

    expect(mocks.investments.linkToTransfer).toHaveBeenCalledWith('hand-0708', TRANSFER_ID, ACCOUNT_US);
    expect(mocks.investments.create).not.toHaveBeenCalled();
    expect(result.transfer?.portfolio_investment_id).toBe('hand-0708');
  });

  it('does not offer, or accept, a row another transfer already points at', async () => {
    mocks.investments.listForMatching.mockResolvedValue([
      { id: 'hand-0708', investment_date: '2026-07-08', amount: 47500, note: null, transfer_id: null },
    ]);
    mocks.transfers.listLinkedInvestmentIds.mockResolvedValue(new Set(['hand-0708']));

    expect((await service.candidates(TRANSFER_ID, ACCOUNT_US)).candidates).toEqual([]);
    await expect(
      service.confirm(TRANSFER_ID, { kind: 'investment', account_id: ACCOUNT_US, link: { kind: 'manual', row_id: 'hand-0708' } })
    ).rejects.toThrow(/must be one of/);
    expect(mocks.transfers.update).not.toHaveBeenCalled();
  });

  it('claims a SIP instalment on the transfer without adding a row', async () => {
    mocks.transfers.findById.mockResolvedValue(transfer({ date: '2026-07-05', amount: 5000, counterparty: 'BSE STAR MF' }));
    mocks.investments.sipFunds.mockResolvedValue([
      { name: 'Parag Parikh Flexi Cap', sip_amount: 5000, amount_history: [{ from_month: '2026-01', amount: 5000 }] },
    ]);

    await service.confirm(TRANSFER_ID, {
      kind: 'investment',
      account_id: ACCOUNT_US,
      link: { kind: 'sip', fund: 'Parag Parikh Flexi Cap', month: '2026-07' },
    });

    expect(mocks.investments.create).not.toHaveBeenCalled();
    expect(mocks.investments.linkToTransfer).not.toHaveBeenCalled();
    expect(mocks.transfers.update).toHaveBeenCalledWith(
      TRANSFER_ID,
      expect.objectContaining({ portfolio_investment_id: null, sip_fund: 'Parag Parikh Flexi Cap', sip_month: '2026-07' })
    );
  });

  it('reports a SIP instalment another transfer claimed first', async () => {
    mocks.transfers.findById.mockResolvedValue(transfer({ date: '2026-07-05', amount: 5000 }));
    mocks.investments.sipFunds.mockResolvedValue([{ name: 'Fund', sip_amount: 5000 }]);
    mocks.transfers.update.mockRejectedValue(new Error('Failed to update transfers: duplicate key value violates unique constraint'));

    await expect(
      service.confirm(TRANSFER_ID, { kind: 'investment', account_id: ACCOUNT_US, link: { kind: 'sip', fund: 'Fund', month: '2026-07' } })
    ).rejects.toThrow('That SIP instalment is already claimed by another transfer');
  });

  it('suggests the account the last payment to the same payee went to', async () => {
    mocks.transfers.listInvestmentTransfers.mockResolvedValue([
      { ...transfer({ id: 'earlier', date: '2026-06-08', kind: 'investment', status: 'confirmed' }), account_id: ACCOUNT_US },
    ]);

    const result = await service.candidates(TRANSFER_ID);

    expect(result.suggestion?.accountId).toBe(ACCOUNT_US);
    expect(result.accountId).toBe(ACCOUNT_US);
  });

  it('finds the confirmed transfer a hand entry would duplicate', async () => {
    const recorded = { ...transfer({ kind: 'investment', status: 'confirmed' }), account_id: ACCOUNT_US };
    mocks.transfers.listInvestmentTransfers.mockResolvedValue([recorded]);

    expect(await service.findRecordedTransfer(ACCOUNT_US, '2026-07-09', 47590)).toBe(recorded);
    expect(mocks.transfers.listInvestmentTransfers).toHaveBeenCalledWith({ accountId: ACCOUNT_US, from: '2026-07-04', to: '2026-07-14' });
  });
});

/*
 * Credits reach the sheet from migration 035 onwards. Before it, every credit was discarded,
 * so nothing that arrived was ever recorded — including the six INDmoney dividends.
 */
describe('a credit', () => {
  const credit = (over: Partial<Transfer> = {}) =>
    transfer({ direction: 'credit', amount: 85000, counterparty: null, kind: 'other', note: 'Money received · classify it', ...over });

  it('becomes an income record, and the transfer row goes away with it', async () => {
    mocks.transfers.findById.mockResolvedValue(credit());

    const result = await service.confirm(TRANSFER_ID, { kind: 'income', income_kind: 'salary' });

    expect(mocks.income.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 85000, kind: 'salary', date: '2026-07-08', inbox_item_id: 'item-1', needs_review: false })
    );
    // Money earned is not money moved: a transfer row left behind would show the same ₹ twice.
    expect(mocks.transfers.delete).toHaveBeenCalledWith(TRANSFER_ID);
    expect(result).toMatchObject({ transfer: null, expenseId: null, incomeId: 'income-1' });
    expect(mocks.inbox.updateConsumed).toHaveBeenCalledWith('item-1', expect.objectContaining({ action: 'income' }), expect.anything());
  });

  it('is never recorded as an expense', async () => {
    mocks.transfers.findById.mockResolvedValue(credit());
    await expect(service.confirm(TRANSFER_ID, { kind: 'expense', category_id: 'cat-1' })).rejects.toThrow(
      /credit cannot be recorded as an expense/i
    );
    expect(mocks.income.create).not.toHaveBeenCalled();
  });

  it('does not save a payee rule, so the next credit from the same payer is still asked about', async () => {
    // A payer that sent earnings once may next send a refund; a rule would book it unseen.
    mocks.transfers.findById.mockResolvedValue(credit({ counterparty: 'ACME PAYROLL' }));
    await service.confirm(TRANSFER_ID, { kind: 'income', income_kind: 'salary', remember: true });
    expect(mocks.rules.create).not.toHaveBeenCalled();
  });
});

describe('a debit', () => {
  it('is never recorded as income', async () => {
    mocks.transfers.findById.mockResolvedValue(transfer());
    await expect(service.confirm(TRANSFER_ID, { kind: 'income', income_kind: 'salary' })).rejects.toThrow(
      /only a credit can be recorded as income/i
    );
  });
});

/*
 * The user, 2026-10-03: "I cannot confirm every email — only conflicts need review".
 * Before this every transfer waited for a person, including the ones nobody could disagree with.
 */
describe('autoResolve', () => {
  const BOB_MF = 'acct-bob-mf';
  const groww = [{ accountId: BOB_MF, accountName: 'Bob Mutual Fund', funds: [{ name: 'Bandhan Small Cap Fund', sip_date: '11th', sip_amount: 10000 }] }];

  it.each([
    ['tax', 'CBDT TIN 2 0'],
    ['cash', 'HDFC ATM'],
    ['family', 'ALICE V'],
    ['card_bill', 'INDmoney Credit Card Repayment'],
  ] as const)('confirms a %s transfer the payee already names', async (kind, counterparty) => {
    const result = await service.autoResolve(transfer({ kind, counterparty }));

    expect(result).toMatchObject({ status: 'confirmed', kind });
    expect(mocks.inbox.clearAttention).toHaveBeenCalledWith('item-1');
  });

  // "ALICE ₹47,500" off Alice's own account was an INDmoney deposit, not a self-transfer.
  it('leaves a self-transfer with no SIP behind it for a person', async () => {
    expect(await service.autoResolve(transfer({ kind: 'own_account' }))).toBeNull();
    expect(mocks.transfers.update).not.toHaveBeenCalled();
  });

  it('claims the SIP instalment a merchant-less account debit matches', async () => {
    mocks.investments.sipSchedules.mockResolvedValue(groww);
    mocks.investments.sipFunds.mockResolvedValue(groww[0].funds);

    const result = await service.autoResolve(
      transfer({ kind: 'other', counterparty: null, date: '2026-09-11', amount: 10000, payment_method: 'HDFC Bank account ••1303', owner: 'bob' })
    );

    expect(result).toMatchObject({ status: 'confirmed', kind: 'investment', account_id: BOB_MF });
    expect(mocks.transfers.update).toHaveBeenCalledWith(
      TRANSFER_ID,
      expect.objectContaining({ sip_fund: 'Bandhan Small Cap Fund', sip_month: '2026-09' })
    );
    expect(mocks.investments.create).not.toHaveBeenCalled();
  });

  it('leaves an account debit no SIP explains for a person', async () => {
    mocks.investments.sipSchedules.mockResolvedValue(groww);
    expect(await service.autoResolve(transfer({ kind: 'other', counterparty: null, date: '2026-09-11', amount: 15000 }))).toBeNull();
  });

  it('never settles money received, or a transfer already confirmed', async () => {
    expect(await service.autoResolve(transfer({ kind: 'other', direction: 'credit' }))).toBeNull();
    expect(await service.autoResolve(transfer({ kind: 'tax', status: 'confirmed' }))).toBeNull();
    expect(mocks.transfers.update).not.toHaveBeenCalled();
  });

  it('leaves the transfer waiting when settling it fails', async () => {
    mocks.transfers.update.mockRejectedValue(new Error('Gateway Timeout'));
    expect(await service.autoResolve(transfer({ kind: 'tax', counterparty: 'CBDT TIN 2 0' }))).toBeNull();
  });
});
