import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { PortfolioSnapshot } from '@/types';

export class PortfolioSnapshotRepository extends BaseRepository<PortfolioSnapshot> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'portfolio_snapshots');
  }

  protected getSelectQuery(): string {
    return `
      *,
      account:portfolio_accounts(*)
    `;
  }

  async findSorted(filters: { accountId?: string; startDate?: string; endDate?: string; limit: number }): Promise<PortfolioSnapshot[]> {
    const { data, error } = await this.withRetry(async () => {
      let query = this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .order('snapshot_date', { ascending: false });

      if (filters.accountId) query = query.eq('account_id', filters.accountId);
      if (filters.startDate) query = query.gte('snapshot_date', filters.startDate);
      if (filters.endDate) query = query.lte('snapshot_date', filters.endDate);

      query = query.limit(Math.min(filters.limit, 50_000));

      const res = await query;
      if (res.error && this.isTransientSupabaseError(res.error)) {
        throw res.error;
      }
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch portfolio snapshots: ${error.message}`);
    }

    return (data as unknown as PortfolioSnapshot[]) || [];
  }

  async upsertByAccountMonth(params: { account_id: string; snapshot_date: string; amount: number; units?: number | null }) {
    return await this.supabase
      .from(this.tableName)
      .upsert(
        {
          account_id: params.account_id,
          snapshot_date: params.snapshot_date,
          amount: params.amount,
          units: params.units ?? null,
        },
        { onConflict: 'account_id,snapshot_date' }
      )
      .select(this.getSelectQuery())
      .single();
  }

  async deleteByAccountMonth(params: { account_id: string; snapshot_date: string }) {
    return await this.supabase
      .from(this.tableName)
      .delete()
      .eq('account_id', params.account_id)
      .eq('snapshot_date', params.snapshot_date);
  }
}

