import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortfolioHoldingSnapshot } from '@/types';

export class PortfolioHoldingSnapshotRepository {
  constructor(private supabase: SupabaseClient) {}

  async listHoldingIdsForAccount(accountId: string) {
    return await this.supabase
      .from('portfolio_holdings')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true);
  }

  async listSnapshots(filters: {
    holdingIds?: string[];
    holdingId?: string;
    snapshotDate?: string;
    startDate?: string;
    endDate?: string;
    limit: number;
  }) {
    let query = this.supabase
      .from('portfolio_holding_snapshots')
      .select('*, holding:portfolio_holdings(*, account:portfolio_accounts(*))')
      .order('snapshot_date', { ascending: false });

    if (filters.holdingIds) query = query.in('holding_id', filters.holdingIds);
    if (filters.holdingId) query = query.eq('holding_id', filters.holdingId);
    if (filters.snapshotDate) query = query.eq('snapshot_date', filters.snapshotDate);
    if (filters.startDate) query = query.gte('snapshot_date', filters.startDate);
    if (filters.endDate) query = query.lte('snapshot_date', filters.endDate);

    query = query.limit(Math.min(filters.limit, 50_000));
    return await query;
  }

  async upsertSnapshot(params: {
    holding_id: string;
    snapshot_date: string;
    quantity: number;
    unit_amount: number | null;
    amount: number;
  }) {
    return await this.supabase
      .from('portfolio_holding_snapshots')
      .upsert(
        {
          holding_id: params.holding_id,
          snapshot_date: params.snapshot_date,
          quantity: params.quantity,
          unit_amount: params.unit_amount,
          amount: params.amount,
        },
        { onConflict: 'holding_id,snapshot_date' }
      )
      .select('*, holding:portfolio_holdings(*, account:portfolio_accounts(*))')
      .single();
  }
}

