import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { TransactionRule } from '@/types';

export class TransactionRuleRepository extends BaseRepository<TransactionRule> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'transaction_rules');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  /** Newest first, so a more recent decision about the same payee wins. */
  async listNewestFirst(): Promise<TransactionRule[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .order('created_at', { ascending: false });
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch transaction rules: ${error.message}`);
    }
    return (data ?? []) as unknown as TransactionRule[];
  }
}
