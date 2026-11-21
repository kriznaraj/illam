import type { SupabaseClient } from '@supabase/supabase-js';

export class GoldRegisterRepository {
  constructor(private supabase: SupabaseClient) {}

  async listAll() {
    return await this.supabase.from('gold_register').select('*').order('created_at', { ascending: true });
  }

  async insert(row: Record<string, unknown>) {
    return await this.supabase.from('gold_register').insert(row).select().single();
  }

  async update(id: string, row: Record<string, unknown>) {
    return await this.supabase.from('gold_register').update(row).eq('id', id).select().single();
  }

  async delete(id: string) {
    return await this.supabase.from('gold_register').delete().eq('id', id);
  }

  async listPhysicalWeights() {
    return await this.supabase.from('gold_register').select('gold_weight').eq('item_type', 'physical');
  }
}

