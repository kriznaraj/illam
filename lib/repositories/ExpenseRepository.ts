import { BaseRepository } from './BaseRepository';
import { Expense } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';
import { format, subDays, parseISO } from 'date-fns';
import { getTodayAppDate } from '@/lib/utils/dateUtils';
import type { ExpenseCandidate } from '@/lib/inbox/automation/match';
import type { ReconcileExpense } from '@/lib/statements/reconcile';
import { normaliseMerchant, type PriorExpense } from '@/lib/expenses/merchantHistory';
import { awaitsDecision } from '@/lib/expenses/autoTag';

/**
 * Expense Repository
 * Handles all data access for expenses
 */
export class ExpenseRepository extends BaseRepository<Expense> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'expenses');
  }

  /**
   * Create expense with tags
   * Overrides base create to handle tag relationships
   */
  async createWithTags(expenseData: Partial<Expense>, tagIds?: string[]): Promise<Expense> {
    // Extract tag_ids from expenseData to avoid inserting it as a column
    const { tag_ids, expense_tags, tags, ...cleanExpenseData } = expenseData as any;

    // Use tag_ids from parameter or from expenseData
    const tagsToLink = tagIds || tag_ids || [];

    // Create the expense using parent method (without tag_ids)
    const expense = await this.create(cleanExpenseData);

    // Link tags if provided
    if (tagsToLink.length > 0) {
      await this.linkTags(expense.id, tagsToLink);
    }

    // Return with tags populated
    return await this.findById(expense.id) || expense;
  }

  /**
   * Link tags to an expense
   */
  async linkTags(expenseId: string, tagIds: string[]): Promise<void> {
    if (!tagIds || tagIds.length === 0) return;

    const expenseTags = tagIds.map(tagId => ({
      expense_id: expenseId,
      tag_id: tagId,
    }));

    const { error } = await this.supabase
      .from('expense_tags')
      .insert(expenseTags);

    if (error) {
      throw new Error(`Failed to link tags to expense: ${error.message}`);
    }
  }

  /**
   * Unlink all tags from an expense
   */
  async unlinkAllTags(expenseId: string): Promise<void> {
    const { error } = await this.supabase
      .from('expense_tags')
      .delete()
      .eq('expense_id', expenseId);

    if (error) {
      throw new Error(`Failed to unlink tags from expense: ${error.message}`);
    }
  }

  /**
   * Update expense tags
   */
  async updateTags(expenseId: string, tagIds: string[]): Promise<void> {
    // Remove all existing tags
    await this.unlinkAllTags(expenseId);

    // Add new tags
    if (tagIds.length > 0) {
      await this.linkTags(expenseId, tagIds);
    }
  }

  /**
   * Define the select query with all necessary joins
   */
  protected getSelectQuery(): string {
    return `
      *,
      category:categories(*),
      user:users(id, username, full_name, email, icon),
      event:expense_events(*),
      expense_tags(
        id,
        tag:tags(*)
      )
    `;
  }

  /**
   * Find expenses by date range
   */
  async findByDateRange(startDate: string, endDate: string): Promise<Expense[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch expenses by date range: ${error.message}`);
    }

    return (data as unknown as Expense[]) || [];
  }

  /**
   * Amount, date and planning group of every expense in [startDate, endDate] — the cash-flow
   * report's spending. Paged, because a year (with the pre-2025-12 monthly rollups) passes
   * PostgREST's 1,000-row cap and a silently truncated total is worse than a slow one.
   */
  async findAmountsByDateRange(
    startDate: string,
    endDate: string
  ): Promise<{ date: string; amount: number; category: string | null; group: string | null }[]> {
    const PAGE = 1000;
    const rows: { date: string; amount: number; category: string | null; group: string | null }[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await this.withRetry(async () => {
        const res = await this.supabase
          .from(this.tableName)
          .select('id, date, amount, category:categories(name, group_name)')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date')
          .order('id')
          .range(offset, offset + PAGE - 1);
        if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
        return res;
      });
      if (error) throw new Error(`Failed to fetch expenses by date range: ${error.message}`);
      const page = (data ?? []) as unknown as { date: string; amount: number; category: { name: string; group_name: string | null } | null }[];
      rows.push(...page.map((row) => ({ date: row.date, amount: Number(row.amount), category: row.category?.name ?? null, group: row.category?.group_name ?? null })));
      if (page.length < PAGE) return rows;
    }
  }

  /**
   * Find expenses by category
   */
  async findByCategory(categoryId: string): Promise<Expense[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('category_id', categoryId)
      .order('date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch expenses by category: ${error.message}`);
    }

    return (data as unknown as Expense[]) || [];
  }

  /**
   * Find expenses by user
   */
  async findByUser(userId: string): Promise<Expense[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch expenses by user: ${error.message}`);
    }

    return (data as unknown as Expense[]) || [];
  }

  /**
   * Find expenses by event
   */
  async findByEvent(eventId: string): Promise<Expense[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .eq('event_id', eventId)
      .order('date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch expenses by event: ${error.message}`);
    }

    return (data as unknown as Expense[]) || [];
  }

  /**
   * Find expenses without an event
   */
  async findWithoutEvent(): Promise<Expense[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .is('event_id', null)
      .order('date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch expenses without event: ${error.message}`);
    }

    return (data as unknown as Expense[]) || [];
  }

  /**
   * Find expenses by tags
   */
  async findByTags(tagIds: string[]): Promise<Expense[]> {
    const { data, error } = await this.supabase
      .from('expense_tags')
      .select(`
        expense:expenses(
          ${this.getSelectQuery()}
        )
      `)
      .in('tag_id', tagIds);

    if (error) {
      throw new Error(`Failed to fetch expenses by tags: ${error.message}`);
    }

    // Extract expenses from the nested structure
    const expenses = (data as unknown as Array<{ expense: Expense | null }>)
      ?.map((item) => item.expense)
      .filter((expense): expense is Expense => expense !== null);

    return expenses || [];
  }

  /**
   * The slim rows alert matching needs (lib/inbox/automation/match.ts), across
   * both users, for a date window.
   */
  async findMatchCandidates(startDate: string, endDate: string): Promise<ExpenseCandidate[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('id, date, amount, user_id, created_at, inbox_item_id')
        .gte('date', startDate)
        .lte('date', endDate)
        .limit(5000);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch expenses for matching: ${error.message}`);
    }
    return ((data ?? []) as unknown as ExpenseCandidate[]).map((row) => ({ ...row, amount: Number(row.amount) }));
  }

  /**
   * Everything already on record for one payee, for `categoryFromHistory`.
   *
   * Matched on `merchant` and on `description`, because a spend typed in by hand before Madal
   * existed carries the payee only in its description. `ilike` is exact bar case — no wildcard —
   * so a near-name never borrows another payee's category; the trimming and case rules live in
   * `normaliseMerchant`, and the filter here only has to be no narrower than it.
   */
  async findByMerchant(merchant: string, limit = 60): Promise<PriorExpense[]> {
    const payee = normaliseMerchant(merchant);
    if (payee.length < 3) return [];
    const escaped = payee.replace(/[%_,()]/g, ' ');

    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('date, merchant, description, category_id, needs_review, category:categories(name)')
        .or(`merchant.ilike.${escaped},description.ilike.${escaped}`)
        .order('date', { ascending: false })
        .limit(limit);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    // A payee with no history is the normal case, not a problem worth failing an add over.
    if (error) {
      console.warn(`ExpenseRepository.findByMerchant(${payee}):`, error.message);
      return [];
    }

    return ((data ?? []) as unknown as (Omit<PriorExpense, 'category_name'> & { category?: { name?: string } | null })[])
      .map((row) => ({
        date: String(row.date),
        merchant: row.merchant ?? null,
        description: row.description ?? null,
        category_id: String(row.category_id),
        category_name: row.category?.name ?? '',
        needs_review: row.needs_review === true,
      }))
      .filter((row) => row.category_name !== '');
  }

  /**
   * The alerts behind auto-added expenses still awaiting a decision — unlooked-at and filed
   * nowhere useful (`awaitsDecision`), dated on or after `since`. Madal's To-do reads these.
   */
  async findUndecidedInboxItemIds(since: string): Promise<string[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('inbox_item_id, needs_review, category:categories(name)')
        .eq('needs_review', true)
        .not('inbox_item_id', 'is', null)
        .gte('date', since)
        .limit(500);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch expenses awaiting a category: ${error.message}`);
    }
    return ((data ?? []) as unknown as { inbox_item_id: string; needs_review: boolean; category?: { name?: string } | null }[])
      .filter((row) => awaitsDecision(row))
      .map((row) => row.inbox_item_id);
  }

  /** The auto-added expenses that still await a decision (Miscellaneous), with what the AI step needs. */
  async findUndecidedInboxExpenses(
    since: string
  ): Promise<{ id: string; merchant: string | null; description: string; amount: number; category_id: string; inbox_item_id: string }[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('id, merchant, description, amount, category_id, inbox_item_id, needs_review, category:categories(name)')
        .eq('needs_review', true)
        .not('inbox_item_id', 'is', null)
        .gte('date', since)
        .limit(200);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });
    if (error) throw new Error(`Failed to fetch expenses awaiting a category: ${error.message}`);
    type Row = { id: string; merchant: string | null; description: string; amount: number; category_id: string; inbox_item_id: string; needs_review: boolean; category?: { name?: string } | null };
    return ((data ?? []) as unknown as Row[]).filter((row) => awaitsDecision(row));
  }

  /** Expenses in a date range with what statement reconciliation reads and may enrich. */
  async findReconcileCandidates(startDate: string, endDate: string): Promise<ReconcileExpense[]> {
    const { data, error } = await this.withRetry(async () => {
      const res = await this.supabase
        .from(this.tableName)
        .select('id, date, amount, user_id, created_at, inbox_item_id, merchant, payment_method, description, source, needs_review')
        .gte('date', startDate)
        .lte('date', endDate)
        .limit(5000);
      if (res.error && this.isTransientSupabaseError(res.error)) throw res.error;
      return res;
    });

    if (error) {
      throw new Error(`Failed to fetch expenses for reconciliation: ${error.message}`);
    }
    return ((data ?? []) as unknown as ReconcileExpense[]).map((row) => ({ ...row, amount: Number(row.amount) }));
  }

  /**
   * An auto-added, unconfirmed expense a hand-entered one duplicates: same amount,
   * within `windowDays` of `date`. Closest date first.
   */
  async findUnreviewedInboxExpense(amount: number, date: string, windowDays: number): Promise<Expense | null> {
    const day = parseISO(date);
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('id, date, amount, inbox_item_id')
      .in('source', ['inbox', 'statement'])
      .eq('needs_review', true)
      .eq('amount', amount)
      .gte('date', format(subDays(day, windowDays), 'yyyy-MM-dd'))
      .lte('date', format(subDays(day, -windowDays), 'yyyy-MM-dd'));

    if (error) {
      throw new Error(`Failed to look for an auto-added duplicate: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as Expense[];
    rows.sort(
      (a, b) => Math.abs(parseISO(a.date).getTime() - day.getTime()) - Math.abs(parseISO(b.date).getTime() - day.getTime())
    );
    return rows[0] ?? null;
  }

  /**
   * Find expenses by multiple filters
   */
  async findByFilters(filters: {
    startDate?: string;
    endDate?: string;
    categoryId?: string;
    userId?: string;
    eventId?: string | 'none';
    limit?: number;
  }): Promise<Expense[]> {
    let query = this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (filters.startDate) {
      query = query.gte('date', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('date', filters.endDate);
    }

    if (filters.categoryId) {
      query = query.eq('category_id', filters.categoryId);
    }

    if (filters.userId) {
      query = query.eq('user_id', filters.userId);
    }

    if (filters.eventId) {
      if (filters.eventId === 'none') {
        query = query.is('event_id', null);
      } else {
        query = query.eq('event_id', filters.eventId);
      }
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch expenses with filters: ${error.message}`);
    }

    return (data as unknown as Expense[]) || [];
  }

  /**
   * Get total amount by category in date range
   */
  async getTotalByCategory(
    categoryId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('amount')
      .eq('category_id', categoryId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      throw new Error(`Failed to calculate total by category: ${error.message}`);
    }

    return data?.reduce((sum, item) => sum + item.amount, 0) || 0;
  }

  /**
   * Get total amount by user in date range
   */
  async getTotalByUser(userId: string, startDate: string, endDate: string): Promise<number> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('amount')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      throw new Error(`Failed to calculate total by user: ${error.message}`);
    }

    return data?.reduce((sum, item) => sum + item.amount, 0) || 0;
  }

  /**
   * Get total amount in date range
   */
  async getTotalInRange(startDate: string, endDate: string): Promise<number> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('amount')
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      throw new Error(`Failed to calculate total in range: ${error.message}`);
    }

    return data?.reduce((sum, item) => sum + item.amount, 0) || 0;
  }

  /**
   * Get expense count by category
   */
  async getCountByCategory(categoryId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    if (error) {
      throw new Error(`Failed to count expenses by category: ${error.message}`);
    }

    return count || 0;
  }

  /**
   * Get recent expenses (last N days)
   */
  async getRecent(days: number = 7, limit: number = 50): Promise<Expense[]> {
    const startDateStr = format(subDays(parseISO(getTodayAppDate()), days), 'yyyy-MM-dd');

    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .gte('date', startDateStr)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch recent expenses: ${error.message}`);
    }

    return (data as unknown as Expense[]) || [];
  }

  /**
   * Search expenses by description
   */
  async searchByDescription(searchTerm: string, limit: number = 50): Promise<Expense[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select(this.getSelectQuery())
      .ilike('description', `%${searchTerm}%`)
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to search expenses: ${error.message}`);
    }

    return (data as unknown as Expense[]) || [];
  }

  /**
   * Get expenses by month (YYYY-MM format)
   */
  async findByMonth(monthKey: string): Promise<Expense[]> {
    const startDate = `${monthKey}-01`;
    const endDate = `${monthKey}-31`; // Works for all months

    return this.findByDateRange(startDate, endDate);
  }

  /**
   * Delete expenses by event ID
   */
  async deleteByEvent(eventId: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('event_id', eventId);

    if (error) {
      throw new Error(`Failed to delete expenses by event: ${error.message}`);
    }
  }
}
