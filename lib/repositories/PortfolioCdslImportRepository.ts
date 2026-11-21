import type { SupabaseClient } from '@supabase/supabase-js';

export type MinimalHolding = { id: string; name: string | null; symbol: string | null; identifier: string | null };

export class PortfolioCdslImportRepository {
  constructor(private supabase: SupabaseClient) {}

  async verifyAccount(accountId: string) {
    return await this.supabase.from('portfolio_accounts').select('id').eq('id', accountId).single();
  }

  async listActiveHoldingsMinimal(accountId: string) {
    return await this.supabase
      .from('portfolio_holdings')
      .select('id, name, symbol, identifier')
      .eq('account_id', accountId)
      .eq('is_active', true);
  }

  async createHolding(row: {
    account_id: string;
    name: string;
    symbol: string | null;
    identifier: string;
    instrument_type: string;
    quantity_unit: string;
    sort_order: number;
    is_active: boolean;
  }) {
    return await this.supabase.from('portfolio_holdings').insert(row).select('id').single();
  }

  async upsertHoldingSnapshot(row: {
    holding_id: string;
    snapshot_date: string;
    quantity: number;
    unit_amount: number | null;
    amount: number;
  }) {
    return await this.supabase
      .from('portfolio_holding_snapshots')
      .upsert(row, { onConflict: 'holding_id,snapshot_date' });
  }

  async upsertAccountSnapshot(row: { account_id: string; snapshot_date: string; amount: number; units: null }) {
    return await this.supabase.from('portfolio_snapshots').upsert(row, { onConflict: 'account_id,snapshot_date' });
  }
}

