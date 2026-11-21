import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST caps a single response; snapshots are read a page at a time. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

export class PortfolioInsightsRepository {
  constructor(private supabase: SupabaseClient) {}

  async listCurrentSnapshots(monthIsoDate: string) {
    return await this.supabase
      .from('portfolio_snapshots')
      .select('*, portfolio_accounts(name, type)')
      .eq('snapshot_date', monthIsoDate)
      .order('amount', { ascending: false });
  }

  async listSnapshots(monthIsoDate: string) {
    return await this.supabase.from('portfolio_snapshots').select('*').eq('snapshot_date', monthIsoDate);
  }

  /**
   * Every snapshot in a date window, paginated.
   *
   * The insight engine needs a trend, not three sampled dates: staleness, drawdown and
   * the contribution/valuation split are all impossible to see from a single month-pair.
   */
  async listSnapshotsInRange(startIsoDate: string, endIsoDate: string) {
    const rows: any[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const { data, error } = await this.supabase
        .from('portfolio_snapshots')
        .select('account_id, snapshot_date, amount')
        .gte('snapshot_date', startIsoDate)
        .lte('snapshot_date', endIsoDate)
        .order('snapshot_date', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) return { data: null, error };
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    return { data: rows, error: null };
  }

  /**
   * All accounts, inactive included — a stale inactive account should not be nagged about.
   * `*` rather than a column list so `is_cash` is read once migration 033 exists and
   * the query still works before it does.
   */
  async listAccounts() {
    return await this.supabase
      .from('portfolio_accounts')
      .select('*')
      .order('sort_order', { ascending: true });
  }

  /** Materialised contributions in the window. SIP contributions are NOT here — they are virtual. */
  async listInvestmentsInRange(startIsoDate: string, endIsoDate: string) {
    return await this.supabase
      .from('portfolio_investments')
      .select('account_id, investment_date, amount, kind, note')
      .gte('investment_date', startIsoDate)
      .lte('investment_date', endIsoDate);
  }
}
