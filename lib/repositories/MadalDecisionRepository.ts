import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, isTableMissing } from './BaseRepository';
import type { MadalDecision } from '@/types';

export type MadalDecisionWrite = Omit<MadalDecision, 'id' | 'created_at' | 'undone_at'>;

/**
 * What Madal decided on its own (migration 039). Reads degrade to "nothing decided" while the
 * table is missing; a write fails loudly, because a decision without its undo record must not
 * happen at all.
 */
export class MadalDecisionRepository extends BaseRepository<MadalDecision> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'madal_decisions');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async record(row: MadalDecisionWrite): Promise<MadalDecision> {
    return this.create(row);
  }

  /** Every decision on these alerts, newest first. */
  async listForItems(inboxItemIds: readonly string[]): Promise<MadalDecision[]> {
    if (inboxItemIds.length === 0) return [];
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('*')
        .in('inbox_item_id', inboxItemIds as string[])
        .order('created_at', { ascending: false });
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(`Failed to fetch Madal decisions: ${error.message}`);
    }
    return (data ?? []) as unknown as MadalDecision[];
  }

  /** The evidence keys already decided (or suggested) for these transfers or expenses. */
  async decidedKeys(column: 'transfer_id' | 'expense_id', ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(`${column}, evidence_key`)
      .in(column, ids as string[]);
    if (error) {
      // No table, no history: but then nothing may be decided either — the caller's write fails.
      if (isTableMissing(error)) return new Set();
      throw new Error(`Failed to fetch Madal decisions: ${error.message}`);
    }
    return new Set(
      ((data ?? []) as Record<string, string | null>[]).map((row) => `${row[column]}|${row.evidence_key ?? ''}`)
    );
  }

  async markUndone(id: string, at: string): Promise<void> {
    await this.update(id, { undone_at: at });
  }
}
