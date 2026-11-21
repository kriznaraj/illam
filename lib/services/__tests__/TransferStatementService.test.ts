import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transfer } from '@/types';

const repo = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
const transferService = vi.hoisted(() => ({ apply: vi.fn(), autoResolve: vi.fn() }));
const investments = vi.hoisted(() => ({ listForMatching: vi.fn(), create: vi.fn() }));
const decisions = vi.hoisted(() => ({ refileAsFamily: vi.fn() }));

vi.mock('@/lib/repositories/TransferRepository', () => ({ TransferRepository: class { constructor() { return repo as any; } } }));
vi.mock('../TransferService', () => ({ TransferService: class { constructor() { return transferService as any; } } }));
vi.mock('../PortfolioInvestmentService', () => ({ PortfolioInvestmentService: class { constructor() { return investments as any; } } }));
vi.mock('../MadalDecisionService', () => ({ MadalDecisionService: class { constructor() { return decisions as any; } } }));

import { TransferStatementService } from '../TransferStatementService';

const transfer = (over: Partial<Transfer>): Transfer => ({
  id: 't-1',
  inbox_item_id: 'item-1',
  owner: 'alice',
  date: '2026-10-07',
  amount: 40000,
  direction: 'debit',
  counterparty: null,
  payment_method: 'HDFC Bank account ••3101',
  kind: 'other',
  account_id: null,
  portfolio_investment_id: null,
  credit_card_statement_id: null,
  expense_id: null,
  note: null,
  status: 'needs_review',
  created_at: '2026-10-06T18:43:00Z',
  updated_at: '2026-10-06T18:43:00Z',
  ...over,
});
const line = (narration: string, amount = 40000) => ({ date: '2026-10-07', narration, direction: 'debit' as const, amount, balance: 1 });

let service: TransferStatementService;
beforeEach(() => {
  vi.clearAllMocks();
  repo.update.mockImplementation(async (id: string, patch: object) => ({ ...transfer({ id }), ...patch }));
  transferService.apply.mockResolvedValue({ transfer: null, expenseId: null });
  transferService.autoResolve.mockResolvedValue(null);
  investments.listForMatching.mockResolvedValue([]);
  investments.create.mockResolvedValue({ id: 'inv-new' });
  decisions.refileAsFamily.mockResolvedValue({ id: 'decision-1' });
  service = new TransferStatementService({} as any, {
    bob: { '1707': { accountId: 'acc-wallet', alsoCheck: ['acc-kite'] } },
  });
});

describe('TransferStatementService.settleFromStatement', () => {
  it('confirms a household transfer the narration proves, with the narration as its note', async () => {
    const waiting = transfer({});
    repo.list.mockResolvedValue([waiting]);

    const outcome = await service.settleFromStatement('alice', [
      { last4: '3101', lines: [line('NEFT Dr-KKBK0000123-BOB K-SANDOZ - MUM-HDFCH00012345678-NET BANKING SI')] },
    ]);

    expect(transferService.apply).toHaveBeenCalledWith(waiting, {
      kind: 'family',
      // Long digit runs are redacted: the transfers table is anon-readable.
      note: 'Statement: NEFT Dr-KKBK0000123-BOB K-SANDOZ - MUM-HDFCH••5678-NET BANKING SI',
    });
    expect(outcome).toEqual({ matched: 1, settled: 1, recorded: 0, refiled: [], contradicted: [] });
  });

  it('gives any other reading to the transfer and lets the usual rules decide', async () => {
    repo.list.mockResolvedValue([transfer({ amount: 25000 })]);
    transferService.autoResolve.mockResolvedValueOnce({ status: 'confirmed' });

    const outcome = await service.settleFromStatement('alice', [
      { last4: '3101', lines: [line('ACH D- Indian Clearing Corp-0000ABCDValue Dt 07/10/2026', 25000)] },
    ]);

    expect(transferService.apply).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('t-1', {
      note: 'Statement: ACH D- Indian Clearing Corp-0000ABCDValue Dt 07/10/2026',
      kind: 'investment',
      counterparty: 'Indian Clearing Corp',
    });
    expect(transferService.autoResolve).toHaveBeenCalledWith(expect.objectContaining({ kind: 'investment' }));
    expect(outcome).toEqual({ matched: 1, settled: 1, recorded: 0, refiled: [], contradicted: [] });
  });

  it("only looks at this owner's transfers", async () => {
    repo.list.mockResolvedValue([transfer({ owner: 'bob' })]);
    const outcome = await service.settleFromStatement('alice', [{ last4: '3101', lines: [line('NEFT Dr-X-BOB K-')] }]);
    expect(outcome).toEqual({ matched: 0, settled: 0, recorded: 0, refiled: [], contradicted: [] });
  });

  it('leaves a transfer as it was when settling it fails', async () => {
    repo.list.mockResolvedValue([transfer({})]);
    transferService.apply.mockRejectedValueOnce(new Error('timeout'));
    const outcome = await service.settleFromStatement('alice', [{ last4: '3101', lines: [line('NEFT Dr-KKBK0000123-BOB K-')] }]);
    expect(outcome).toEqual({ matched: 1, settled: 0, recorded: 0, refiled: [], contradicted: [] });
  });

  describe('a debit no alert reported', () => {
    const si = { date: '2026-08-02', narration: '50100999991707 NET BANKING SI -Investment Value Dt 02/08/2026', direction: 'debit' as const, amount: 25000, balance: 1 };
    const tpt = { date: '2026-08-07', narration: '50100999991707-TPT-HDFC1234 B-ZERODHA BROKING LTD-USCNB A/C', direction: 'debit' as const, amount: 30000, balance: 2 };

    it('becomes a contribution on the mapped account, named from the statement', async () => {
      // The ₹30,000 wallet load did alert, and is a transfer already; the SI did not.
      repo.list.mockResolvedValue([transfer({ owner: 'bob', date: '2026-08-07', amount: 30000, status: 'confirmed', payment_method: 'HDFC Bank account ••1303' })]);

      const outcome = await service.settleFromStatement('bob', [{ last4: '1303', lines: [si, tpt] }]);

      expect(investments.create).toHaveBeenCalledTimes(1);
      expect(investments.create).toHaveBeenCalledWith({
        account_id: 'acc-wallet',
        investment_date: '2026-08-02',
        amount: 25000,
        kind: 'adhoc',
        note: 'Standing instruction to ZERODHA BROKING LTD (from the bank statement)',
      });
      expect(investments.listForMatching).toHaveBeenCalledWith('acc-kite', '2026-07-30', '2026-08-05');
      expect(outcome.recorded).toBe(1);
    });

    it('is not recorded twice — a hand entry or an earlier read already has it', async () => {
      repo.list.mockResolvedValue([]);
      investments.listForMatching.mockImplementation(async (id: string) =>
        id === 'acc-kite' ? [{ id: 'inv-hand', investment_date: '2026-08-03', amount: 25000, note: null, transfer_id: null }] : []
      );
      const outcome = await service.settleFromStatement('bob', [{ last4: '1303', lines: [si] }]);
      expect(investments.create).not.toHaveBeenCalled();
      expect(outcome.recorded).toBe(0);
    });

    it('ignores debits to accounts nobody mapped', async () => {
      repo.list.mockResolvedValue([]);
      const outcome = await service.settleFromStatement('bob', [
        { last4: '1303', lines: [{ ...si, narration: '50100999997777 NET BANKING SI -Rent' }] },
      ]);
      expect(investments.create).not.toHaveBeenCalled();
      expect(outcome.recorded).toBe(0);
    });
  });

  // The user, 2026-10-18: a statement's proof refiles a filing by itself, with an undo record.
  it('refiles a confirmed transfer the statement proves went to the other person', async () => {
    const filed = transfer({ amount: 47775, date: '2026-08-07', kind: 'investment', status: 'confirmed', account_id: 'acc-us' });
    repo.list.mockResolvedValue([filed]);

    const outcome = await service.settleFromStatement('alice', [
      { last4: '3101', lines: [{ ...line('50100333331303-TPT-HDFC1B87 A1-K BOB Value Dt 07/08/2026', 47775), date: '2026-08-07' }] },
    ]);

    expect(decisions.refileAsFamily).toHaveBeenCalledWith(
      filed,
      expect.objectContaining({ reason: expect.stringContaining('went to Bob'), evidence: expect.stringContaining('BOB') })
    );
    expect(outcome.refiled).toEqual([filed]);
    expect(outcome.contradicted).toEqual([]);
    // Refiling is MadalDecisionService's job, so the undo record cannot be skipped.
    expect(transferService.apply).not.toHaveBeenCalled();
  });

  it('reports a contradiction it could not refile, so a person still sees it', async () => {
    const filed = transfer({ amount: 47775, date: '2026-08-07', kind: 'investment', status: 'confirmed', account_id: 'acc-us' });
    repo.list.mockResolvedValue([filed]);
    decisions.refileAsFamily.mockRejectedValueOnce(new Error("Could not find the table 'public.madal_decisions'"));

    const outcome = await service.settleFromStatement('alice', [
      { last4: '3101', lines: [{ ...line('50100333331303-TPT-HDFC1B87 A1-K BOB Value Dt 07/08/2026', 47775), date: '2026-08-07' }] },
    ]);

    expect(outcome.refiled).toEqual([]);
    expect(outcome.contradicted).toEqual([filed]);
  });
});
