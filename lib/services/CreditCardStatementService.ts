import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { CreditCardStatementRepository, type CreditCardStatement } from '@/lib/repositories/CreditCardStatementRepository';
import { CreditCardOverviewRepository } from '@/lib/repositories/CreditCardOverviewRepository';
import { PortfolioSnapshotService } from './PortfolioSnapshotService';
import { getTodayAppDate } from '@/lib/utils/dateUtils';

/** Last calendar day of `month` (yyyy-MM), as yyyy-MM-dd. */
function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, '0')}`;
}

function computeStatus(dueDate: string, pending: number): 'paid' | 'pending' | 'overdue' {
  if (pending <= 0) return 'paid';
  // Compare calendar dates, not a timestamp against midnight: a card due today
  // is still pending for the whole of that day, not overdue from 00:00 onward.
  // Both sides are yyyy-MM-dd in APP_TIMEZONE, so a string compare is correct.
  const due = String(dueDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return 'pending';
  return due < getTodayAppDate() ? 'overdue' : 'pending';
}

export class CreditCardStatementService extends BaseService {
  private repo: CreditCardStatementRepository;
  private snapshots: PortfolioSnapshotService;
  private cards: CreditCardOverviewRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new CreditCardStatementRepository(supabase);
    this.snapshots = new PortfolioSnapshotService(supabase);
    this.cards = new CreditCardOverviewRepository(supabase);
  }

  /**
   * The one place statement data becomes a portfolio snapshot, reached only from
   * `syncSnapshotForMonth` — i.e. only when /portfolio/snapshots asks for it.
   * Statement writes never push: see create().
   *
   * A statement total is money owed and `statement_amount` is always positive, so
   * this goes through PortfolioSnapshotService rather than the repository, keeping
   * the liability sign normalised in exactly one place. See
   * lib/portfolio/liabilities.ts.
   */
  private async syncSnapshot(accountId: string, snapshotMonth: string, statementAmount: number) {
    await this.snapshots.upsert({
      account_id: accountId,
      snapshot_date: `${snapshotMonth}-01`,
      amount: statementAmount,
      units: null,
    });
  }

  /**
   * Set an account's snapshot for `month` from the best statement available.
   *
   * A card's statement for the month being viewed usually does not exist yet
   * (billing cycles land mid-month), so an exact month match would fail on the
   * current month. The newest statement at or before the end of `month` is the
   * best balance there is for that month.
   */
  async syncSnapshotForMonth(accountId: string, month: string) {
    try {
      this.validateUUID(accountId, 'accountId');
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return { status: 400 as const, body: { error: 'month must be yyyy-MM' } };
      }

      const monthEnd = lastDayOfMonth(month);
      const { data, error } = await this.repo.listForAccount(accountId, {
        onOrBefore: monthEnd,
        limit: 1,
      });
      if (error) throw new Error(error.message);

      const statement = (data ?? [])[0] as CreditCardStatement | undefined;
      if (!statement) {
        return { status: 404 as const, body: { error: 'No statement on or before this month' } };
      }

      const statementMonth = String(statement.statement_date).slice(0, 7);
      await this.syncSnapshot(accountId, month, Number(statement.statement_amount || 0));

      return {
        status: 200 as const,
        body: {
          snapshot_month: month,
          statement_month: statementMonth,
          statement_date: statement.statement_date,
          statement_amount: Number(statement.statement_amount || 0),
          // True when the month has no statement of its own and an older one was carried.
          carried_forward: statementMonth !== month,
        },
      };
    } catch (e) {
      this.handleError(e, 'sync credit card snapshot');
    }
  }

  /**
   * Sync every active credit card's snapshot for `month` in one request.
   *
   * Per-card sync meant one round trip and one re-render per card; there are seven,
   * and they are always reconciled together at month end.
   *
   * A card with no statement at all is reported in `skipped` rather than failing the
   * batch — one unused card should not stop the other six from syncing.
   */
  async syncAllSnapshotsForMonth(month: string) {
    try {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return { status: 400 as const, body: { error: 'month must be yyyy-MM' } };
      }

      const { data: accounts, error } = await this.cards.listActiveCreditCardAccounts();
      if (error) throw new Error(error.message);

      const synced: Array<{ account_id: string; name: string; statement_month: string; carried_forward: boolean }> = [];
      const skipped: Array<{ account_id: string; name: string; reason: string }> = [];

      for (const account of (accounts ?? []) as Array<{ id: string; name: string }>) {
        // Per-card failures are collected, never thrown: syncSnapshotForMonth raises on
        // a malformed id or a write error, and one bad card must not abandon the rest
        // of the batch half-applied.
        try {
          const result = await this.syncSnapshotForMonth(account.id, month);
          if (result.status === 200) {
            const body = result.body as { statement_month: string; carried_forward: boolean };
            synced.push({
              account_id: account.id,
              name: account.name,
              statement_month: body.statement_month,
              carried_forward: body.carried_forward,
            });
          } else {
            skipped.push({
              account_id: account.id,
              name: account.name,
              reason: (result.body as { error?: string }).error ?? 'Sync failed',
            });
          }
        } catch (cardError) {
          skipped.push({
            account_id: account.id,
            name: account.name,
            reason: cardError instanceof Error ? cardError.message : 'Sync failed',
          });
        }
      }

      return { status: 200 as const, body: { month, synced, skipped } };
    } catch (e) {
      this.handleError(e, 'sync all credit card snapshots');
    }
  }

  async list(accountId: string, month?: string | null) {
    try {
      this.validateUUID(accountId, 'accountId');
      const { data: statements, error } = await this.repo.listForAccount(
        accountId,
        month ? { month } : {}
      );
      if (error) throw new Error(error.message);

      const enriched = (statements ?? []).map((s: any) => {
        const paid = Number(s.amount_paid || 0);
        const pending = Number(s.statement_amount || 0) - paid;
        return { ...s, paid_amount: paid, pending_amount: pending, status: computeStatus(String(s.due_date), pending) };
      });
      return enriched;
    } catch (e) {
      this.handleError(e, 'list credit card statements');
    }
  }

  async create(body: any) {
    try {
      const { account_id, period_start, period_end, statement_date, due_date, statement_amount, amount_paid, payment_date, notes } = body ?? {};
      if (!account_id || !period_start || !period_end || !statement_date || !due_date) {
        return { status: 400 as const, body: { error: 'Missing required fields' } };
      }

      // Queried by month, not among the latest few: a back-dated statement must still find
      // the one already recorded for its month.
      const billingMonthStr = String(statement_date).slice(0, 7);
      const { data: sameMonth, error: lookupError } = await this.repo.listForAccount(String(account_id), {
        month: billingMonthStr,
        limit: 1,
      });
      if (lookupError) throw new Error(lookupError.message);
      if ((sameMonth ?? []).length > 0) {
        return {
          status: 409 as const,
          body: { error: `A statement already exists for this billing month (${billingMonthStr}). Edit the existing statement instead.` },
        };
      }

      const { data, error } = await this.repo.insert({
        account_id,
        period_start,
        period_end,
        statement_date,
        due_date,
        statement_amount: Number(statement_amount || 0),
        amount_paid: Number(amount_paid || 0),
        payment_date: payment_date ?? null,
        notes: notes ?? null,
      });
      if (error) throw new Error(error.message);

      // Deliberately does NOT write a portfolio snapshot. Statements and snapshots are
      // kept one-way: /portfolio/snapshots pulls a balance when asked, and nothing here
      // pushes one. See syncSnapshotForMonth.
      return { status: 200 as const, body: data };
    } catch (e) {
      this.handleError(e, 'create credit card statement');
    }
  }

  async update(body: any) {
    try {
      const { id, ...patch } = body ?? {};
      if (!id) return { status: 400 as const, body: { error: 'id is required' } };

      const { data, error } = await this.repo.update(String(id), {
        ...patch,
        ...(patch.statement_amount != null && { statement_amount: Number(patch.statement_amount) }),
        ...(patch.amount_paid != null && { amount_paid: Number(patch.amount_paid) }),
      });
      if (error) throw new Error(error.message);

      // No snapshot push — see create().
      return { status: 200 as const, body: data };
    } catch (e) {
      this.handleError(e, 'update credit card statement');
    }
  }

  async delete(id: string) {
    try {
      if (!id) return { status: 400 as const, body: { error: 'id is required' } };

      const { error } = await this.repo.delete(String(id));
      if (error) throw new Error(error.message);

      // No snapshot push — see create(). Any snapshot already taken from this statement
      // stays until /portfolio/snapshots is asked to sync that month again.
      return { status: 200 as const, body: { ok: true } };
    } catch (e) {
      this.handleError(e, 'delete credit card statement');
    }
  }
}

