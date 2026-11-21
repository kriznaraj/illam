import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { PortfolioAccount } from '@/types';

export class PortfolioAccountRepository extends BaseRepository<PortfolioAccount> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'portfolio_accounts');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async findSorted(includeArchived: boolean): Promise<PortfolioAccount[]> {
    let query = this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!includeArchived) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch portfolio accounts: ${error.message}`);
    return (data as unknown as PortfolioAccount[]) || [];
  }
}

