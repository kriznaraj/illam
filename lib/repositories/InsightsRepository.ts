import type { SupabaseClient } from '@supabase/supabase-js';

export class InsightsRepository {
  constructor(private supabase: SupabaseClient) {}

  async getCachedInsights(analysisMonthKey: string) {
    return await this.supabase
      .from('insights_cache')
      .select('insights, summary, generated_at')
      .eq('analysis_month', analysisMonthKey)
      .maybeSingle();
  }

  /**
   * NOTE: the engine that produced the insights ('ai' | 'rules') is stored inside the
   * `summary` JSONB, NOT in the `generated_by` column. `generated_by` is a UUID column
   * that already holds *user* ids on historical rows — writing 'rules' into it fails with
   * `invalid input syntax for type uuid`, and because this upsert's error is non-fatal it
   * failed silently and disabled insight caching entirely. Keeping the engine in `summary`
   * avoids that collision and needs no schema change.
   */
  async upsertCachedInsights(params: {
    analysisMonth: string;
    insights: unknown;
    summary: unknown;
    generatedAt: string;
  }) {
    return await this.supabase.from('insights_cache').upsert(
      {
        analysis_month: params.analysisMonth,
        insights: params.insights,
        summary: params.summary,
        generated_at: params.generatedAt,
      },
      { onConflict: 'analysis_month' }
    );
  }

  /**
   * Every expense in the window, auto-added ones included: leaving out unconfirmed ones
   * would make a month whose review queue was never worked read as a cheap month.
   */
  async listExpensesWithCategory(startDate: string, endDate: string) {
    return await this.supabase
      .from('expenses')
      .select('*, category:categories(*)')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
  }

  async clearCache(month?: string) {
    let query = this.supabase.from('insights_cache').delete();
    if (month) {
      query = query.eq('analysis_month', month);
    } else {
      query = query.neq('analysis_month', '');
    }
    return await query;
  }
}

