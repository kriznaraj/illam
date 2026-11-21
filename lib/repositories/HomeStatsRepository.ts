import type { SupabaseClient } from '@supabase/supabase-js';

export class HomeStatsRepository {
  constructor(private supabase: SupabaseClient) {}

  async listMonthlyExpenses(startDate: string, endDate: string) {
    return await this.supabase
      .from('expenses')
      .select(
        'amount, category:categories(*), user:users(*), expense_tags(id, tag:tags(*)), id, date, description, category_id, user_id, event_id, receipt_url, created_at, updated_at'
      )
      .gte('date', startDate)
      .lte('date', endDate)
      // Every expense counts, auto-added ones included (migration 036): an alert that
      // reached Madal is money that already left the account. `needs_review` only marks
      // a row nobody has looked at; rejecting one deletes it, which is what removes it here.
      .order('date', { ascending: false });
  }

  async listRecentExpenses(limit: number) {
    return await this.supabase
      .from('expenses')
      .select('*, category:categories(*), user:users(*), expense_tags(id, tag:tags(*))')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
  }

  async latestSnapshotsPerAccount() {
    return await this.supabase.rpc('get_latest_snapshots_per_account');
  }

  async prevSnapshotsPerAccount() {
    return await this.supabase.rpc('get_prev_snapshots_per_account');
  }

  async listTodayOpenTodos(today: string, limit: number) {
    return await this.supabase
      .from('todos')
      .select('id, title, priority, status, due_date')
      .eq('due_date', today)
      .in('status', ['pending', 'in_progress'])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
  }
}

