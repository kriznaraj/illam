import type { SupabaseClient } from '@supabase/supabase-js';

export class EventReportRepository {
  constructor(private supabase: SupabaseClient) {}

  async getEvent(eventId: string) {
    return await this.supabase.from('expense_events').select('*').eq('id', eventId).single();
  }

  async listExpenses(eventId: string) {
    return await this.supabase
      .from('expenses')
      .select(
        `
        *,
        category:categories(*)
      `
      )
      .eq('event_id', eventId)
      // Auto-added rows count too; rejecting one deletes it.
      .order('date', { ascending: false });
  }

  async listUsersByIds(userIds: string[]) {
    return await this.supabase.from('users').select('id, full_name').in('id', userIds);
  }
}

