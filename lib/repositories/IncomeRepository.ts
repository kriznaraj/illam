import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { Income, IncomeWithUser } from '@/types';

/** The relation graph every read returns, so the UI never has to fetch the user separately. */
const WITH_USER = '*, user:users(*)';

/**
 * Income. Deliberately thin: income has no tags, no events and no
 * denormalised monthly rollup, so it needs none of the machinery ExpenseRepository grew.
 */
export class IncomeRepository extends BaseRepository<Income> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'income');
  }

  protected getSelectQuery(): string {
    return WITH_USER;
  }

  async findByDateRange(startDate: string, endDate: string): Promise<IncomeWithUser[]> {
    return this.withRetry(async () => {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select(WITH_USER)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      if (error) throw new Error(`Failed to fetch income: ${error.message}`);
      return (data ?? []) as unknown as IncomeWithUser[];
    });
  }

  /**
   * The row an alert already produced. Read before inserting so a retried automation run —
   * or the second Gmail account syncing the same mail — records the existing row instead of
   * relying on the unique index to reject a duplicate.
   */
  async findByInboxItem(inboxItemId: string): Promise<Income | null> {
    return this.withRetry(async () => {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('inbox_item_id', inboxItemId)
        .maybeSingle();

      if (error) throw new Error(`Failed to look up income by alert: ${error.message}`);
      return (data as unknown as Income) ?? null;
    });
  }

  /** Which of these statement lines already became income. */
  async findStatementRefs(refs: readonly string[]): Promise<Set<string>> {
    if (refs.length === 0) return new Set();
    return this.withRetry(async () => {
      const { data, error } = await this.supabase.from(this.tableName).select('statement_ref').in('statement_ref', [...refs]);
      if (error) throw new Error(`Failed to look up statement income: ${error.message}`);
      return new Set(((data ?? []) as { statement_ref: string | null }[]).map((row) => row.statement_ref).filter((ref): ref is string => !!ref));
    });
  }
}
