import type { SupabaseClient } from '@supabase/supabase-js';

export class AppConfigRepository {
  constructor(private supabase: SupabaseClient) {}

  async getKeys(keys: string[]) {
    return await this.supabase.from('app_config').select('key, value').in('key', keys);
  }

  async upsertKeyValues(upserts: Array<{ key: string; value: string; updated_at: string }>) {
    return await this.supabase.from('app_config').upsert(upserts, { onConflict: 'key' });
  }
}

