import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { PortfolioAccountType } from '@/types';
import { liabilityTypeNames } from '@/lib/portfolio/liabilities';

export class PortfolioAccountTypeRepository extends BaseRepository<PortfolioAccountType> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'portfolio_account_types');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async findAllSorted(): Promise<PortfolioAccountType[]> {
    const { data, error } = await this.supabase.from(this.tableName).select('*').order('name', { ascending: true });
    if (error) throw new Error(`Failed to fetch account types: ${error.message}`);
    return (data as unknown as PortfolioAccountType[]) || [];
  }

  /** Names of the account types that represent money owed (see `liabilityTypeNames`). */
  async findLiabilityTypeNames(): Promise<Set<string>> {
    const { data, error } = await this.supabase.from(this.tableName).select('*');
    if (error) throw new Error(`Failed to fetch account types: ${error.message}`);
    return liabilityTypeNames((data as unknown as PortfolioAccountType[]) || null);
  }

  async isTypeInUse(typeName: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('portfolio_accounts')
      .select('id')
      .eq('type', typeName)
      .limit(1);

    if (error) throw new Error(`Failed to check account type usage: ${error.message}`);
    return !!(data && data.length > 0);
  }
}

