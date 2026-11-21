import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortfolioInvestmentService } from '../PortfolioInvestmentService';

/**
 * Focused on the auto-recurring ("Auto Monthly Contribution") path.
 *
 * Contributions are materialised as real `portfolio_investments` rows, so the
 * amount for a month is whatever its row says — not whatever the account
 * currently holds. Two consequences are covered here: changing the amount has
 * to restate the rows from a chosen month, and a missing month must be filled
 * at the amount that was running then rather than today's.
 */

const ACCOUNT = 'acc-nps';

/** Captures the `.update(...).eq(...).gte(...)` chain the service builds. */
function updateMock(result: { data?: unknown; error?: unknown }) {
  const calls: Record<string, unknown[]> = {};
  const builder: any = {};
  for (const m of ['eq', 'gte']) {
    builder[m] = (...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return builder;
    };
  }
  builder.select = () => Promise.resolve(result);
  const update = vi.fn((patch: unknown) => {
    (calls.update ??= []).push([patch]);
    return builder;
  });
  return { update, calls };
}

let service: PortfolioInvestmentService;
let from: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  from = vi.fn();
  service = new PortfolioInvestmentService({ from } as any);
});

describe('setRecurringAmountFrom', () => {
  it('restates only the rows from the chosen month onwards', async () => {
    const { update, calls } = updateMock({ data: [{ id: '1' }, { id: '2' }], error: null });
    from.mockReturnValue({ update });

    const result = await service.setRecurringAmountFrom({
      accountId: ACCOUNT,
      amount: 30000,
      fromMonth: '2026-09',
    });

    expect(result).toEqual({ updated: 2, from_month: '2026-09' });
    expect(calls.update).toEqual([[{ amount: 30000 }]]);
    // The lower bound is what protects every earlier month.
    expect(calls.gte).toEqual([['investment_date', '2026-09-01']]);
    expect(calls.eq).toEqual([
      ['account_id', ACCOUNT],
      ['kind', 'recurring'],
      ['note', '__AUTO_MONTHLY__'],
    ]);
  });

  it('reports how many months it touched', async () => {
    const { update } = updateMock({ data: [{ id: '1' }], error: null });
    from.mockReturnValue({ update });

    const result = await service.setRecurringAmountFrom({
      accountId: ACCOUNT,
      amount: 30000,
      fromMonth: '2027-01',
    });

    expect(result.updated).toBe(1);
  });

  it('reports zero when no month was in range', async () => {
    const { update } = updateMock({ data: [], error: null });
    from.mockReturnValue({ update });

    const result = await service.setRecurringAmountFrom({
      accountId: ACCOUNT,
      amount: 30000,
      fromMonth: '2030-01',
    });

    expect(result.updated).toBe(0);
  });

  it.each([
    ['2026-13', 'month out of range'],
    ['2026', 'no month part'],
    ['', 'empty'],
    ['aug-2026', 'not ISO'],
  ])('rejects %s (%s)', async (fromMonth) => {
    from.mockReturnValue({ update: vi.fn() });
    await expect(
      service.setRecurringAmountFrom({ accountId: ACCOUNT, amount: 30000, fromMonth })
    ).rejects.toThrow('fromMonth must be a YYYY-MM month');
  });

  it.each([0, -100, Number.NaN])('rejects a non-positive amount (%s)', async (amount) => {
    from.mockReturnValue({ update: vi.fn() });
    await expect(
      service.setRecurringAmountFrom({ accountId: ACCOUNT, amount, fromMonth: '2026-09' })
    ).rejects.toThrow('amount must be a positive number');
  });

  it('requires an account id', async () => {
    from.mockReturnValue({ update: vi.fn() });
    await expect(
      service.setRecurringAmountFrom({ accountId: '', amount: 30000, fromMonth: '2026-09' })
    ).rejects.toThrow('accountId is required');
  });

  it('never issues a write when validation fails', async () => {
    const update = vi.fn();
    from.mockReturnValue({ update });
    await expect(
      service.setRecurringAmountFrom({ accountId: ACCOUNT, amount: 30000, fromMonth: 'nope' })
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('surfaces a write failure', async () => {
    const { update } = updateMock({ data: null, error: { message: 'permission denied' } });
    from.mockReturnValue({ update });

    await expect(
      service.setRecurringAmountFrom({ accountId: ACCOUNT, amount: 30000, fromMonth: '2026-09' })
    ).rejects.toThrow('Failed to update recurring rows: permission denied');
  });

  it('degrades quietly when the investments table is absent', async () => {
    // Same tolerance the rest of the service has for this optional table.
    const { update } = updateMock({
      data: null,
      error: { message: 'Could not find the table portfolio_investments in the schema cache' },
    });
    from.mockReturnValue({ update });

    await expect(
      service.setRecurringAmountFrom({ accountId: ACCOUNT, amount: 30000, fromMonth: '2026-09' })
    ).resolves.toEqual({ updated: 0, from_month: '2026-09' });
  });
});
