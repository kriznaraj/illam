import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Invalidates global insights cache for a specific month
 * Call this when expenses are added, updated, or deleted
 */
export async function invalidateInsightsCache(
  supabase: SupabaseClient,
  expenseDate: string // Format: YYYY-MM-DD
) {
  try {
    const monthKey = expenseDate.substring(0, 7); // Extract YYYY-MM

    const { error } = await supabase
      .from('insights_cache')
      .delete()
      .eq('analysis_month', monthKey);

    if (error) {
      console.error('Failed to invalidate cache:', error);
    } else {
      console.log(`Invalidated global insights cache for ${monthKey}`);
    }
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
}
