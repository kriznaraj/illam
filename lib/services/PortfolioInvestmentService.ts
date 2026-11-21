import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortfolioAccount, PortfolioInvestment, PortfolioInvestmentKind } from '@/types';
import { resolveSipAmount, type SipAmountChange } from '@/lib/portfolio/sipSchedule';
import type { SipAccountSchedule } from '@/lib/portfolio/sipMatch';
import { INVESTMENT_START_MONTH } from '@/lib/portfolio/constants';
import type { CashFlowContribution } from '@/lib/cashflow/buildCashFlow';

type MonthlyPoint = {
  month: string;
  manual: number;
  auto_sip: number;
  total: number;
};

type MonthlySplitRow = {
  account_id: string;
  account_name: string;
  manual_amount: number;
  auto_sip_amount: number;
  total_amount: number;
  percentage: number;
};

type InvestmentsReport = {
  months: string[];
  monthly: MonthlyPoint[];
  monthly_split: Record<string, MonthlySplitRow[]>;
};

type SipFundLike = {
  name?: string;
  sip_amount?: number;
  sip_date?: string;
  active?: boolean;
  notes?: string;
  amount_history?: SipAmountChange[];
};

const AUTO_RECURRING_NOTE = '__AUTO_MONTHLY__';

const monthKey = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const monthStartDate = (month: string): string => `${month}-01`;
const monthEndDate = (month: string): string => {
  const [y, m] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!y || !m) return `${month}-31`;
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
};

const buildMonths = (monthsBack: number): string[] => {
  const safeBack = Math.max(1, Math.min(36, monthsBack));
  const now = new Date();
  const months: string[] = [];
  for (let i = safeBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(monthKey(d));
  }
  return months;
};

const nextMonth = (month: string): string => {
  const [y, m] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!y || !m) return month;
  const d = new Date(Date.UTC(y, m, 1));
  return monthKey(d);
};

const monthRange = (startMonth: string, endMonth: string): string[] => {
  if (startMonth > endMonth) return [];
  const out: string[] = [];
  let cursor = startMonth;
  while (cursor <= endMonth) {
    out.push(cursor);
    cursor = nextMonth(cursor);
  }
  return out;
};

const getRecurringMonthlyAmount = (details: PortfolioAccount['details']): number => {
  if (!details || typeof details !== 'object') return 0;
  const record = details as Record<string, unknown>;
  const enabled = record.recurring_investments_enabled === true || record.recurring_investments_enabled === 'true';
  if (!enabled) return 0;
  const amount = Number(record.recurring_monthly_amount ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/**
 * What the account's SIPs contributed in `month`.
 *
 * Month-aware on purpose: a fund's amount is effective-dated, so raising a SIP
 * must not rewrite the months that ran at the old figure. Funds without an
 * `amount_history` resolve to their flat `sip_amount`, exactly as before.
 */
const getActiveSipMonthlyAmount = (details: PortfolioAccount['details'], month: string): number => {
  if (!details || typeof details !== 'object') return 0;
  const funds = (details as Record<string, unknown>).funds;
  if (!Array.isArray(funds)) return 0;

  return funds.reduce((sum: number, row) => {
    if (!row || typeof row !== 'object') return sum;
    const fund = row as SipFundLike;
    if (fund.active === false) return sum;
    return sum + resolveSipAmount(fund, month);
  }, 0);
};

/** A column this code reads or writes but the live database has not got yet (a migration not applied). */
const isMissingColumn = (message: string, column: string): boolean =>
  message.includes(column) && /does not exist|could not find|schema cache/i.test(message);

export class PortfolioInvestmentService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  private isTransientSupabaseError(errorMessage: string): boolean {
    const msg = errorMessage.toLowerCase();
    return (
      msg.includes('fetch failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout')
    );
  }

  private async ensureAutoRecurringEntries(startDate: string, endDate: string): Promise<void> {
    const startMonth = startDate.slice(0, 7);
    const endMonth = endDate.slice(0, 7);
    if (!startMonth || !endMonth) return;

    const effectiveStart = startMonth < INVESTMENT_START_MONTH ? INVESTMENT_START_MONTH : startMonth;
    if (effectiveStart > endMonth) return;

    const [accountsRes, existingRes] = await Promise.all([
      this.supabase
        .from('portfolio_accounts')
        .select('id, details')
        .eq('is_active', true),
      this.supabase
        .from('portfolio_investments')
        .select('account_id, investment_date, amount')
        .eq('kind', 'recurring')
        .eq('note', AUTO_RECURRING_NOTE)
        .gte('investment_date', `${effectiveStart}-01`)
        .lte('investment_date', monthEndDate(endMonth)),
    ]);

    if (accountsRes.error) {
      if (this.isTransientSupabaseError(accountsRes.error.message)) {
        return;
      }
      throw new Error(`Failed to load accounts for auto recurring: ${accountsRes.error.message}`);
    }
    if (existingRes.error && !this.isMissingInvestmentsTableError(existingRes.error.message)) {
      if (this.isTransientSupabaseError(existingRes.error.message)) {
        return;
      }
      throw new Error(`Failed to load existing auto recurring rows: ${existingRes.error.message}`);
    }

    const accounts = ((accountsRes.data ?? []) as Array<{ id: string; details: Record<string, unknown> | null }>)
      .map((a) => ({ id: a.id, amount: getRecurringMonthlyAmount(a.details) }))
      .filter((a) => a.amount > 0);
    if (accounts.length === 0) return;

    const existingRows = (existingRes.data ?? []) as Array<{
      account_id: string;
      investment_date: string;
      amount?: number | string | null;
    }>;
    const existing = new Set(
      existingRows.map((row) => `${row.account_id}|${row.investment_date.slice(0, 7)}`)
    );

    const months = monthRange(effectiveStart, endMonth);
    const inserts: Array<{
      account_id: string;
      investment_date: string;
      amount: number;
      kind: 'recurring';
      note: string;
    }> = [];

    // The rows themselves are the record of what was contributed each month, so
    // a month with no row is back-filled at the amount running *then* — the
    // nearest earlier row — rather than at today's figure. Filling a 2025 gap
    // with a 2026 amount would silently restate that month.
    const amountAtOrBefore = (accountId: string, month: string): number | null => {
      let best: { month: string; amount: number } | null = null;
      for (const row of existingRows) {
        if (row.account_id !== accountId) continue;
        const rowMonth = row.investment_date.slice(0, 7);
        if (rowMonth > month) continue;
        if (!best || rowMonth > best.month) best = { month: rowMonth, amount: Number(row.amount) };
      }
      return best ? best.amount : null;
    };

    for (const account of accounts) {
      for (const month of months) {
        const key = `${account.id}|${month}`;
        if (existing.has(key)) continue;
        inserts.push({
          account_id: account.id,
          investment_date: `${month}-01`,
          amount: amountAtOrBefore(account.id, month) ?? account.amount,
          kind: 'recurring',
          note: AUTO_RECURRING_NOTE,
        });
      }
    }

    if (inserts.length === 0) return;
    const { error } = await this.supabase.from('portfolio_investments').insert(inserts);
    if (error && !this.isMissingInvestmentsTableError(error.message)) {
      if (this.isTransientSupabaseError(error.message)) {
        return;
      }
      throw new Error(`Failed to create auto recurring rows: ${error.message}`);
    }
  }

  private isMissingInvestmentsTableError(errorMessage: string): boolean {
    const msg = errorMessage.toLowerCase();
    return msg.includes('portfolio_investments') && (
      msg.includes('could not find the table') ||
      msg.includes('does not exist') ||
      msg.includes('schema cache')
    );
  }

  /**
   * Change a recurring account's monthly amount from `fromMonth` onwards.
   *
   * Auto rows are materialised, and `ensureAutoRecurringEntries` only ever
   * *inserts* — so editing `recurring_monthly_amount` alone changes nothing for
   * any month that already has a row. Since the page materialises months as
   * they are viewed, that routinely includes months well into the future: a new
   * amount would not take effect until past the last row. This restates the
   * rows from `fromMonth` on, and leaves every earlier month untouched.
   */
  async setRecurringAmountFrom(params: {
    accountId: string;
    amount: number;
    fromMonth: string;
  }): Promise<{ updated: number; from_month: string }> {
    const { accountId, amount, fromMonth } = params;

    if (!accountId) throw new Error('accountId is required');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth)) {
      throw new Error('fromMonth must be a YYYY-MM month');
    }
    const nextAmount = Number(amount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      throw new Error('amount must be a positive number');
    }

    const { data, error } = await this.supabase
      .from('portfolio_investments')
      .update({ amount: nextAmount })
      .eq('account_id', accountId)
      .eq('kind', 'recurring')
      .eq('note', AUTO_RECURRING_NOTE)
      .gte('investment_date', `${fromMonth}-01`)
      .select('id');

    if (error) {
      if (this.isMissingInvestmentsTableError(error.message)) return { updated: 0, from_month: fromMonth };
      throw new Error(`Failed to update recurring rows: ${error.message}`);
    }

    return { updated: (data ?? []).length, from_month: fromMonth };
  }

  async list(params?: {
    limit?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<PortfolioInvestment[]> {
    const safeLimit = Math.max(1, Math.min(500, params?.limit ?? 100));
    if (params?.startDate && params?.endDate) {
      await this.ensureAutoRecurringEntries(params.startDate, params.endDate);
    }
    let query = this.supabase
      .from('portfolio_investments')
      .select('*, account:portfolio_accounts(*)')
      .order('investment_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (params?.startDate) {
      query = query.gte('investment_date', params.startDate);
    }
    if (params?.endDate) {
      query = query.lte('investment_date', params.endDate);
    }

    const { data, error } = await query.limit(safeLimit);

    if (error) {
      if (this.isMissingInvestmentsTableError(error.message)) {
        return [];
      }
      throw new Error(`Failed to fetch investments: ${error.message}`);
    }

    return (data as unknown as PortfolioInvestment[]) ?? [];
  }

  async create(input: {
    account_id: string;
    investment_date: string;
    amount: number;
    kind?: PortfolioInvestmentKind;
    note?: string | null;
    /** The bank transfer this contribution was recorded from (migration 034). */
    transfer_id?: string | null;
  }): Promise<PortfolioInvestment> {
    const payload: Record<string, unknown> = {
      account_id: input.account_id,
      investment_date: input.investment_date,
      amount: input.amount,
      kind: input.kind ?? 'adhoc',
      note: input.note ?? null,
    };
    if (input.transfer_id) payload.transfer_id = input.transfer_id;

    const insert = (row: Record<string, unknown>) =>
      this.supabase.from('portfolio_investments').insert([row]).select('*, account:portfolio_accounts(*)').single();

    let { data, error } = await insert(payload);
    if (error && input.transfer_id && isMissingColumn(error.message, 'transfer_id')) {
      // Before migration 034 the link cannot be stored; the contribution still is.
      delete payload.transfer_id;
      ({ data, error } = await insert(payload));
    }

    if (error) {
      throw new Error(`Failed to create investment: ${error.message}`);
    }

    return data as unknown as PortfolioInvestment;
  }

  /** The contribution a transfer created, if any — so a retried confirm never inserts twice. */
  async findByTransfer(transferId: string): Promise<{ id: string } | null> {
    const { data, error } = await this.supabase.from('portfolio_investments').select('id').eq('transfer_id', transferId).maybeSingle();
    if (error) {
      if (isMissingColumn(error.message, 'transfer_id')) return null;
      throw new Error(`Failed to look up the transfer's contribution: ${error.message}`);
    }
    return data ? { id: String((data as { id: string }).id) } : null;
  }

  /** Contributions on one account in a date range, with what a transfer match needs. */
  async listForMatching(
    accountId: string,
    from: string,
    to: string
  ): Promise<{ id: string; investment_date: string; amount: number; note: string | null; transfer_id: string | null }[]> {
    const query = (columns: string) =>
      this.supabase.from('portfolio_investments').select(columns).eq('account_id', accountId).gte('investment_date', from).lte('investment_date', to);

    let { data, error } = await query('id, investment_date, amount, note, transfer_id');
    if (error && isMissingColumn(error.message, 'transfer_id')) ({ data, error } = await query('id, investment_date, amount, note'));
    if (error) throw new Error(`Failed to read contributions: ${error.message}`);

    return ((data ?? []) as unknown as Array<{ id: string; investment_date: string; amount: number | string; note: string | null; transfer_id?: string | null }>).map(
      (row) => ({
        id: String(row.id),
        investment_date: String(row.investment_date),
        amount: Number(row.amount),
        note: row.note ?? null,
        transfer_id: row.transfer_id ?? null,
      })
    );
  }

  /**
   * Claims an existing contribution for a transfer. Only an unclaimed row on the same account:
   * the unique transfer_id means two debits can never claim one contribution.
   */
  async linkToTransfer(rowId: string, transferId: string, accountId: string): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from('portfolio_investments')
      .update({ transfer_id: transferId })
      .eq('id', rowId)
      .eq('account_id', accountId)
      .is('transfer_id', null)
      .select('id');

    if (error) {
      if (isMissingColumn(error.message, 'transfer_id')) throw new Error('Linking to an existing contribution needs migration 034');
      throw new Error(`Failed to link contribution: ${error.message}`);
    }
    if (!data || data.length === 0) throw new Error('That contribution is already linked to another transfer');
    return { id: String((data[0] as { id: string }).id) };
  }

  /** An account's SIP funds (`details.funds`), for matching a debit to a virtual instalment. */
  /**
   * Every account that runs SIPs, with its schedule — for recognising a debit as an
   * instalment before any account has been picked. Accounts are few (41 today) and only
   * those carrying `details.funds` come back, so this is one small read.
   */
  async sipSchedules(): Promise<SipAccountSchedule[]> {
    const { data, error } = await this.supabase.from('portfolio_accounts').select('id, name, details');
    if (error) throw new Error(`Failed to read accounts: ${error.message}`);
    const rows = (data ?? []) as unknown as { id: string; name: string; details?: { funds?: unknown } | null }[];
    return rows
      .map((row) => ({ accountId: row.id, accountName: row.name, funds: row.details?.funds }))
      .filter((row): row is SipAccountSchedule => Array.isArray(row.funds) && row.funds.length > 0);
  }

  async sipFunds(accountId: string): Promise<unknown[]> {
    const { data, error } = await this.supabase.from('portfolio_accounts').select('details').eq('id', accountId).maybeSingle();
    if (error) throw new Error(`Failed to read account: ${error.message}`);
    const funds = ((data as { details?: { funds?: unknown } | null } | null)?.details ?? null)?.funds;
    return Array.isArray(funds) ? funds : [];
  }

  async update(input: {
    id: string;
    account_id?: string;
    investment_date?: string;
    amount?: number;
    kind?: PortfolioInvestmentKind;
    note?: string | null;
  }): Promise<PortfolioInvestment> {
    const { id, ...patch } = input;
    if (!id) {
      throw new Error('Investment ID is required');
    }

    const updateData: Record<string, unknown> = {};
    if (patch.account_id !== undefined) updateData.account_id = patch.account_id;
    if (patch.investment_date !== undefined) updateData.investment_date = patch.investment_date;
    if (patch.amount !== undefined) updateData.amount = patch.amount;
    if (patch.kind !== undefined) updateData.kind = patch.kind;
    if (patch.note !== undefined) updateData.note = patch.note;

    const { data, error } = await this.supabase
      .from('portfolio_investments')
      .update(updateData)
      .eq('id', id)
      .select('*, account:portfolio_accounts(*)')
      .single();

    if (error) {
      throw new Error(`Failed to update investment: ${error.message}`);
    }

    return data as unknown as PortfolioInvestment;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('portfolio_investments')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete investment: ${error.message}`);
    }
  }

  /**
   * Every contribution in [fromMonth, toMonth], by month and account, for the cash-flow report:
   * entered rows, auto-monthly rows (EPF, NPS — paid through payroll) and virtual SIP
   * instalments, the same three sources `getReport` adds up. Months are the contribution's own
   * — the snapshot shift in the insights does not apply to money leaving.
   */
  async contributionsByMonth(fromMonth: string, toMonth: string): Promise<CashFlowContribution[]> {
    const months = monthRange(fromMonth, toMonth);
    if (months.length === 0) return [];
    const startDate = monthStartDate(months[0]);
    const endDate = monthEndDate(months[months.length - 1]);
    await this.ensureAutoRecurringEntries(startDate, endDate);

    const [rowsRes, accountsRes] = await Promise.all([
      this.supabase.from('portfolio_investments').select('*').gte('investment_date', startDate).lte('investment_date', endDate).limit(5000),
      this.supabase.from('portfolio_accounts').select('id, name, is_active, details'),
    ]);
    if (rowsRes.error && !this.isMissingInvestmentsTableError(rowsRes.error.message)) {
      throw new Error(`Failed to read contributions: ${rowsRes.error.message}`);
    }
    if (accountsRes.error) throw new Error(`Failed to load accounts: ${accountsRes.error.message}`);

    const accounts = (accountsRes.data ?? []) as unknown as Pick<PortfolioAccount, 'id' | 'name' | 'is_active' | 'details'>[];
    const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
    const totals = new Map<string, CashFlowContribution>();
    const add = (month: string, accountId: string, amount: number, via: CashFlowContribution['via']) => {
      if (!Number.isFinite(amount) || amount === 0) return;
      // Withdrawals are kept apart from contributions: the report puts them on the money-in side.
      const key = `${month}|${accountId}|${via}|${amount < 0 ? 'out' : 'in'}`;
      const existing = totals.get(key);
      if (existing) existing.amount += amount;
      else totals.set(key, { month, accountId, accountName: nameOf.get(accountId) ?? 'Unknown account', amount, via });
    };

    for (const row of (rowsRes.data ?? []) as unknown as PortfolioInvestment[]) {
      const auto = row.note === AUTO_RECURRING_NOTE && row.kind === 'recurring';
      add(row.investment_date.slice(0, 7), row.account_id, Number(row.amount ?? 0), auto ? 'payroll' : 'entered');
    }
    for (const month of months) {
      if (month < INVESTMENT_START_MONTH) continue;
      for (const account of accounts) {
        if (!account.is_active) continue;
        add(month, account.id, getActiveSipMonthlyAmount(account.details, month), 'sip');
      }
    }
    return Array.from(totals.values()).map((c) => ({ ...c, amount: Math.round(c.amount * 100) / 100 }));
  }

  async getReport(monthsBack = 12): Promise<InvestmentsReport> {
    const months = buildMonths(monthsBack).filter((month) => month >= INVESTMENT_START_MONTH);
    if (months.length === 0) {
      return { months: [], monthly: [], monthly_split: {} };
    }
    const startDate = monthStartDate(months[0]);
    const endDate = monthEndDate(months[months.length - 1]);
    await this.ensureAutoRecurringEntries(startDate, endDate);

    const [manualRes, accountsRes] = await Promise.all([
      this.supabase
        .from('portfolio_investments')
        .select('*')
        .gte('investment_date', startDate)
        .lte('investment_date', endDate),
      this.supabase
        .from('portfolio_accounts')
        .select('*')
        .eq('is_active', true),
    ]);

    if (manualRes.error && !this.isMissingInvestmentsTableError(manualRes.error.message)) {
      throw new Error(`Failed to build investment report: ${manualRes.error.message}`);
    }
    if (accountsRes.error) {
      throw new Error(`Failed to load accounts for report: ${accountsRes.error.message}`);
    }

    const manualRows = (manualRes.data as unknown as PortfolioInvestment[]) ?? [];
    const accounts = (accountsRes.data as unknown as PortfolioAccount[]) ?? [];
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const manualByMonth = new Map<string, number>();
    const autoSipByMonth = new Map<string, number>();
    const manualSplit = new Map<string, Map<string, number>>();
    const autoSplit = new Map<string, Map<string, number>>();

    const ensureSplitMonth = (target: Map<string, Map<string, number>>, month: string): Map<string, number> => {
      const map = target.get(month);
      if (map) return map;
      const created = new Map<string, number>();
      target.set(month, created);
      return created;
    };

    for (const row of manualRows) {
      const date = new Date(`${row.investment_date}T00:00:00Z`);
      const mk = monthKey(date);
      if (!months.includes(mk)) continue;

      const amount = Number(row.amount ?? 0);
      if (!Number.isFinite(amount) || amount === 0) continue;

      if (row.note === AUTO_RECURRING_NOTE && row.kind === 'recurring') {
        autoSipByMonth.set(mk, (autoSipByMonth.get(mk) ?? 0) + amount);
        const autoMap = ensureSplitMonth(autoSplit, mk);
        autoMap.set(row.account_id, (autoMap.get(row.account_id) ?? 0) + amount);
      } else {
        manualByMonth.set(mk, (manualByMonth.get(mk) ?? 0) + amount);
        const splitMap = ensureSplitMonth(manualSplit, mk);
        splitMap.set(row.account_id, (splitMap.get(row.account_id) ?? 0) + amount);
      }
    }

    for (const mk of months) {
      let monthlyAuto = 0;
      const splitMap = ensureSplitMonth(autoSplit, mk);
      if (mk < INVESTMENT_START_MONTH) {
        autoSipByMonth.set(mk, 0);
        continue;
      }
      for (const account of accounts) {
        const sipAmount = getActiveSipMonthlyAmount(account.details, mk);
        const accountAuto = sipAmount;
        if (accountAuto <= 0) continue;
        monthlyAuto += accountAuto;
        splitMap.set(account.id, (splitMap.get(account.id) ?? 0) + accountAuto);
      }
      autoSipByMonth.set(mk, (autoSipByMonth.get(mk) ?? 0) + monthlyAuto);
    }

    const monthly = months.map((month) => {
      const manual = Number((manualByMonth.get(month) ?? 0).toFixed(2));
      const auto_sip = Number((autoSipByMonth.get(month) ?? 0).toFixed(2));
      return {
        month,
        manual,
        auto_sip,
        total: Number((manual + auto_sip).toFixed(2)),
      };
    });

    const monthly_split: Record<string, MonthlySplitRow[]> = {};
    for (const month of months) {
      const byAccount = new Map<string, { manual: number; auto: number }>();
      const manualMap = manualSplit.get(month) ?? new Map<string, number>();
      const autoMap = autoSplit.get(month) ?? new Map<string, number>();

      for (const [accountId, amount] of manualMap.entries()) {
        byAccount.set(accountId, { manual: amount, auto: 0 });
      }
      for (const [accountId, amount] of autoMap.entries()) {
        const existing = byAccount.get(accountId);
        if (existing) {
          existing.auto = amount;
        } else {
          byAccount.set(accountId, { manual: 0, auto: amount });
        }
      }

      const total = monthly.find((m) => m.month === month)?.total ?? 0;
      monthly_split[month] = Array.from(byAccount.entries())
        .map(([account_id, values]) => {
          const accountName = accountMap.get(account_id)?.name ?? 'Unknown account';
          const totalAmount = values.manual + values.auto;
          return {
            account_id,
            account_name: accountName,
            manual_amount: Number(values.manual.toFixed(2)),
            auto_sip_amount: Number(values.auto.toFixed(2)),
            total_amount: Number(totalAmount.toFixed(2)),
            percentage: total > 0 ? Number(((totalAmount / total) * 100).toFixed(1)) : 0,
          };
        })
        .sort((a, b) => b.total_amount - a.total_amount);
    }

    return { months, monthly, monthly_split };
  }
}
