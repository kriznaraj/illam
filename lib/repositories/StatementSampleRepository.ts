import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { InboxOwner, StatementSample } from '@/types';

/** `created_at` is rewritten on every save, so a row shows when it was last refreshed. */
export type StatementSampleWrite = Omit<StatementSample, 'id' | 'created_at'> & { created_at?: string };

/** TEMPORARY (migration 031). */
export class StatementSampleRepository extends BaseRepository<StatementSample> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'statement_samples');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async countCaptured(source: string, owner: InboxOwner): Promise<number> {
    const { count, error } = await this.supabase
      .from(this.tableName)
      .select('id', { count: 'exact', head: true })
      .eq('source', source)
      .eq('owner', owner)
      .eq('status', 'captured');

    if (error) {
      throw new Error(`Failed to count statement samples: ${error.message}`);
    }
    return count ?? 0;
  }

  /** One row per attachment of an email; re-sending replaces it (e.g. locked → captured once a password is set). */
  async upsertSample(row: StatementSampleWrite): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .upsert(row, { onConflict: 'inbox_item_id,attachment_name' });

    if (error) {
      throw new Error(`Failed to save statement sample: ${error.message}`);
    }
  }
}
