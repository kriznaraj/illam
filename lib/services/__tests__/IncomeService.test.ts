import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomeWithUser } from '@/types';

const mocks = vi.hoisted(() => ({
  income: {
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), findById: vi.fn(),
    findByDateRange: vi.fn(), findByInboxItem: vi.fn(),
  },
  inbox: { updateItem: vi.fn() },
}));

vi.mock('@/lib/repositories/IncomeRepository', () => ({
  IncomeRepository: class { constructor() { return mocks.income as never; } },
}));
vi.mock('@/lib/repositories/InboxRepository', () => ({
  InboxRepository: class { constructor() { return mocks.inbox as never; } },
}));

import { IncomeService } from '../IncomeService';

const USER_ID = '5ca66709-e8de-4be9-8135-8bdb519055f4';

const row = (over: Partial<IncomeWithUser> = {}): IncomeWithUser =>
  ({
    id: 'inc-1',
    date: '2026-09-15',
    amount: 85000,
    currency: 'INR',
    kind: 'salary',
    source_name: null,
    description: null,
    user_id: USER_ID,
    account_id: null,
    inbox_item_id: null,
    source: 'manual',
    needs_review: false,
    note: null,
    created_at: '2026-09-15T00:00:00Z',
    updated_at: '2026-09-15T00:00:00Z',
    ...over,
  }) as IncomeWithUser;

let service: IncomeService;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.income.create.mockImplementation(async (input: unknown) => ({ id: 'inc-new', ...(input as object) }));
  service = new IncomeService({} as never);
});

describe('IncomeService.summarise', () => {
  /*
   * The six live dividends are USD paid inside the INDmoney wallet. Adding them to rupees
   * would need a rate this app does not hold, so each currency is totalled on its own.
   */
  it('keeps each currency apart instead of adding them together', () => {
    const summary = service.summarise(
      [row({ amount: 85000 }), row({ id: 'inc-2', amount: 3.96, currency: 'USD', kind: 'dividend' })],
      '2026-09'
    );

    expect(summary.totals).toEqual({ INR: 85000, USD: 3.96 });
    expect(summary.byKind).toEqual([
      { kind: 'salary', currency: 'INR', amount: 85000, count: 1 },
      { kind: 'dividend', currency: 'USD', amount: 3.96, count: 1 },
    ]);
  });

  it('leaves money awaiting review out of the totals, as needs_review expenses are', () => {
    const summary = service.summarise([row({ amount: 1000 }), row({ id: 'inc-2', amount: 9999, needs_review: true })], '2026-09');
    expect(summary.totals.INR).toBe(1000);
    expect(summary.count).toBe(1);
  });

  it('always reports rupees, even in a month with none', () => {
    expect(service.summarise([], '2026-09').totals).toEqual({ INR: 0 });
  });
});

describe('IncomeService.create', () => {
  it('rejects a kind the table would refuse', async () => {
    await expect(
      service.create({ date: '2026-09-15', amount: 100, kind: 'bonus' as never, user_id: USER_ID })
    ).rejects.toThrow(/kind must be one of/);
  });

  it('rejects a zero or negative amount', async () => {
    await expect(service.create({ date: '2026-09-15', amount: 0, kind: 'salary', user_id: USER_ID })).rejects.toThrow(
      /greater than 0/
    );
  });

  it('defaults the currency to rupees and upper-cases what it is given', async () => {
    await service.create({ date: '2026-09-15', amount: 100, kind: 'salary', user_id: USER_ID });
    expect(mocks.income.create).toHaveBeenCalledWith(expect.objectContaining({ currency: 'INR' }));

    await service.create({ date: '2026-09-15', amount: 3.96, currency: 'usd', kind: 'dividend', user_id: USER_ID });
    expect(mocks.income.create).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'USD' }));
  });
});

describe('IncomeService.recordFromInbox', () => {
  // The two Gmail accounts sync independently and a timed-out run is retried, so the same
  // credit reaches this more than once.
  it('returns the row an alert already produced rather than inserting a second', async () => {
    mocks.income.findByInboxItem.mockResolvedValue(row({ id: 'inc-existing' }));

    const result = await service.recordFromInbox({
      inbox_item_id: 'item-1',
      date: '2026-09-15',
      amount: 3.96,
      kind: 'dividend',
      user_id: USER_ID,
    });

    expect(result.id).toBe('inc-existing');
    expect(mocks.income.create).not.toHaveBeenCalled();
  });

  it('inserts when the alert has produced nothing yet, marked as coming from Madal', async () => {
    mocks.income.findByInboxItem.mockResolvedValue(null);
    await service.recordFromInbox({
      inbox_item_id: 'item-1',
      date: '2026-09-15',
      amount: 3.96,
      kind: 'dividend',
      user_id: USER_ID,
    });
    expect(mocks.income.create).toHaveBeenCalledWith(expect.objectContaining({ source: 'inbox', inbox_item_id: 'item-1' }));
  });
});

describe('IncomeService.remove', () => {
  /*
   * Without this the alert keeps pointing at a row that is gone: Madal goes on saying
   * "Recorded under Income in Selavu", the record sheet never returns, and the credit can
   * never be filed again.
   */
  it('releases the alert the record came from', async () => {
    mocks.income.findById.mockResolvedValue(row({ inbox_item_id: 'item-1', source: 'inbox' }));
    await service.remove('3af7a6f7-10ab-4ccb-9344-06ca54368d6c');

    expect(mocks.income.delete).toHaveBeenCalled();
    expect(mocks.inbox.updateItem).toHaveBeenCalledWith('item-1', { consumed: null });
  });

  it('leaves the inbox alone for a record typed in by hand', async () => {
    mocks.income.findById.mockResolvedValue(row({ inbox_item_id: null }));
    await service.remove('3af7a6f7-10ab-4ccb-9344-06ca54368d6c');
    expect(mocks.inbox.updateItem).not.toHaveBeenCalled();
  });

  it('still reports the deletion when the alert cannot be released', async () => {
    // The deletion the person asked for already happened; failing here would deny it.
    mocks.income.findById.mockResolvedValue(row({ inbox_item_id: 'item-1' }));
    mocks.inbox.updateItem.mockRejectedValue(new Error('Gateway Timeout'));
    await expect(service.remove('3af7a6f7-10ab-4ccb-9344-06ca54368d6c')).resolves.toBeUndefined();
  });
});
