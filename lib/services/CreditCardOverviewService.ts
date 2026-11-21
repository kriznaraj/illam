import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { CreditCardOverviewRepository, type CreditCardAccountRow, type CreditCardStatementRow } from '@/lib/repositories/CreditCardOverviewRepository';
import { getTodayAppDate, parseAppDate } from '@/lib/utils/dateUtils';

type Alert =
  | { type: 'statement_ready'; account_id: string; account_name: string; statement_date: string }
  | { type: 'due_soon'; account_id: string; account_name: string; due_date: string; days_until_due: number; pending_amount: number }
  | { type: 'overdue'; account_id: string; account_name: string; due_date: string; days_overdue: number; pending_amount: number };

function safeString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseDayOfMonth(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 1 && v <= 31 ? v : null;
  const s = safeString(v).trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 31) return null;
  return n;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clampToMonthDay(year: number, monthIndex0: number, day: number): Date {
  const d = new Date(year, monthIndex0, day);
  if (d.getMonth() !== monthIndex0) return new Date(year, monthIndex0 + 1, 0);
  return d;
}

function daysBetween(today: Date, targetYmd: string): number {
  const t = new Date(targetYmd + 'T00:00:00');
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

export class CreditCardOverviewService extends BaseService {
  private repo: CreditCardOverviewRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new CreditCardOverviewRepository(supabase);
  }

  async getOverview(params: { month?: string | null; today?: Date }) {
    try {
      // Anchored to the APP_TIMEZONE calendar day rather than the server clock
      // (UTC in production), so getFullYear/getMonth/getDate below -- and the
      // ymd() and daysBetween() calls further down -- all read IST dates.
      const today = params.today ?? parseAppDate(getTodayAppDate());
      const monthParam = params.month ?? null; // yyyy-MM
      const currentMonthKey =
        monthParam && /^\d{4}-\d{2}$/.test(monthParam)
          ? monthParam
          : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

      const { data: accounts, error: accErr } = await this.repo.listActiveCreditCardAccounts();
      if (accErr) throw new Error(accErr.message);
      const acc = (accounts ?? []) as CreditCardAccountRow[];
      const accountIds = acc.map((a) => String(a.id));

      const { data: statements, error: stErr } = await this.repo.listStatementsForAccountIds(accountIds);
      if (stErr) throw new Error(stErr.message);
      const statementsWithPayments = (statements ?? []) as CreditCardStatementRow[];

      const byAccount: Record<string, CreditCardStatementRow[]> = {};
      for (const s of statementsWithPayments) {
        const id = String(s.account_id);
        byAccount[id] = byAccount[id] ?? [];
        byAccount[id].push(s);
      }

      const [selYear, selMonthIdx] = currentMonthKey.split('-').map(Number);
      const selMonthIndex0 = selMonthIdx - 1;

      const cards = acc.map((a) => {
        const details = (a.details ?? null) as Record<string, unknown> | null;
        const billingDay = parseDayOfMonth(details?.billing_date);
        const dueDay = parseDayOfMonth(details?.due_date);

        const statementDate = billingDay != null ? clampToMonthDay(selYear, selMonthIndex0, billingDay) : null;
        const statementDateYmd = statementDate ? ymd(statementDate) : null;

        let dueDateYmd: string | null = null;
        if (billingDay != null && dueDay != null) {
          const dueMonthIndex0 = dueDay < billingDay ? selMonthIndex0 + 1 : selMonthIndex0;
          const dueDate = clampToMonthDay(selYear, dueMonthIndex0, dueDay);
          dueDateYmd = ymd(dueDate);
        }

        const all = byAccount[String(a.id)] ?? [];
        const billedThisMonth = all.find((s) => safeString(s.statement_date).slice(0, 7) === currentMonthKey) ?? null;
        const prevMonthKey = ymd(new Date(selYear, selMonthIndex0 - 1, 1)).slice(0, 7);
        const dueThisMonth = !billedThisMonth
          ? (all.find(
              (s) =>
                safeString(s.statement_date).slice(0, 7) === prevMonthKey &&
                safeString(s.due_date).slice(0, 7) === currentMonthKey,
            ) ?? null)
          : null;

        const monthStatement = billedThisMonth ?? dueThisMonth;
        const latest = all[0] ?? null;

        const enrich = (s: CreditCardStatementRow | null) => {
          if (!s) return null;
          const paid = Number((s.amount_paid as any) || 0);
          const pending = Number((s.statement_amount as any) || 0) - paid;
          const dueIn = daysBetween(today, String((s as any).due_date));
          const status = pending <= 0 ? 'paid' : dueIn < 0 ? 'overdue' : 'pending';
          return { ...s, paid_amount: paid, pending_amount: pending, status, due_in_days: dueIn };
        };

        const current = monthStatement ? enrich(monthStatement) : null;
        const latestEnriched = latest ? enrich(latest) : null;

        const billingDatePassed = !!statementDateYmd && statementDateYmd <= ymd(today);
        const canAddStatement = billingDatePassed && !billedThisMonth;

        const statementReady = canAddStatement;
        const dueSoon = current && (current as any).pending_amount > 0 && (current as any).due_in_days >= 0 && (current as any).due_in_days <= 2;
        const overdue = current && (current as any).pending_amount > 0 && (current as any).due_in_days < 0;

        return {
          account: {
            id: String(a.id),
            name: safeString((a as any).name),
            billing_day: billingDay,
            due_day: dueDay,
            billing_date_raw: safeString(details?.billing_date),
            due_date_raw: safeString(details?.due_date),
          },
          current_month_key: currentMonthKey,
          expected: { statement_date: statementDateYmd, due_date: dueDateYmd },
          current_statement: current,
          latest_statement: latestEnriched,
          all_statements: all.map((x) => enrich(x as any)),
          can_add_statement: canAddStatement,
          status: statementReady ? 'need_statement' : overdue ? 'overdue' : dueSoon ? 'due_soon' : (current as any)?.status ?? 'no_statement',
          flags: { statement_ready: statementReady, due_soon: !!dueSoon, overdue: !!overdue },
        };
      });

      const historyMap: Record<string, { total: number; paid: number }> = {};
      for (const s of statementsWithPayments as any[]) {
        const mk = safeString(s.statement_date).slice(0, 7);
        if (!mk) continue;
        historyMap[mk] = historyMap[mk] ?? { total: 0, paid: 0 };
        historyMap[mk].total += Number(s.statement_amount || 0);
        historyMap[mk].paid += Number(s.amount_paid || 0);
      }
      const history = Object.entries(historyMap)
        .map(([month, v]) => ({ month, total: v.total, paid: v.paid, pending: v.total - v.paid }))
        .sort((a, b) => a.month.localeCompare(b.month));

      const alerts: Alert[] = [];
      for (const c of cards as any[]) {
        const id = c.account.id;
        const name = c.account.name;
        if (c.flags.statement_ready && c.expected.statement_date) {
          alerts.push({ type: 'statement_ready', account_id: id, account_name: name, statement_date: c.expected.statement_date });
        }
        if (c.current_statement && Number(c.current_statement.pending_amount || 0) > 0) {
          const dueDate = safeString(c.current_statement.due_date);
          const dueIn = Number(c.current_statement.due_in_days ?? 999);
          const pending = Number(c.current_statement.pending_amount || 0);
          if (dueIn >= 0 && dueIn <= 2) {
            alerts.push({ type: 'due_soon', account_id: id, account_name: name, due_date: dueDate, days_until_due: dueIn, pending_amount: pending });
          } else if (dueIn < 0) {
            alerts.push({ type: 'overdue', account_id: id, account_name: name, due_date: dueDate, days_overdue: Math.abs(dueIn), pending_amount: pending });
          }
        }
      }

      const totals = (cards as any[]).reduce(
        (acc, c) => {
          const amt = Number(c.current_statement?.statement_amount || 0);
          const pending = Number(c.current_statement?.pending_amount || 0);
          acc.statement_total += amt;
          acc.pending_total += pending;
          return acc;
        },
        { statement_total: 0, pending_total: 0 },
      );

      return { month: { key: currentMonthKey }, totals, alerts, cards, history };
    } catch (e) {
      this.handleError(e, 'get credit card overview');
    }
  }
}

