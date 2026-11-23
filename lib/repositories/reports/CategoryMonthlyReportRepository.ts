import type { SupabaseClient } from '@supabase/supabase-js';

export class CategoryMonthlyReportRepository {
  constructor(private supabase: SupabaseClient) {}

  async listExpenses(startDate: string, endDate: string) {
    return await this.supabase
      .from('expenses')
      .select(
        `
        date,
        amount,
        category_id,
        user_id,
        categories!inner(id, name, group_name, color)
      `
      )
      .gte('date', startDate)
      .lte('date', endDate)
      // Auto-added rows count too; rejecting one deletes it.
      .order('date', { ascending: true });
  }

  async listCategories() {
    return await this.supabase
      .from('categories')
      .select('*')
      .order('group_name', { ascending: true })
      .order('sort_order', { ascending: true });
  }
}

