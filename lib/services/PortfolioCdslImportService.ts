import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioCdslImportRepository, type MinimalHolding } from '@/lib/repositories/PortfolioCdslImportRepository';
import { deriveSnapshotDate } from '@/lib/utils';

/** Row from CSV after column mapping */
export interface ImportRow {
  name: string;
  symbol?: string | null;
  identifier?: string | null;
  quantity: number;
  unit_amount?: number | null;
  amount: number;
  /** Report period from CSV, e.g. "Dec 2025" or "2025-12-01". Snapshot date = 1st of next month. */
  date?: string | null;
  /** "stock" | "mf" — which account this row belongs to */
  account_type?: string | null;
}

export class PortfolioCdslImportService extends BaseService {
  private repo: PortfolioCdslImportRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new PortfolioCdslImportRepository(supabase);
  }

  private buildHoldingsKeyMap(existingHoldings: MinimalHolding[]) {
    const holdingsByKey = new Map<string, { id: string }>();
    (existingHoldings ?? []).forEach((h) => {
      const sym = (h.symbol ?? '').trim().toLowerCase();
      const identifier = (h.identifier ?? '').trim().toLowerCase();
      const name = (h.name ?? '').trim().toLowerCase();
      if (sym) holdingsByKey.set(`s:${sym}`, { id: h.id });
      if (identifier) holdingsByKey.set(`i:${identifier}`, { id: h.id });
      if (name) holdingsByKey.set(`n:${name}`, { id: h.id });
    });
    return holdingsByKey;
  }

  private async processRows(params: {
    accountId: string;
    snapshotDate: string;
    rows: ImportRow[];
    defaultInstrumentType: string;
    defaultQuantityUnit: string;
  }) {
    const { accountId, snapshotDate, rows, defaultInstrumentType, defaultQuantityUnit } = params;

    const { data: existingHoldings, error: holdingsError } = await this.repo.listActiveHoldingsMinimal(accountId);
    if (holdingsError) throw new Error('Failed to load account holdings');

    const holdingsByKey = this.buildHoldingsKeyMap((existingHoldings ?? []) as MinimalHolding[]);

    let accountTotal = 0;
    const created: string[] = [];
    const updated: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row?.name ?? '').trim();
      const symbol = row?.symbol != null ? String(row.symbol).trim() || null : null;
      const rawIdentifier = row?.identifier != null ? String(row.identifier).trim() : '';
      const identifier = rawIdentifier || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const quantity = Number(row?.quantity);
      const unit_amount = row?.unit_amount != null ? Number(row.unit_amount) : null;
      const amount = Number(row?.amount);

      if (!name || Number.isNaN(amount)) continue;

      const symKey = symbol ? `s:${symbol.toLowerCase()}` : null;
      const identifierKey = identifier ? `i:${identifier.toLowerCase()}` : null;
      const nameKey = name ? `n:${name.toLowerCase()}` : null;

      let holdingId: string | null =
        (symKey && holdingsByKey.get(symKey)?.id) ??
        (identifierKey && holdingsByKey.get(identifierKey)?.id) ??
        (nameKey && holdingsByKey.get(nameKey)?.id) ??
        null;

      if (!holdingId) {
        const { data: newHolding, error: insertErr } = await this.repo.createHolding({
          account_id: accountId,
          name,
          symbol: symbol || null,
          identifier,
          instrument_type: defaultInstrumentType,
          quantity_unit: defaultQuantityUnit,
          sort_order: (existingHoldings?.length ?? 0) + i,
          is_active: true,
        });

        if (insertErr) throw new Error(`Failed to create holding for row "${name}": ${insertErr.message}`);

        // The insert can succeed without returning a row (e.g. no RETURNING clause), which
        // would leave holdingId null and silently attach the snapshot to nothing. Fail loudly
        // instead — and this narrows the type for every use below.
        const newId = (newHolding as { id?: string } | null)?.id;
        if (!newId) throw new Error(`Holding was created for "${name}" but no id was returned`);
        holdingId = newId;
        created.push(name);

        if (symbol) holdingsByKey.set(`s:${symbol.toLowerCase()}`, { id: holdingId });
        if (identifier) holdingsByKey.set(`i:${identifier.toLowerCase()}`, { id: holdingId });
        holdingsByKey.set(`n:${name.toLowerCase()}`, { id: holdingId });
      } else {
        updated.push(name);
      }

      const { error: snapErr } = await this.repo.upsertHoldingSnapshot({
        holding_id: holdingId,
        snapshot_date: snapshotDate,
        quantity: Number.isNaN(quantity) ? 0 : quantity,
        unit_amount: unit_amount != null && !Number.isNaN(unit_amount) ? unit_amount : null,
        amount: Number.isNaN(amount) ? 0 : amount,
      });

      if (snapErr) throw new Error(`Failed to save snapshot for "${name}": ${snapErr.message}`);
      accountTotal += Number.isNaN(amount) ? 0 : amount;
    }

    const { error: accountSnapErr } = await this.repo.upsertAccountSnapshot({
      account_id: accountId,
      snapshot_date: snapshotDate,
      amount: accountTotal,
      units: null,
    });

    if (accountSnapErr) throw new Error('Failed to update account snapshot');
    return { created, updated, accountTotal };
  }

  async importCdsl(body: {
    stock_account_id?: string;
    mf_account_id?: string;
    rows: ImportRow[];
  }) {
    try {
      const { stock_account_id, mf_account_id, rows } = body ?? ({} as any);
      if (!Array.isArray(rows) || rows.length === 0) {
        return { status: 400 as const, body: { error: 'rows must be a non-empty array' } };
      }

      const firstDateStr = rows.find((r) => r.date)?.date ?? '';
      const snapshotDate = deriveSnapshotDate(firstDateStr ?? '');
      if (!snapshotDate) {
        return {
          status: 400 as const,
          body: { error: 'Could not determine snapshot date from the "date" column. Use format like "Dec 2025".' },
        };
      }

      const stockRows = rows.filter((r) => (r.account_type ?? '').toLowerCase() === 'stock');
      const mfRows = rows.filter((r) => (r.account_type ?? '').toLowerCase() === 'mf');
      const unknownRows = rows.filter((r) => !['stock', 'mf'].includes((r.account_type ?? '').toLowerCase()));

      if (unknownRows.length > 0 && stockRows.length === 0 && mfRows.length === 0) {
        return { status: 400 as const, body: { error: 'No rows with a recognised account_type (stock / mf) found.' } };
      }

      if (stockRows.length > 0 && !stock_account_id) {
        return { status: 400 as const, body: { error: 'stock_account_id is required because the CSV contains stock rows.' } };
      }
      if (mfRows.length > 0 && !mf_account_id) {
        return { status: 400 as const, body: { error: 'mf_account_id is required because the CSV contains mf rows.' } };
      }

      let stockResult: any = null;
      let mfResult: any = null;

      if (stockRows.length > 0 && stock_account_id) {
        const { data: acc, error: accErr } = await this.repo.verifyAccount(stock_account_id);
        if (accErr || !acc) return { status: 404 as const, body: { error: 'Stock account not found' } };
        stockResult = await this.processRows({
          accountId: stock_account_id,
          snapshotDate,
          rows: stockRows,
          defaultInstrumentType: 'nse_stock',
          defaultQuantityUnit: 'shares',
        });
      }

      if (mfRows.length > 0 && mf_account_id) {
        const { data: acc, error: accErr } = await this.repo.verifyAccount(mf_account_id);
        if (accErr || !acc) return { status: 404 as const, body: { error: 'MF account not found' } };
        mfResult = await this.processRows({
          accountId: mf_account_id,
          snapshotDate,
          rows: mfRows,
          defaultInstrumentType: 'mf_nav',
          defaultQuantityUnit: 'units',
        });
      }

      return {
        status: 200 as const,
        body: {
          ok: true,
          snapshot_date: snapshotDate,
          rows_processed: rows.length,
          skipped_rows: unknownRows.length,
          stock: stockResult
            ? {
                account_id: stock_account_id,
                rows_processed: stockRows.length,
                holdings_created: stockResult.created.length,
                holdings_updated: stockResult.updated.length,
                account_total: stockResult.accountTotal,
              }
            : null,
          mf: mfResult
            ? {
                account_id: mf_account_id,
                rows_processed: mfRows.length,
                holdings_created: mfResult.created.length,
                holdings_updated: mfResult.updated.length,
                account_total: mfResult.accountTotal,
              }
            : null,
        },
      };
    } catch (e) {
      this.handleError(e, 'import CDSL');
    }
  }
}

