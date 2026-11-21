import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveSnapshotDate } from '@/lib/utils';

const { repo } = vi.hoisted(() => ({
  repo: {
    verifyAccount: vi.fn(),
    listActiveHoldingsMinimal: vi.fn(),
    createHolding: vi.fn(),
    upsertHoldingSnapshot: vi.fn(),
    upsertAccountSnapshot: vi.fn(),
  },
}));

vi.mock('../../repositories/PortfolioCdslImportRepository', () => ({
  PortfolioCdslImportRepository: class {
    constructor() {
      return repo as any;
    }
  },
}));

import { PortfolioCdslImportService, type ImportRow } from '../PortfolioCdslImportService';

const STOCK_ACCOUNT = 'acc-stock';
const MF_ACCOUNT = 'acc-mf';

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  name: 'INFOSYS',
  symbol: 'INFY',
  identifier: 'INE009A01021',
  quantity: 10,
  unit_amount: 100,
  amount: 1000,
  date: 'Dec 2025',
  account_type: 'stock',
  ...over,
});

let service: PortfolioCdslImportService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Happy defaults; individual tests override.
  repo.verifyAccount.mockResolvedValue({ data: { id: STOCK_ACCOUNT }, error: null });
  repo.listActiveHoldingsMinimal.mockResolvedValue({ data: [], error: null });
  repo.createHolding.mockResolvedValue({ data: { id: 'holding-1' }, error: null });
  repo.upsertHoldingSnapshot.mockResolvedValue({ error: null });
  repo.upsertAccountSnapshot.mockResolvedValue({ error: null });
  service = new PortfolioCdslImportService({} as any);
});

describe('deriveSnapshotDate', () => {
  // The snapshot lands on the first of the NEXT month. Getting this wrong
  // files a whole import under the wrong month with no visible error.
  it.each([
    ['Dec 2025', '2026-01-01'],
    ['December 2025', '2026-01-01'],
    ['November 2025', '2025-12-01'],
    ['Jan 2026', '2026-02-01'],
    ['2025-12', '2026-01-01'],
    ['2025-12-01', '2026-01-01'],
    ['2025-12-31', '2026-01-01'],
    ['31-12-2025', '2026-01-01'],
    ['1-12-2025', '2026-01-01'],
  ])('parses %s to %s', (input, expected) => {
    expect(deriveSnapshotDate(input)).toBe(expected);
  });

  it('rolls the year over from December', () => {
    expect(deriveSnapshotDate('Dec 2025')).toBe('2026-01-01');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(deriveSnapshotDate('  DECEMBER 2025  ')).toBe('2026-01-01');
  });

  it.each(['', '   ', 'garbage', 'Dec', '2025', '2025-13'])(
    'returns null for %s',
    (input) => {
      expect(deriveSnapshotDate(input)).toBeNull();
    }
  );
});

describe('importCdsl — request validation', () => {
  it.each([
    ['missing rows', {}],
    ['empty rows', { rows: [] }],
    ['rows not an array', { rows: 'nope' }],
  ])('rejects %s with 400', async (_label, body) => {
    const result = await service.importCdsl(body as any);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'rows must be a non-empty array' });
  });

  it('rejects rows with no derivable snapshot date', async () => {
    const result = await service.importCdsl({ rows: [row({ date: null })] });
    expect(result.status).toBe(400);
    expect((result.body as any).error).toContain('Could not determine snapshot date');
  });

  it('rejects an unparseable date', async () => {
    const result = await service.importCdsl({ rows: [row({ date: 'sometime' })] });
    expect(result.status).toBe(400);
  });

  it('takes the snapshot date from the first row that has one', async () => {
    const result = await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row({ date: null }), row({ date: 'Nov 2025' })],
    });
    expect(result.status).toBe(200);
    expect((result.body as any).snapshot_date).toBe('2025-12-01');
  });

  it('rejects a file with no recognised account_type', async () => {
    const result = await service.importCdsl({ rows: [row({ account_type: 'bond' })] });
    expect(result.status).toBe(400);
    expect((result.body as any).error).toContain('No rows with a recognised account_type');
  });

  it('requires stock_account_id when the file has stock rows', async () => {
    const result = await service.importCdsl({ rows: [row({ account_type: 'stock' })] });
    expect(result.status).toBe(400);
    expect((result.body as any).error).toContain('stock_account_id is required');
  });

  it('requires mf_account_id when the file has mf rows', async () => {
    const result = await service.importCdsl({ rows: [row({ account_type: 'mf' })] });
    expect(result.status).toBe(400);
    expect((result.body as any).error).toContain('mf_account_id is required');
  });

  it('matches account_type case-insensitively', async () => {
    const result = await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row({ account_type: 'STOCK' })],
    });
    expect(result.status).toBe(200);
  });

  it('404s when the stock account does not exist', async () => {
    repo.verifyAccount.mockResolvedValue({ data: null, error: { message: 'no rows' } });
    const result = await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row()],
    });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Stock account not found' });
  });

  it('404s when the mf account does not exist', async () => {
    repo.verifyAccount.mockResolvedValue({ data: null, error: null });
    const result = await service.importCdsl({
      mf_account_id: MF_ACCOUNT,
      rows: [row({ account_type: 'mf' })],
    });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'MF account not found' });
  });

  it('never writes when validation fails', async () => {
    await service.importCdsl({ rows: [row({ account_type: 'stock' })] });
    expect(repo.createHolding).not.toHaveBeenCalled();
    expect(repo.upsertHoldingSnapshot).not.toHaveBeenCalled();
    expect(repo.upsertAccountSnapshot).not.toHaveBeenCalled();
  });
});

describe('importCdsl — successful import', () => {
  it('reports processed and skipped counts', async () => {
    const result = await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row(), row({ name: 'TCS', symbol: 'TCS' }), row({ account_type: 'bond' })],
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      snapshot_date: '2026-01-01',
      rows_processed: 3,
      skipped_rows: 1,
    });
  });

  it('splits stock and mf rows onto their own accounts', async () => {
    repo.verifyAccount.mockResolvedValue({ data: { id: 'any' }, error: null });

    const result = await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      mf_account_id: MF_ACCOUNT,
      rows: [row(), row({ name: 'PARAG FLEXI', symbol: null, account_type: 'mf' })],
    });

    const body = result.body as any;
    expect(body.stock).toMatchObject({ account_id: STOCK_ACCOUNT, rows_processed: 1 });
    expect(body.mf).toMatchObject({ account_id: MF_ACCOUNT, rows_processed: 1 });
  });

  it('leaves the mf block null when the file has no mf rows', async () => {
    const result = await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row()],
    });
    expect((result.body as any).mf).toBeNull();
  });

  it('creates holdings with stock defaults', async () => {
    await service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] });
    expect(repo.createHolding).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: STOCK_ACCOUNT,
        name: 'INFOSYS',
        symbol: 'INFY',
        identifier: 'INE009A01021',
        instrument_type: 'nse_stock',
        quantity_unit: 'shares',
        is_active: true,
      })
    );
  });

  it('creates holdings with mf defaults', async () => {
    await service.importCdsl({
      mf_account_id: MF_ACCOUNT,
      rows: [row({ account_type: 'mf' })],
    });
    expect(repo.createHolding).toHaveBeenCalledWith(
      expect.objectContaining({ instrument_type: 'mf_nav', quantity_unit: 'units' })
    );
  });

  it('counts a created holding as created, not updated', async () => {
    const result = await service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] });
    expect((result.body as any).stock).toMatchObject({
      holdings_created: 1,
      holdings_updated: 0,
    });
  });

  it('reuses an existing holding matched by symbol', async () => {
    repo.listActiveHoldingsMinimal.mockResolvedValue({
      data: [{ id: 'existing-1', name: 'Infosys Ltd', symbol: 'INFY', identifier: null }],
      error: null,
    });

    const result = await service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] });

    expect(repo.createHolding).not.toHaveBeenCalled();
    expect((result.body as any).stock).toMatchObject({
      holdings_created: 0,
      holdings_updated: 1,
    });
    expect(repo.upsertHoldingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ holding_id: 'existing-1' })
    );
  });

  it('falls back to matching on identifier when the symbol differs', async () => {
    repo.listActiveHoldingsMinimal.mockResolvedValue({
      data: [{ id: 'existing-2', name: 'X', symbol: 'OTHER', identifier: 'INE009A01021' }],
      error: null,
    });

    await service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] });

    expect(repo.createHolding).not.toHaveBeenCalled();
    expect(repo.upsertHoldingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ holding_id: 'existing-2' })
    );
  });

  it('falls back to matching on name, case-insensitively', async () => {
    repo.listActiveHoldingsMinimal.mockResolvedValue({
      data: [{ id: 'existing-3', name: 'infosys', symbol: null, identifier: null }],
      error: null,
    });

    await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row({ symbol: null, identifier: null })],
    });

    expect(repo.createHolding).not.toHaveBeenCalled();
    expect(repo.upsertHoldingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ holding_id: 'existing-3' })
    );
  });

  it('derives an identifier from the name when the file has none', async () => {
    await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row({ identifier: null, name: 'Parag Parikh Flexi Cap!' })],
    });
    expect(repo.createHolding).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'parag_parikh_flexi_cap' })
    );
  });

  it('skips rows with no name or an unparseable amount', async () => {
    await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [
        row(),
        row({ name: '   ', symbol: 'A' }),
        row({ name: 'BAD', symbol: 'B', amount: 'x' as unknown as number }),
      ],
    });
    expect(repo.upsertHoldingSnapshot).toHaveBeenCalledTimes(1);
  });

  it('totals the account snapshot from the row amounts', async () => {
    await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row({ amount: 1000 }), row({ name: 'TCS', symbol: 'TCS', amount: 250.5 })],
    });
    expect(repo.upsertAccountSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: STOCK_ACCOUNT,
        snapshot_date: '2026-01-01',
        amount: 1250.5,
        units: null,
      })
    );
  });

  it('writes the holding snapshot against the derived date', async () => {
    await service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] });
    expect(repo.upsertHoldingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot_date: '2026-01-01',
        quantity: 10,
        unit_amount: 100,
        amount: 1000,
      })
    );
  });

  it('coerces a missing quantity to zero rather than writing NaN', async () => {
    await service.importCdsl({
      stock_account_id: STOCK_ACCOUNT,
      rows: [row({ quantity: undefined as unknown as number })],
    });
    expect(repo.upsertHoldingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 0 })
    );
  });
});

describe('importCdsl — write failures', () => {
  it('fails loudly when an insert returns no id', async () => {
    // Silently continuing would attach the snapshot to nothing.
    repo.createHolding.mockResolvedValue({ data: null, error: null });
    await expect(
      service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] })
    ).rejects.toThrow('no id was returned');
  });

  it('surfaces a holding insert error naming the row', async () => {
    repo.createHolding.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(
      service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] })
    ).rejects.toThrow('Failed to create holding for row "INFOSYS": permission denied');
  });

  it('surfaces a snapshot write error', async () => {
    repo.upsertHoldingSnapshot.mockResolvedValue({ error: { message: 'conflict' } });
    await expect(
      service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] })
    ).rejects.toThrow('Failed to save snapshot for "INFOSYS": conflict');
  });

  it('surfaces an account snapshot failure', async () => {
    repo.upsertAccountSnapshot.mockResolvedValue({ error: { message: 'boom' } });
    await expect(
      service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] })
    ).rejects.toThrow('Failed to update account snapshot');
  });

  it('surfaces a holdings-load failure', async () => {
    repo.listActiveHoldingsMinimal.mockResolvedValue({ data: null, error: { message: 'down' } });
    await expect(
      service.importCdsl({ stock_account_id: STOCK_ACCOUNT, rows: [row()] })
    ).rejects.toThrow('Failed to load account holdings');
  });
});
