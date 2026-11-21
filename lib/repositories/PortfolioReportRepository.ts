import type { SupabaseClient } from '@supabase/supabase-js';

export type PortfolioReportSnapshotRow = {
  snapshot_date: string;
  amount: number;
  account_id: string;
  portfolio_accounts?: { id: string; name: string; type: string; sort_order: number; is_active: boolean } | { id: string; name: string; type: string; sort_order: number; is_active: boolean }[];
};

export class PortfolioReportRepository {
  constructor(private supabase: SupabaseClient) {}

  async findEarliestSnapshotDate(accountType: string | null) {
    let q = this.supabase
      .from('portfolio_snapshots')
      .select(
        `
        snapshot_date,
        portfolio_accounts!inner(id, type, is_active)
      `,
      )
      .eq('portfolio_accounts.is_active', true)
      .order('snapshot_date', { ascending: true })
      .limit(1);

    if (accountType) q = q.eq('portfolio_accounts.type', accountType);
    return await q;
  }

  async listSnapshotsPage(params: {
    startStr: string;
    endStr: string;
    offset: number;
    pageSize: number;
    accountType: string | null;
  }) {
    const { startStr, endStr, offset, pageSize, accountType } = params;
    let q = this.supabase
      .from('portfolio_snapshots')
      .select(
        `
          snapshot_date,
          amount,
          account_id,
          portfolio_accounts!inner(id, name, type, sort_order, is_active)
        `,
      )
      .eq('portfolio_accounts.is_active', true)
      .gte('snapshot_date', startStr)
      .lte('snapshot_date', endStr)
      .order('snapshot_date', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (accountType) q = q.eq('portfolio_accounts.type', accountType);
    return await q;
  }

  async listActiveAccounts(accountType: string | null) {
    let q = this.supabase
      .from('portfolio_accounts')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (accountType) q = q.eq('type', accountType);
    return await q;
  }
}

