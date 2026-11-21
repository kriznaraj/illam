import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { PortfolioHolding } from '@/types';

export class PortfolioHoldingRepository extends BaseRepository<PortfolioHolding> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'portfolio_holdings');
  }

  protected getSelectQuery(): string {
    return '*, account:portfolio_accounts(*)';
  }

  async findSorted(filters: { accountId?: string; includeInactive: boolean }): Promise<PortfolioHolding[]> {
    let query = this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (filters.accountId) query = query.eq('account_id', filters.accountId);
    if (!filters.includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch portfolio holdings: ${error.message}`);
    return (data as unknown as PortfolioHolding[]) || [];
  }
}

