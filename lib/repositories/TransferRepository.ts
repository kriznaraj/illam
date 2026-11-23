import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from './BaseRepository';
import type { Transfer, TransferStatus } from '@/types';

export class TransferRepository extends BaseRepository<Transfer> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'transfers');
  }

  protected getSelectQuery(): string {
    return '*';
  }

  async list(filter: { status?: TransferStatus; limit?: number } = {}): Promise<Transfer[]> {
    const { data, error } = await this.withRetry(async () => {
      let query = this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .order('date', { ascending: false })
        .limit(filter.limit ?? 200);
      if (filter.status) query = query.eq('status', filter.status);

      const res = await query;
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch transfers: ${error.message}`);
    }
    return ((data ?? []) as unknown as Transfer[]).map((row) => ({ ...row, amount: Number(row.amount) }));
  }

  /** Every transfer dated in [from, to] (yyyy-MM-dd), for the cash-flow report. */
  async listBetween(from: string, to: string): Promise<Transfer[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase.from(this.tableName).select('*').gte('date', from).lte('date', to).order('date').limit(2000);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (error) throw new Error(`Failed to fetch transfers: ${error.message}`);
    return ((data ?? []) as unknown as Transfer[]).map((row) => ({ ...row, amount: Number(row.amount) }));
  }

  /**
   * Card statements that a bill payment on or after `since` is already linked to,
   * mapped to the inbox item that made the link (null once that item is gone).
   * A statement is settled once; without this, a later payment of the same amount
   * could be linked to it again in a following run.
   */
  async listLinkedStatements(since: string): Promise<Map<string, string | null>> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('credit_card_statement_id, inbox_item_id')
        .not('credit_card_statement_id', 'is', null)
        .gte('date', since);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch linked statements: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as { credit_card_statement_id: string; inbox_item_id: string | null }[];
    return new Map(rows.map((row) => [row.credit_card_statement_id, row.inbox_item_id]));
  }

  /** Confirmed investment transfers, newest first: what account suggestions and duplicate checks read. */
  async listInvestmentTransfers(filter: { accountId?: string; from?: string; to?: string; limit?: number } = {}): Promise<Transfer[]> {
    const { data, error } = await this.withRetry(async () => {
      let query = this.supabase
        .from(this.tableName)
        .select(this.getSelectQuery())
        .eq('status', 'confirmed')
        .eq('kind', 'investment')
        .order('date', { ascending: false })
        .limit(filter.limit ?? 200);
      if (filter.accountId) query = query.eq('account_id', filter.accountId);
      if (filter.from) query = query.gte('date', filter.from);
      if (filter.to) query = query.lte('date', filter.to);
      const res = await query;
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch investment transfers: ${error.message}`);
    }
    return ((data ?? []) as unknown as Transfer[]).map((row) => ({ ...row, amount: Number(row.amount) }));
  }

  /** Contribution rows a transfer created or linked (via `transfers.portfolio_investment_id`). */
  async listLinkedInvestmentIds(): Promise<Set<string>> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('portfolio_investment_id')
      .not('portfolio_investment_id', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch linked contributions: ${error.message}`);
    }
    return new Set(((data ?? []) as unknown as { portfolio_investment_id: string }[]).map((row) => row.portfolio_investment_id));
  }

  /**
   * `fund|month` keys other transfers already claimed on this account, over the months a
   * debit could be settling. Month-scoped rather than whole-table so the set stays small,
   * and widened to several months because a mandate due on the 30th posts on the 2nd.
   */
  async listSipClaims(accountId: string, months: readonly string[], exceptTransferId?: string): Promise<Set<string>> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('id, sip_fund, sip_month')
      .eq('account_id', accountId)
      .in('sip_month', months as string[])
      .not('sip_fund', 'is', null);

    if (error) {
      if (/sip_fund|sip_month/.test(error.message)) return new Set();
      throw new Error(`Failed to fetch SIP claims: ${error.message}`);
    }
    return new Set(
      ((data ?? []) as unknown as { id: string; sip_fund: string; sip_month: string }[])
        .filter((row) => row.id !== exceptTransferId)
        .map((row) => `${row.sip_fund}|${row.sip_month}`)
    );
  }

  /**
   * The same claims across every account, keyed `accountId|fund|month`, for the scan that
   * decides which account a debit belongs to before one has been chosen.
   */
  async listSipClaimsEverywhere(months: readonly string[], exceptTransferId?: string): Promise<Set<string>> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('id, account_id, sip_fund, sip_month')
      .in('sip_month', months as string[])
      .not('sip_fund', 'is', null);

    if (error) {
      if (/sip_fund|sip_month/.test(error.message)) return new Set();
      throw new Error(`Failed to fetch SIP claims: ${error.message}`);
    }
    return new Set(
      ((data ?? []) as unknown as { id: string; account_id: string | null; sip_fund: string; sip_month: string }[])
        .filter((row) => row.id !== exceptTransferId && row.account_id)
        .map((row) => `${row.account_id}|${row.sip_fund}|${row.sip_month}`)
    );
  }

  async findByInboxItem(inboxItemId: string): Promise<Transfer | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('inbox_item_id', inboxItemId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find transfer: ${error.message}`);
    }
    return data ? ({ ...(data as unknown as Transfer), amount: Number((data as unknown as Transfer).amount) }) : null;
  }
}
