import type { SupabaseClient } from '@supabase/supabase-js';

export type CreditCardStatement = {
  id: string;
  account_id: string;
  period_start: string;
  period_end: string;
  statement_date: string;
  due_date: string;
  statement_amount: number | null;
  amount_paid: number | null;
  payment_date: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

/** First day of the month after `month` (yyyy-MM), as yyyy-MM-dd. */
function nextMonthStart(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
}

export class CreditCardStatementRepository {
  constructor(private supabase: SupabaseClient) {}

  async listForAccount(
    accountId: string,
    opts: { limit?: number; month?: string; onOrBefore?: string } = {}
  ) {
    let q = this.supabase
      .from('credit_card_statements')
      .select('id, account_id, period_start, period_end, statement_date, due_date, statement_amount, amount_paid, payment_date, notes, created_at, updated_at')
      .eq('account_id', accountId)
      .order('statement_date', { ascending: false });

    // Statements inside one billing month (yyyy-MM).
    if (opts.month) q = q.gte('statement_date', `${opts.month}-01`).lt('statement_date', nextMonthStart(opts.month));
    // Newest statement at or before a date — a card's statement for the month being
    // viewed often does not exist yet, and the previous one is the best balance there is.
    if (opts.onOrBefore) q = q.lte('statement_date', opts.onOrBefore);

    if (opts.limit != null) q = q.limit(opts.limit);
    return await q;
  }

  /** Statements dated on or after `date`, across every card — for matching bill payments. */
  async listSince(date: string) {
    return await this.supabase
      .from('credit_card_statements')
      .select('id, account_id, statement_date, statement_amount, amount_paid, payment_date')
      .gte('statement_date', date)
      .order('statement_date', { ascending: false });
  }

  async insert(row: Record<string, unknown>) {
    return await this.supabase.from('credit_card_statements').insert(row).select('*').single();
  }

  async update(id: string, patch: Record<string, unknown>) {
    return await this.supabase.from('credit_card_statements').update(patch).eq('id', id).select('*').single();
  }

  async delete(id: string) {
    return await this.supabase.from('credit_card_statements').delete().eq('id', id);
  }

  async findById(id: string, select: string) {
    return await this.supabase.from('credit_card_statements').select(select).eq('id', id).single();
  }
}

