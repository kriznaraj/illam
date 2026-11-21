import { describe, it, expect } from 'vitest';
import { createSupabaseMock } from '@/lib/repositories/__tests__/supabaseMock';
import { PortfolioSnapshotService } from '../PortfolioSnapshotService';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

const TYPE_ROWS_WITH_COLUMN = [
  { name: 'Credit Card', is_liability: true },
  { name: 'Loan', is_liability: true },
  { name: 'Mutual Funds', is_liability: false },
];

// Pre-migration-028 shape: select('*') returns the rows without the column at all.
const TYPE_ROWS_WITHOUT_COLUMN = [{ name: 'Credit Card' }, { name: 'Mutual Funds' }];

/**
 * `upsert` makes three round trips in a fixed order, and the shared mock resolves
 * from its queue at await time, so the queue mirrors that order:
 *   1. portfolio_accounts  → the account's type
 *   2. portfolio_account_types → which types are liabilities
 *   3. portfolio_snapshots → the write itself
 */
function mockFor(accountType: string, typeRows: unknown[]) {
  return createSupabaseMock([
    { data: { type: accountType }, error: null },
    { data: typeRows, error: null },
    { data: { id: 'snap-1' }, error: null },
  ]);
}

function amountWritten(mock: ReturnType<typeof createSupabaseMock>) {
  const [payload] = mock.argsFor('upsert')[0] as [{ amount: number }];
  return payload.amount;
}

describe('PortfolioSnapshotService — liability sign', () => {
  it('stores a credit-card balance negative even when handed a positive figure', async () => {
    // This is the statement-sync path: credit_card_statements.statement_amount is
    // always positive, and writing it verbatim is what put every card's debt on the
    // asset side of net worth from 2026-01 onwards.
    const mock = mockFor('Credit Card', TYPE_ROWS_WITH_COLUMN);
    const service = new PortfolioSnapshotService(mock.client);

    await service.upsert({ account_id: ACCOUNT_ID, snapshot_date: '2026-09-01', amount: 61070 });

    expect(amountWritten(mock)).toBe(-61070);
  });

  it('leaves an already-negative liability alone', async () => {
    const mock = mockFor('Credit Card', TYPE_ROWS_WITH_COLUMN);
    const service = new PortfolioSnapshotService(mock.client);

    await service.upsert({ account_id: ACCOUNT_ID, snapshot_date: '2026-09-01', amount: -61070 });

    expect(amountWritten(mock)).toBe(-61070);
  });

  it('does not touch an asset account', async () => {
    const mock = mockFor('Mutual Funds', TYPE_ROWS_WITH_COLUMN);
    const service = new PortfolioSnapshotService(mock.client);

    await service.upsert({ account_id: ACCOUNT_ID, snapshot_date: '2026-09-01', amount: 4457169 });

    expect(amountWritten(mock)).toBe(4457169);
  });

  it('still corrects the sign before migration 028 has been applied', async () => {
    // The migration is run by hand in the Supabase SQL editor, so the code must be
    // correct in the window before that happens.
    const mock = mockFor('Credit Card', TYPE_ROWS_WITHOUT_COLUMN);
    const service = new PortfolioSnapshotService(mock.client);

    await service.upsert({ account_id: ACCOUNT_ID, snapshot_date: '2026-09-01', amount: 2601 });

    expect(amountWritten(mock)).toBe(-2601);
  });

  it('normalises on update too, using the account the snapshot is moving to', async () => {
    const mock = createSupabaseMock([
      { data: { type: 'Credit Card' }, error: null },
      { data: TYPE_ROWS_WITH_COLUMN, error: null },
      { data: { id: 'snap-1', amount: -6968 }, error: null },
    ]);
    const service = new PortfolioSnapshotService(mock.client);

    await service.update('22222222-2222-4222-8222-222222222222', {
      account_id: ACCOUNT_ID,
      amount: 6968,
    });

    const [payload] = mock.argsFor('update')[0] as [{ amount: number }];
    expect(payload.amount).toBe(-6968);
  });
});
