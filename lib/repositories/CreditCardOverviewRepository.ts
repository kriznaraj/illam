import type { SupabaseClient } from '@supabase/supabase-js';

export type CreditCardAccountRow = {
  id: string;
  name: string;
  details?: Record<string, unknown> | null;
  is_active: boolean;
  created_at?: string;
  sort_order?: number;
  type?: string;
};

export type CreditCardStatementRow = {
  id: string;
  account_id: string;
  period_start: string;
  period_end: string;
  statement_date: string;
  due_date: string;
  statement_amount: number;
  amount_paid: number;
  payment_date: string | null;
};

export class CreditCardOverviewRepository {
  constructor(private supabase: SupabaseClient) {}

  async listActiveCreditCardAccounts() {
    return await this.supabase
      .from('portfolio_accounts')
      .select('id, name, type, is_active, created_at, sort_order, details')
      .eq('type', 'Credit Card')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
  }

  async listStatementsForAccountIds(accountIds: string[]) {
    if (!accountIds.length) return { data: [], error: null as any };
    return await this.supabase
      .from('credit_card_statements')
      .select('id, account_id, period_start, period_end, statement_date, due_date, statement_amount, amount_paid, payment_date')
      .in('account_id', accountIds)
      .order('statement_date', { ascending: false });
  }
}

