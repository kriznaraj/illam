import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { StatementTransaction } from '@/types';

export type StatementTransactionWrite = Omit<StatementTransaction, 'id' | 'created_at' | 'updated_at'>;

/** Card statement lines and their reconciliation (migration 032). */
export class StatementTransactionRepository extends BaseRepository<StatementTransaction> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'statement_transactions');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async listForStatement(statementId: string): Promise<StatementTransaction[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase.from(this.tableName).select('*').eq('statement_id', statementId).order('line_no');
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (error) throw new Error(`Failed to load statement lines: ${error.message}`);
    return (data ?? []) as unknown as StatementTransaction[];
  }

  async listForStatements(statementIds: string[]): Promise<StatementTransaction[]> {
    if (statementIds.length === 0) return [];
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('*')
        .in('statement_id', statementIds)
        .order('line_no');
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (error) throw new Error(`Failed to load statement lines: ${error.message}`);
    return (data ?? []) as unknown as StatementTransaction[];
  }

  /** Expenses already accounted for by some statement line in a date range — one expense, one line. */
  async listExpenseIdsBetween(startDate: string, endDate: string): Promise<Set<string>> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('expense_id')
        .gte('txn_date', startDate)
        .lte('txn_date', endDate)
        .not('expense_id', 'is', null);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (error) throw new Error(`Failed to load reconciled expenses: ${error.message}`);
    return new Set(((data ?? []) as { expense_id: string }[]).map((row) => row.expense_id));
  }

  /** Every line settled on one expense now settles on another — a duplicate merged into it. */
  async repointExpense(fromExpenseId: string, toExpenseId: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .update({ expense_id: toExpenseId, status: 'matched' })
      .eq('expense_id', fromExpenseId);
    if (error) throw new Error(`Failed to move statement lines: ${error.message}`);
  }

  /** Lines whose added expense someone said was not spending stay settled, as ignored. */
  async ignoreExpense(expenseId: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .update({ expense_id: null, status: 'ignored' })
      .eq('expense_id', expenseId);
    if (error) throw new Error(`Failed to ignore statement lines: ${error.message}`);
  }

  /** Idempotent on (statement_id, line_no), so safe to retry. */
  async upsertMany(rows: StatementTransactionWrite[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.withRetry(async () => {
      const res = await this.supabase.from(this.tableName).upsert(rows, { onConflict: 'statement_id,line_no' });
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (error) throw new Error(`Failed to save statement lines: ${error.message}`);
  }
}
