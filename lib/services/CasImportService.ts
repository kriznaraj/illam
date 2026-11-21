import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioCdslImportService, type ImportRow } from './PortfolioCdslImportService';
import { PortfolioAccountRepository } from '@/lib/repositories/PortfolioAccountRepository';
import { casAccounts, type CasAccounts } from '@/lib/household';
import { splitFoliosByFund, type FundList } from '@/lib/statements/casFolioSplit';
import type { ParsedCdslCas } from '@/lib/statements/cdslCas';
import { deriveSnapshotDate } from '@/lib/utils';
import type { InboxOwner } from '@/types';

export type CasApplyOutcome =
  | { status: 'applied'; snapshotDate: string; dematTotal: number; folioTotal: number; holdingsCreated: number }
  /** Demat applied; folios held back because some matched no account's fund list (or several). */
  | { status: 'partial'; snapshotDate: string; dematTotal: number; holdingsCreated: number; unassignedFolios: string[] }
  | { status: 'not_reconciled' }
  | { status: 'no_accounts' }
  | { status: 'failed'; message: string };

type ImportBody = Parameters<PortfolioCdslImportService['importCdsl']>[0];

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * Rows for PortfolioCdslImportService — the importer behind the manual CDSL upload,
 * so an emailed statement and an uploaded one write identically. A fund held in two
 * folios (or a security in two demat accounts) is one Selvam holding: its units and
 * value are summed, or the second row would overwrite the first's snapshot while the
 * account total counted both.
 */
export function casImportRows(parsed: ParsedCdslCas): ImportRow[] {
  const rows = new Map<string, ImportRow>();
  const add = (accountType: 'stock' | 'mf', isin: string, name: string, quantity: number, price: number, value: number) => {
    const existing = rows.get(`${accountType}:${isin}`);
    if (existing) {
      existing.quantity = round(existing.quantity + quantity, 4);
      existing.amount = round(existing.amount + value, 2);
      existing.unit_amount = price;
      return;
    }
    rows.set(`${accountType}:${isin}`, {
      name,
      identifier: isin,
      quantity,
      unit_amount: price,
      amount: value,
      date: parsed.asOn,
      account_type: accountType,
    });
  };
  for (const h of parsed.demat) add('stock', h.isin, h.name, h.quantity, h.price, h.value);
  for (const f of parsed.folios) add('mf', f.isin, f.name, f.units, f.nav, f.value);
  return Array.from(rows.values());
}

/**
 * Applies an emailed CDSL CAS to its owner's Selvam accounts (the member's `cas`
 * mapping in ILLAM_HOUSEHOLD). The CAS replaces that month's values: it is exact, where hand-entered monthly totals are rounded. Only a statement whose every
 * section reconciles with its own totals is applied; anything short of that could
 * silently drop a holding from the month. For the same reason, folios split across
 * accounts by fund name are applied only when every one of them found its account.
 */
export class CasImportService extends BaseService {
  private importer: PortfolioCdslImportService;
  private accounts: PortfolioAccountRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.importer = new PortfolioCdslImportService(supabase);
    this.accounts = new PortfolioAccountRepository(supabase);
  }

  async apply(
    owner: InboxOwner,
    parsed: ParsedCdslCas,
    accounts: CasAccounts | undefined = casAccounts(owner)
  ): Promise<CasApplyOutcome> {
    if (!accounts) return { status: 'no_accounts' };

    const rows = casImportRows(parsed);
    if (!parsed.asOn || !parsed.reconciled.demat || !parsed.reconciled.folios || rows.length === 0) {
      return { status: 'not_reconciled' };
    }

    if ('folios' in accounts) {
      const result = await this.runImport({ stock_account_id: accounts.demat, mf_account_id: accounts.folios, rows });
      if (!result.ok) return { status: 'failed', message: result.message };
      return {
        status: 'applied',
        snapshotDate: result.body.snapshot_date,
        dematTotal: round(Number(result.body.stock?.account_total ?? 0), 2),
        folioTotal: round(Number(result.body.mf?.account_total ?? 0), 2),
        holdingsCreated: Number(result.body.stock?.holdings_created ?? 0) + Number(result.body.mf?.holdings_created ?? 0),
      };
    }

    let snapshotDate = deriveSnapshotDate(parsed.asOn) ?? '';
    let dematTotal = 0;
    let holdingsCreated = 0;

    const stockRows = rows.filter((row) => row.account_type === 'stock');
    if (stockRows.length > 0) {
      const result = await this.runImport({ stock_account_id: accounts.demat, rows: stockRows });
      if (!result.ok) return { status: 'failed', message: result.message };
      snapshotDate = result.body.snapshot_date;
      dematTotal = round(Number(result.body.stock?.account_total ?? 0), 2);
      holdingsCreated += Number(result.body.stock?.holdings_created ?? 0);
    }

    const split = splitFoliosByFund(parsed.folios, await this.fundLists(accounts.folioAccounts));
    if (split.unassigned.length > 0) {
      return { status: 'partial', snapshotDate, dematTotal, holdingsCreated, unassignedFolios: split.unassigned };
    }

    let folioTotal = 0;
    for (const [accountId, folios] of Array.from(split.byAccount.entries())) {
      const result = await this.runImport({ mf_account_id: accountId, rows: casImportRows({ ...parsed, demat: [], folios }) });
      if (!result.ok) return { status: 'failed', message: result.message };
      folioTotal += Number(result.body.mf?.account_total ?? 0);
      holdingsCreated += Number(result.body.mf?.holdings_created ?? 0);
    }

    return { status: 'applied', snapshotDate, dematTotal, folioTotal: round(folioTotal, 2), holdingsCreated };
  }

  private async fundLists(accountIds: readonly string[]): Promise<FundList[]> {
    const accounts = await Promise.all(accountIds.map((id) => this.accounts.findById(id)));
    return accountIds.map((accountId, index) => {
      const funds = (accounts[index]?.details as { funds?: { name?: string }[] } | undefined)?.funds ?? [];
      return { accountId, funds: funds.map((fund) => fund.name ?? '').filter((name) => name.length > 0) };
    });
  }

  private async runImport(body: ImportBody) {
    const result = await this.importer.importCdsl(body);
    if (!result || result.status !== 200) {
      const error = result && 'error' in result.body ? result.body.error : 'import failed';
      return { ok: false as const, message: String(error) };
    }
    return { ok: true as const, body: result.body };
  }
}
