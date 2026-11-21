import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedCdslCas } from '@/lib/statements/cdslCas';

const importer = vi.hoisted(() => ({ importCdsl: vi.fn() }));
const accounts = vi.hoisted(() => ({ findById: vi.fn() }));

vi.mock('../PortfolioCdslImportService', () => ({
  PortfolioCdslImportService: class {
    constructor() {
      return importer as any;
    }
  },
}));
vi.mock('@/lib/repositories/PortfolioAccountRepository', () => ({
  PortfolioAccountRepository: class {
    constructor() {
      return accounts as any;
    }
  },
}));

import { CasImportService, casImportRows } from '../CasImportService';
import { casAccounts } from '@/lib/household';

const parsed = (over: Partial<ParsedCdslCas> = {}): ParsedCdslCas => ({
  asOn: '2026-06-30',
  demat: [{ isin: 'INE000A01011', name: 'TEST MOTORS LIMITED - EQUITY SHARES', quantity: 6, price: 10842.35, value: 65054.1 }],
  folios: [
    { isin: 'INF000K01BI1', name: 'EBD1 - Test Large and Midcap Fund', units: 239.483, nav: 188.282, invested: 36000, value: 45090.34 },
    { isin: 'INF000K01BI1', name: 'EBD1 - Test Large and Midcap Fund', units: 1660.987, nav: 188.282, invested: 260000, value: 312733.95 },
  ],
  summary: { demat: 65054.1, equity: 65054.1, mfFolios: 357824.29, mfDemat: 0, others: 0, total: 422878.39 },
  unreadRows: 0,
  reconciled: { demat: true, folios: true },
  ...over,
});

const body = (over: Record<string, unknown>) => ({ status: 200, body: { ok: true, snapshot_date: '2026-07-01', stock: null, mf: null, ...over } });

let service: CasImportService;

beforeEach(() => {
  vi.clearAllMocks();
  importer.importCdsl.mockReset();
  importer.importCdsl.mockResolvedValue(
    body({
      rows_processed: 2,
      skipped_rows: 0,
      stock: { account_id: 'demat', rows_processed: 1, holdings_created: 0, holdings_updated: 1, account_total: 65054.1 },
      mf: { account_id: 'folios', rows_processed: 1, holdings_created: 1, holdings_updated: 0, account_total: 357824.29 },
    })
  );
  service = new CasImportService({} as any);
});

describe('casImportRows', () => {
  it('makes one holding of a fund held in two folios', () => {
    expect(casImportRows(parsed())).toEqual([
      { name: 'TEST MOTORS LIMITED - EQUITY SHARES', identifier: 'INE000A01011', quantity: 6, unit_amount: 10842.35, amount: 65054.1, date: '2026-06-30', account_type: 'stock' },
      { name: 'EBD1 - Test Large and Midcap Fund', identifier: 'INF000K01BI1', quantity: 1900.470, unit_amount: 188.282, amount: 357824.29, date: '2026-06-30', account_type: 'mf' },
    ]);
  });
});

describe('casAccounts', () => {
  it("reads Bob's CAS mapping from the household config", () => {
    expect(casAccounts('bob')).toEqual({ demat: '00000000-0000-4000-8000-000000000007', folios: '00000000-0000-4000-8000-000000000008' });
  });
});

describe('CasImportService.apply — one folio account (Alice)', () => {
  const alice = casAccounts('alice') as { demat: string; folios: string };

  it('imports the demat and folio sections through the manual importer', async () => {
    const outcome = await service.apply('alice', parsed());

    expect(importer.importCdsl).toHaveBeenCalledWith({ stock_account_id: alice.demat, mf_account_id: alice.folios, rows: casImportRows(parsed()) });
    expect(outcome).toEqual({ status: 'applied', snapshotDate: '2026-07-01', dematTotal: 65054.1, folioTotal: 357824.29, holdingsCreated: 1 });
  });

  // A section that does not add up could be missing a holding; applying it would drop that holding from the month.
  it('applies nothing from a statement that does not reconcile', async () => {
    expect(await service.apply('alice', parsed({ reconciled: { demat: true, folios: false } }))).toEqual({ status: 'not_reconciled' });
    expect(importer.importCdsl).not.toHaveBeenCalled();
  });

  it('reports an import the importer refused', async () => {
    importer.importCdsl.mockResolvedValue({ status: 404, body: { error: 'MF account not found' } });
    expect(await service.apply('alice', parsed())).toEqual({ status: 'failed', message: 'MF account not found' });
  });
});

describe('CasImportService.apply — folios split by fund', () => {
  const bob = { demat: 'demat-account', folioAccounts: ['grow-account', 'etmoney-account'] };
  const [grow, etMoney] = bob.folioAccounts;
  const folio = (isin: string, name: string, value: number) => ({ isin, name, units: 10, nav: value / 10, invested: value, value });
  const bobCas = (extra: ReturnType<typeof folio>[] = []) =>
    parsed({
      folios: [
        folio('INF879O01027', 'PPFAS - Parag Parikh Flexi Cap Fund - Direct Plan Growth', 1000),
        folio('INF769K01BI1', 'EBD1 - Mirae Asset Large and Midcap Fund - Direct Plan', 2000),
        folio('INF109K01Z48', 'P8098 - ICICI Prudential Technology Fund - Direct Plan - Growth', 500),
        ...extra,
      ],
    });

  beforeEach(() => {
    accounts.findById.mockImplementation(async (id: string) => ({
      id,
      details: {
        funds:
          id === grow
            ? [{ name: 'ICICI Quant Fund' }, { name: 'Parag Parikh Flexi Cap' }]
            : [{ name: 'Mirae Large & Midcap Fund' }, { name: 'ICICI Prudential Tech Fund' }],
      },
    }));
    importer.importCdsl
      .mockReset()
      .mockResolvedValueOnce(body({ stock: { account_total: 65054.1, holdings_created: 0 } }))
      .mockResolvedValueOnce(body({ mf: { account_total: 1000, holdings_created: 0 } }))
      .mockResolvedValueOnce(body({ mf: { account_total: 2500, holdings_created: 1 } }));
  });

  it('imports the demat, then each MF account with only the folios its fund list names', async () => {
    const outcome = await service.apply('bob', bobCas(), bob);

    const calls = importer.importCdsl.mock.calls.map(([arg]) => ({
      stock: arg.stock_account_id,
      mf: arg.mf_account_id,
      rows: arg.rows.map((r: { identifier: string }) => r.identifier),
    }));
    expect(calls).toEqual([
      { stock: bob.demat, mf: undefined, rows: ['INE000A01011'] },
      { stock: undefined, mf: grow, rows: ['INF879O01027'] },
      { stock: undefined, mf: etMoney, rows: ['INF769K01BI1', 'INF109K01Z48'] },
    ]);
    expect(outcome).toEqual({ status: 'applied', snapshotDate: '2026-07-01', dematTotal: 65054.1, folioTotal: 3500, holdingsCreated: 1 });
  });

  // Replacing an account's month with only some of its funds would understate it.
  it('holds every folio back when one matches no fund list, but still applies the demat', async () => {
    const outcome = await service.apply('bob', bobCas([folio('INF179K01BB8', 'HDFC - HDFC Balanced Advantage Fund', 300)]), bob);

    expect(importer.importCdsl).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      status: 'partial',
      snapshotDate: '2026-07-01',
      dematTotal: 65054.1,
      holdingsCreated: 0,
      unassignedFolios: ['HDFC - HDFC Balanced Advantage Fund'],
    });
  });
});
