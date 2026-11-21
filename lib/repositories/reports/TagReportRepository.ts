import type { SupabaseClient } from '@supabase/supabase-js';

export class TagReportRepository {
  constructor(private supabase: SupabaseClient) {}

  async getTag(tagId: string) {
    return await this.supabase.from('tags').select('*').eq('id', tagId).single();
  }

  async listExpenseIdsForTag(tagId: string) {
    return await this.supabase.from('expense_tags').select('expense_id').eq('tag_id', tagId);
  }

  async listExpensesByIds(expenseIds: string[], startDate?: string, endDate?: string) {
    let query = this.supabase
      .from('expenses')
      .select(
        `
        *,
        category:categories(*),
        user:users(id, username, full_name, email),
        event:expense_events(*)
      `
      )
      .in('id', expenseIds)
      // Auto-added rows count too (migration 036); rejecting one deletes it.
      .order('date', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    return await query;
  }

  async listUsersByIds(userIds: string[]) {
    return await this.supabase.from('users').select('id, full_name').in('id', userIds);
  }
}

