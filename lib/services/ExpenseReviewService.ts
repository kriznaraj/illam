import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { BaseService } from './BaseService';
import { ExpenseRepository } from '@/lib/repositories/ExpenseRepository';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { StatementTransactionRepository } from '@/lib/repositories/StatementTransactionRepository';
import type { ReconcileExpense } from '@/lib/statements/reconcile';
import { invalidateInsightsCache } from '@/lib/cache-invalidation';
import { parseAppDate } from '@/lib/utils/dateUtils';
import type { Expense } from '@/types';

/** How far either side of a review expense to look for the expense it repeats. */
export const DUPLICATE_WINDOW_DAYS = 3;

const shiftDays = (date: string, days: number) => format(addDays(parseAppDate(date), days), 'yyyy-MM-dd');

/**
 * What a person can do with an expense Madal added for review, besides confirming it:
 * say it repeats one already logged (merge), or that it was not spending (dismiss).
 * Either way the alert and statement lines behind it are settled, so nothing adds it
 * back on the next sync or statement.
 *
 * Both of these move real money: an auto-added row counts from the
 * moment it exists, so merging or rejecting one changes its month's total and insights.
 */
export class ExpenseReviewService extends BaseService {
  private expenses: ExpenseRepository;
  private inbox: InboxRepository;
  private lines: StatementTransactionRepository;

  constructor(private supabase: SupabaseClient) {
    super();
    this.expenses = new ExpenseRepository(supabase);
    this.inbox = new InboxRepository(supabase);
    this.lines = new StatementTransactionRepository(supabase);
  }

  /** Expenses of the same amount within three days: confirmed ones first, then the closest date. */
  async duplicateCandidates(id: string): Promise<ReconcileExpense[]> {
    const expense = await this.requireReviewExpense(id);
    const amount = Number(expense.amount);
    const rows = await this.expenses.findReconcileCandidates(
      shiftDays(expense.date, -DUPLICATE_WINDOW_DAYS),
      shiftDays(expense.date, DUPLICATE_WINDOW_DAYS)
    );
    const days = (row: ReconcileExpense) => Math.abs(differenceInCalendarDays(parseAppDate(row.date), parseAppDate(expense.date)));
    return rows
      .filter((row) => row.id !== expense.id && Math.abs(row.amount - amount) < 0.005)
      .sort((a, b) => Number(a.needs_review) - Number(b.needs_review) || days(a) - days(b));
  }

  /** The review expense repeats `keepId`: its alert and statement lines move there, then it goes. */
  async mergeInto(id: string, keepId: string): Promise<void> {
    if (id === keepId) throw new Error('An expense cannot be merged into itself');
    const duplicate = await this.requireReviewExpense(id);
    this.validateUUID(keepId, 'Expense to keep');
    const keep = await this.expenses.findById(keepId);
    if (!keep) throw new Error('Expense to keep not found');
    if (Math.abs(Number(keep.amount) - Number(duplicate.amount)) >= 0.005) {
      throw new Error('Only an expense of the same amount can be merged');
    }

    await this.lines.repointExpense(duplicate.id, keep.id);
    // Deleted before the kept expense takes its alert: one alert, one expense (unique index).
    await this.expenses.delete(duplicate.id);

    const patch: Partial<Expense> = {};
    if (!keep.payment_method && duplicate.payment_method) patch.payment_method = duplicate.payment_method;
    if (!keep.merchant && duplicate.merchant) patch.merchant = duplicate.merchant;
    if (!keep.inbox_item_id && duplicate.inbox_item_id) patch.inbox_item_id = duplicate.inbox_item_id;
    if (Object.keys(patch).length > 0) await this.expenses.update(keep.id, patch);

    if (duplicate.inbox_item_id) {
      await this.inbox.updateConsumed(
        duplicate.inbox_item_id,
        { action: 'linked', expense_id: keep.id, at: new Date().toISOString() },
        { needs_attention: false, attention_reason: null }
      );
    }

    // The duplicate was counted from the moment it was created, so removing
    // it moves both months. Before 036 an unconfirmed row was in no total and this was a no-op.
    await invalidateInsightsCache(this.supabase, duplicate.date);
    if (keep.date !== duplicate.date) await invalidateInsightsCache(this.supabase, keep.date);
  }

  /** Not spending after all: the expense goes, and its alert and statement lines are marked ignored. */
  async dismiss(id: string): Promise<void> {
    const expense = await this.requireReviewExpense(id);
    await this.lines.ignoreExpense(expense.id);
    await this.expenses.delete(expense.id);
    if (expense.inbox_item_id) {
      await this.inbox.updateConsumed(
        expense.inbox_item_id,
        { action: 'ignored', reason: 'not an expense (reviewed)', at: new Date().toISOString() },
        { needs_attention: false, attention_reason: null }
      );
    }

    // Rejecting is what takes the money back out of the month, so the cache must go too.
    await invalidateInsightsCache(this.supabase, expense.date);
  }

  private async requireReviewExpense(id: string): Promise<Expense> {
    this.validateUUID(id, 'Expense ID');
    const expense = await this.expenses.findById(id);
    if (!expense) throw new Error('Expense not found');
    if (!expense.needs_review) throw new Error('Only an expense awaiting review can be merged or dismissed');
    return expense;
  }
}
