import { describe, it, expect } from 'vitest';
import { createSupabaseMock } from '@/lib/repositories/__tests__/supabaseMock';
import { CreditCardStatementService } from '../CreditCardStatementService';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

const TYPE_ROWS = [
  { name: 'Credit Card', is_liability: true },
  { name: 'Mutual Funds', is_liability: false },
];

const statement = (date: string, amount: number) => ({
  id: `stmt-${date}`,
  account_id: ACCOUNT_ID,
  statement_date: date,
  due_date: date,
  statement_amount: amount,
  amount_paid: 0,
});

/**
 * syncSnapshotForMonth makes four round trips in a fixed order, and the shared mock
 * resolves its queue at await time:
 *   1. credit_card_statements  → the newest statement at or before month end
 *   2. portfolio_accounts      → the account's type
 *   3. portfolio_account_types → which types are liabilities
 *   4. portfolio_snapshots     → the write
 */
function mockFor(statements: unknown[]) {
  return createSupabaseMock([
    { data: statements, error: null },
    { data: { type: 'Credit Card' }, error: null },
    { data: TYPE_ROWS, error: null },
    { data: { id: 'snap-1' }, error: null },
  ]);
}

describe('syncSnapshotForMonth', () => {
  it('carries the newest earlier statement when the month has none of its own', () => {
    // Viewing a month whose statements have not been issued yet.
    const mock = mockFor([statement('2026-08-08', 6968)]);
    const service = new CreditCardStatementService(mock.client);

    return service.syncSnapshotForMonth(ACCOUNT_ID, '2026-09').then((result) => {
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        snapshot_month: '2026-09',
        statement_month: '2026-08',
        carried_forward: true,
      });
    });
  });

  it('does not mark a statement from the month itself as carried forward', async () => {
    const mock = mockFor([statement('2026-08-17', 2530)]);
    const service = new CreditCardStatementService(mock.client);

    const result = await service.syncSnapshotForMonth(ACCOUNT_ID, '2026-08');

    expect(result.body).toMatchObject({ statement_month: '2026-08', carried_forward: false });
  });

  it('queries only statements at or before the end of the month', async () => {
    const mock = mockFor([statement('2026-08-08', 6968)]);
    const service = new CreditCardStatementService(mock.client);

    await service.syncSnapshotForMonth(ACCOUNT_ID, '2026-09');

    // September has 30 days — an off-by-one here would silently drop a statement
    // dated on the last day of the month.
    expect(mock.argsFor('lte')).toContainEqual(['statement_date', '2026-09-30']);
  });

  it('writes the statement total as a negative snapshot', async () => {
    // statement_amount is always positive; storing it verbatim is what put card debt
    // on the asset side of net worth. This path bypassed PortfolioSnapshotService
    // entirely until it was routed through it.
    const mock = mockFor([statement('2026-08-08', 6968)]);
    const service = new CreditCardStatementService(mock.client);

    await service.syncSnapshotForMonth(ACCOUNT_ID, '2026-09');

    const [payload] = mock.argsFor('upsert')[0] as [{ amount: number; snapshot_date: string }];
    expect(payload.amount).toBe(-6968);
    expect(payload.snapshot_date).toBe('2026-09-01');
  });

  it('reports when there is no statement at all', async () => {
    const mock = mockFor([]);
    const service = new CreditCardStatementService(mock.client);

    const result = await service.syncSnapshotForMonth(ACCOUNT_ID, '2026-09');

    expect(result.status).toBe(404);
  });

  it('rejects a malformed month rather than querying with it', async () => {
    const mock = mockFor([]);
    const service = new CreditCardStatementService(mock.client);

    const result = await service.syncSnapshotForMonth(ACCOUNT_ID, '2026-9');

    expect(result.status).toBe(400);
    expect(mock.calls.filter((c) => c.method === 'from')).toHaveLength(0);
  });
});

describe('list', () => {
  it('actually filters to the requested billing month', async () => {
    const mock = createSupabaseMock([{ data: [statement('2026-08-08', 6968)], error: null }]);
    const service = new CreditCardStatementService(mock.client);

    await service.list(ACCOUNT_ID, '2026-08');

    expect(mock.argsFor('gte')).toContainEqual(['statement_date', '2026-08-01']);
    expect(mock.argsFor('lt')).toContainEqual(['statement_date', '2026-09-01']);
  });

  it('rolls the year over when filtering December', async () => {
    const mock = createSupabaseMock([{ data: [], error: null }]);
    const service = new CreditCardStatementService(mock.client);

    await service.list(ACCOUNT_ID, '2026-12');

    expect(mock.argsFor('lt')).toContainEqual(['statement_date', '2027-01-01']);
  });
});

describe('create', () => {
  const input = {
    account_id: ACCOUNT_ID,
    period_start: '2026-03-09',
    period_end: '2026-04-08',
    statement_date: '2026-04-08',
    due_date: '2026-04-28',
    statement_amount: 5000,
  };

  it('looks for an existing statement in the billing month itself, not among the latest few', async () => {
    // A back-dated statement: April's is older than the three most recent, so checking
    // only those would let a second April statement in.
    const mock = createSupabaseMock([
      { data: [], error: null },
      { data: statement('2026-04-08', 5000), error: null },
    ]);
    const service = new CreditCardStatementService(mock.client);

    await service.create(input);

    expect(mock.argsFor('gte')).toContainEqual(['statement_date', '2026-04-01']);
    expect(mock.argsFor('lt')).toContainEqual(['statement_date', '2026-05-01']);
  });

  it('refuses a second statement for a billing month that already has one', async () => {
    const mock = createSupabaseMock([{ data: [statement('2026-04-08', 4000)], error: null }]);
    const service = new CreditCardStatementService(mock.client);

    const result = await service.create(input);

    expect(result.status).toBe(409);
    expect(mock.calls.filter((c) => c.method === 'insert')).toHaveLength(0);
  });
});

describe('statement writes never push a snapshot', () => {
  /**
   * Statements and snapshots are one-way by design: /portfolio/snapshots pulls a
   * balance when asked, and nothing on /portfolio/credit-cards pushes one. Editing a
   * statement must not silently rewrite a month's recorded balance.
   */
  const snapshotWrites = (mock: ReturnType<typeof createSupabaseMock>) =>
    mock.calls.filter((c) => c.method === 'from' && c.args[0] === 'portfolio_snapshots');

  it('does not write a snapshot when a statement is created', async () => {
    const mock = createSupabaseMock([
      { data: [], error: null }, // duplicate-month check
      { data: statement('2026-09-08', 5000), error: null }, // insert
    ]);
    const service = new CreditCardStatementService(mock.client);

    const result = await service.create({
      account_id: ACCOUNT_ID,
      period_start: '2026-08-09',
      period_end: '2026-09-08',
      statement_date: '2026-09-08',
      due_date: '2026-09-28',
      statement_amount: 5000,
    });

    expect(result.status).toBe(200);
    expect(snapshotWrites(mock)).toHaveLength(0);
  });

  it('does not write a snapshot when a statement is edited', async () => {
    const mock = createSupabaseMock([{ data: statement('2026-08-08', 9999), error: null }]);
    const service = new CreditCardStatementService(mock.client);

    await service.update({ id: 'stmt-1', statement_amount: 9999 });

    expect(snapshotWrites(mock)).toHaveLength(0);
  });

  it('leaves the snapshot alone when a statement is deleted', async () => {
    // The snapshot stays until the snapshots page is asked to sync that month again.
    const mock = createSupabaseMock([{ data: null, error: null }]);
    const service = new CreditCardStatementService(mock.client);

    await service.delete('stmt-1');

    expect(snapshotWrites(mock)).toHaveLength(0);
  });
});

describe('syncAllSnapshotsForMonth', () => {
  const CARD_A = '22222222-2222-4222-8222-222222222222';
  const CARD_B = '33333333-3333-4333-8333-333333333333';
  const card = (id: string, name: string) => ({ id, name, type: 'Credit Card', is_active: true });

  it('syncs every active card in one request and flags carried-forward ones', async () => {
    const mock = createSupabaseMock([
      { data: [card(CARD_A, 'Rewards'), card(CARD_B, 'Axis RuPay')], error: null },
      // card A: statement lookup, account type, liability types, write
      { data: [statement('2026-07-20', 61070)], error: null },
      { data: { type: 'Credit Card' }, error: null },
      { data: TYPE_ROWS, error: null },
      { data: { id: 's1' }, error: null },
      // card B
      { data: [statement('2026-09-17', 2530)], error: null },
      { data: { type: 'Credit Card' }, error: null },
      { data: TYPE_ROWS, error: null },
      { data: { id: 's2' }, error: null },
    ]);
    const service = new CreditCardStatementService(mock.client);

    const result = await service.syncAllSnapshotsForMonth('2026-09');

    expect(result.status).toBe(200);
    const body = result.body as { synced: Array<{ name: string; carried_forward: boolean }>; skipped: unknown[] };
    expect(body.synced.map((c) => [c.name, c.carried_forward])).toEqual([
      ['Rewards', true],
      ['Axis RuPay', false],
    ]);
    expect(body.skipped).toEqual([]);
  });

  it('skips a card with no statement instead of failing the whole batch', async () => {
    // One unused card should not stop the others from syncing.
    const mock = createSupabaseMock([
      { data: [card(CARD_A, 'Unused card'), card(CARD_B, 'Axis RuPay')], error: null },
      { data: [], error: null }, // card A has no statement at all
      { data: [statement('2026-08-17', 2530)], error: null },
      { data: { type: 'Credit Card' }, error: null },
      { data: TYPE_ROWS, error: null },
      { data: { id: 's2' }, error: null },
    ]);
    const service = new CreditCardStatementService(mock.client);

    const body = (await service.syncAllSnapshotsForMonth('2026-09')).body as {
      synced: Array<{ name: string }>;
      skipped: Array<{ name: string }>;
    };

    expect(body.synced.map((c) => c.name)).toEqual(['Axis RuPay']);
    expect(body.skipped.map((c) => c.name)).toEqual(['Unused card']);
  });

  it('rejects a malformed month before touching the database', async () => {
    const mock = createSupabaseMock([{ data: [], error: null }]);
    const service = new CreditCardStatementService(mock.client);

    expect((await service.syncAllSnapshotsForMonth('2026')).status).toBe(400);
    expect(mock.calls.filter((c) => c.method === 'from')).toHaveLength(0);
  });

  it('records a card that fails outright as skipped, and keeps going', async () => {
    const mock = createSupabaseMock([
      { data: [card('not-a-uuid', 'Corrupt row'), card(CARD_B, 'Axis RuPay')], error: null },
      { data: [statement('2026-08-17', 2530)], error: null },
      { data: { type: 'Credit Card' }, error: null },
      { data: TYPE_ROWS, error: null },
      { data: { id: 's2' }, error: null },
    ]);
    const service = new CreditCardStatementService(mock.client);

    const body = (await service.syncAllSnapshotsForMonth('2026-09')).body as {
      synced: Array<{ name: string }>;
      skipped: Array<{ name: string }>;
    };

    expect(body.skipped.map((c) => c.name)).toEqual(['Corrupt row']);
    expect(body.synced.map((c) => c.name)).toEqual(['Axis RuPay']);
  });
});
