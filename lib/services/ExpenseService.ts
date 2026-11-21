import { BaseService } from './BaseService';
import { ExpenseRepository } from '@/lib/repositories/ExpenseRepository';
import { Expense } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';
import { validateExpenseData } from '@/lib/utils/validation';
import { toExpenseWithFlattenedTags, toExpensesWithFlattenedTags } from '@/lib/expenses/transformers';
import { CategoryRepository } from '@/lib/repositories/CategoryRepository';
import { categoryFromHistory, type MerchantCategory } from '@/lib/expenses/merchantHistory';
import { matchCategoryByKeyword } from '@/lib/expenses/categoryMatcher';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { MATCH_WINDOW_DAYS } from '@/lib/inbox/automation/match';

/**
 * Expense Service
 * Handles all business logic for expenses
 * Uses ExpenseRepository for data access
 */
export class ExpenseService extends BaseService {
  private expenseRepo: ExpenseRepository;
  private inboxRepo: InboxRepository;

  constructor(private supabase: SupabaseClient) {
    super();
    this.expenseRepo = new ExpenseRepository(supabase);
    this.inboxRepo = new InboxRepository(supabase);
  }

  /**
   * An unconfirmed auto-added expense this hand entry duplicates. Never lets the
   * lookup block a normal add: before migration 030 the columns do not exist,
   * and a failed lookup must not stop anyone logging an expense.
   */
  private async findAutoAddedDuplicate(amount: number, date: string): Promise<Expense | null> {
    try {
      return await this.expenseRepo.findUnreviewedInboxExpense(amount, date, MATCH_WINDOW_DAYS);
    } catch (error) {
      this.warn('createExpense', 'Duplicate check against auto-added expenses skipped', error);
      return null;
    }
  }

  // ==================== CRUD Operations ====================

  /**
   * Get expense by ID
   */
  /**
   * Where a spend from `merchant` most likely belongs, with the reason, so the UI can offer it
   * rather than leave the person to find it. Same order the automation uses: what this
   * household confirmed for this exact payee first, then the offline keyword table.
   *
   * Returns null when neither has an answer — better an empty field the person fills than a
   * confident wrong guess.
   */
  async suggestCategory(
    merchant: string
  ): Promise<(MerchantCategory & { source: 'history' | 'keyword' }) | null> {
    const payee = merchant?.trim();
    if (!payee) return null;

    const prior = await this.expenseRepo.findByMerchant(payee);
    const decided = categoryFromHistory(payee, prior);
    if (decided) return { ...decided, source: 'history' };

    const categories = await new CategoryRepository(this.supabase).findAllSorted();
    const keyword = matchCategoryByKeyword(payee, categories);
    if (!keyword) return null;
    return {
      categoryId: keyword.categoryId,
      categoryName: keyword.categoryName,
      count: 0,
      lastUsed: '',
      source: 'keyword',
    };
  }

  async getExpenseById(id: string): Promise<Expense | null> {
    try {
      this.validateUUID(id, 'Expense ID');
      const expense = await this.expenseRepo.findById(id);
      return expense ? toExpenseWithFlattenedTags(expense) : null;
    } catch (error) {
      this.handleError(error, 'get expense by ID');
    }
  }

  /**
   * Get all expenses
   */
  async getAllExpenses(): Promise<Expense[]> {
    try {
      const expenses = await this.expenseRepo.findAll();
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get all expenses');
    }
  }

  /**
   * Create a new expense
   */
  async createExpense(data: Partial<Expense>): Promise<Expense> {
    try {
      // Validate expense data
      const validation = validateExpenseData({
        amount: data.amount,
        date: data.date,
        description: data.description,
        category_id: data.category_id,
        user_id: data.user_id,
      });

      if (!validation.valid) {
        throw new Error(validation.errors.join(', '));
      }

      // Logged by hand after Madal already auto-added the same spend: fold into
      // that row instead of creating a duplicate.
      if ((data.source ?? 'manual') === 'manual' && data.amount !== undefined && data.date) {
        const duplicate = await this.findAutoAddedDuplicate(Number(data.amount), data.date);
        if (duplicate) {
          this.log('createExpense', 'Merged into auto-added expense', { id: duplicate.id });
          return this.updateExpense(duplicate.id, {
            date: data.date,
            category_id: data.category_id,
            description: data.description,
            user_id: data.user_id,
            event_id: data.event_id ?? null,
            receipt_url: data.receipt_url ?? null,
            tag_ids: (data as any).tag_ids ?? [],
            needs_review: false,
          } as Partial<Expense>);
        }
      }

      // Extract tag_ids if present
      const tagIds = (data as any).tag_ids || [];

      // Create the expense with tags
      const expense = await this.expenseRepo.createWithTags(data, tagIds);

      this.log('createExpense', 'Expense created successfully', {
        id: expense.id,
        amount: expense.amount,
        tagsCount: tagIds.length,
      });

      return toExpenseWithFlattenedTags(expense);
    } catch (error) {
      this.handleError(error, 'create expense');
    }
  }

  /**
   * Update an expense
   */
  async updateExpense(id: string, data: Partial<Expense>): Promise<Expense> {
    try {
      this.validateUUID(id, 'Expense ID');

      // Validate updated fields
      if (data.amount !== undefined) {
        this.validatePositiveNumber(data.amount, 'Amount');
      }

      if (data.date !== undefined) {
        this.validateDate(data.date, 'Date');
      }

      // Extract tag_ids if present
      const tagIds = (data as any).tag_ids;

      // Remove tag_ids from update data to avoid column error
      const { tag_ids, expense_tags, tags, ...cleanData } = data as any;

      // Update the expense
      const expense = await this.expenseRepo.update(id, cleanData);

      // Update tags if provided
      if (tagIds !== undefined) {
        await this.expenseRepo.updateTags(id, tagIds);
      }

      this.log('updateExpense', 'Expense updated successfully', { id });

      // Confirming an auto-added expense settles its Madal item too.
      if (data.needs_review === false && expense.inbox_item_id) {
        try {
          await this.inboxRepo.clearAttention(expense.inbox_item_id);
        } catch (error) {
          this.warn('updateExpense', 'Could not clear the inbox item', error);
        }
      }

      // Return with updated tags
      const expenseWithTags = (await this.expenseRepo.findById(id)) || expense;
      return toExpenseWithFlattenedTags(expenseWithTags);
    } catch (error) {
      this.handleError(error, 'update expense');
    }
  }

  /**
   * Delete an expense
   */
  async deleteExpense(id: string): Promise<void> {
    try {
      this.validateUUID(id, 'Expense ID');
      await this.expenseRepo.delete(id);

      this.log('deleteExpense', 'Expense deleted successfully', { id });
    } catch (error) {
      this.handleError(error, 'delete expense');
    }
  }

  /**
   * Delete multiple expenses
   */
  async deleteExpenses(ids: string[]): Promise<void> {
    try {
      if (!ids || ids.length === 0) {
        throw new Error('No expense IDs provided');
      }

      ids.forEach((id) => this.validateUUID(id, 'Expense ID'));
      await this.expenseRepo.deleteMany(ids);

      this.log('deleteExpenses', 'Multiple expenses deleted', { count: ids.length });
    } catch (error) {
      this.handleError(error, 'delete multiple expenses');
    }
  }

  // ==================== Query Operations ====================

  /**
   * Flatten expense_tags to tags array for easier consumption
   */
  private flattenTags(expenses: Expense[]): Expense[] {
    return toExpensesWithFlattenedTags(expenses);
  }

  /**
   * Get expenses by date range
   */
  async getExpensesByDateRange(startDate: string, endDate: string): Promise<Expense[]> {
    try {
      this.validateDate(startDate, 'Start date');
      this.validateDate(endDate, 'End date');

      const expenses = await this.expenseRepo.findByDateRange(startDate, endDate);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get expenses by date range');
    }
  }

  /**
   * Get expenses by category
   */
  async getExpensesByCategory(categoryId: string): Promise<Expense[]> {
    try {
      this.validateUUID(categoryId, 'Category ID');
      const expenses = await this.expenseRepo.findByCategory(categoryId);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get expenses by category');
    }
  }

  /**
   * Get expenses by user
   */
  async getExpensesByUser(userId: string): Promise<Expense[]> {
    try {
      this.validateUUID(userId, 'User ID');
      const expenses = await this.expenseRepo.findByUser(userId);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get expenses by user');
    }
  }

  /**
   * Get expenses by event
   */
  async getExpensesByEvent(eventId: string): Promise<Expense[]> {
    try {
      this.validateUUID(eventId, 'Event ID');
      const expenses = await this.expenseRepo.findByEvent(eventId);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get expenses by event');
    }
  }

  /**
   * Get expenses without an event
   */
  async getExpensesWithoutEvent(): Promise<Expense[]> {
    try {
      const expenses = await this.expenseRepo.findWithoutEvent();
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get expenses without event');
    }
  }

  /**
   * Get expenses by tags
   */
  async getExpensesByTags(tagIds: string[]): Promise<Expense[]> {
    try {
      if (!tagIds || tagIds.length === 0) {
        throw new Error('No tag IDs provided');
      }

      tagIds.forEach((id) => this.validateUUID(id, 'Tag ID'));
      const expenses = await this.expenseRepo.findByTags(tagIds);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get expenses by tags');
    }
  }

  /**
   * Get expenses by month (YYYY-MM format)
   */
  async getExpensesByMonth(monthKey: string): Promise<Expense[]> {
    try {
      if (!/^\d{4}-\d{2}$/.test(monthKey)) {
        throw new Error('Month must be in YYYY-MM format');
      }

      const expenses = await this.expenseRepo.findByMonth(monthKey);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get expenses by month');
    }
  }

  /**
   * Get recent expenses
   */
  async getRecentExpenses(days: number = 7, limit: number = 50): Promise<Expense[]> {
    try {
      this.validatePositiveNumber(days, 'Days');
      this.validatePositiveNumber(limit, 'Limit');

      const expenses = await this.expenseRepo.getRecent(days, limit);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get recent expenses');
    }
  }

  /**
   * Search expenses by description
   */
  async searchExpenses(searchTerm: string, limit: number = 50): Promise<Expense[]> {
    try {
      if (!searchTerm || searchTerm.trim().length === 0) {
        throw new Error('Search term is required');
      }

      const expenses = await this.expenseRepo.searchByDescription(searchTerm, limit);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'search expenses');
    }
  }

  /**
   * Get expenses with filters
   */
  async getExpensesWithFilters(filters: {
    startDate?: string;
    endDate?: string;
    categoryId?: string;
    userId?: string;
    eventId?: string | 'none';
    limit?: number;
  }): Promise<Expense[]> {
    try {
      // Validate dates if provided
      if (filters.startDate) {
        this.validateDate(filters.startDate, 'Start date');
      }
      if (filters.endDate) {
        this.validateDate(filters.endDate, 'End date');
      }

      // Validate UUIDs if provided
      if (filters.categoryId) {
        this.validateUUID(filters.categoryId, 'Category ID');
      }
      if (filters.userId) {
        this.validateUUID(filters.userId, 'User ID');
      }
      if (filters.eventId && filters.eventId !== 'none') {
        this.validateUUID(filters.eventId, 'Event ID');
      }

      const expenses = await this.expenseRepo.findByFilters(filters);
      return this.flattenTags(expenses);
    } catch (error) {
      this.handleError(error, 'get expenses with filters');
    }
  }

  // ==================== Business Logic / Calculations ====================

  /**
   * Calculate total by category in date range
   */
  async calculateTotalByCategory(
    categoryId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    try {
      this.validateUUID(categoryId, 'Category ID');
      this.validateDate(startDate, 'Start date');
      this.validateDate(endDate, 'End date');

      return await this.expenseRepo.getTotalByCategory(categoryId, startDate, endDate);
    } catch (error) {
      this.handleError(error, 'calculate total by category');
    }
  }

  /**
   * Calculate total by user in date range
   */
  async calculateTotalByUser(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    try {
      this.validateUUID(userId, 'User ID');
      this.validateDate(startDate, 'Start date');
      this.validateDate(endDate, 'End date');

      return await this.expenseRepo.getTotalByUser(userId, startDate, endDate);
    } catch (error) {
      this.handleError(error, 'calculate total by user');
    }
  }

  /**
   * Calculate total in date range
   */
  async calculateTotal(startDate: string, endDate: string): Promise<number> {
    try {
      this.validateDate(startDate, 'Start date');
      this.validateDate(endDate, 'End date');

      return await this.expenseRepo.getTotalInRange(startDate, endDate);
    } catch (error) {
      this.handleError(error, 'calculate total');
    }
  }

  /**
   * Calculate monthly average for a category
   */
  async calculateMonthlyAverage(categoryId: string, months: number = 6): Promise<number> {
    try {
      this.validateUUID(categoryId, 'Category ID');
      this.validatePositiveNumber(months, 'Months');

      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      const expenses = await this.expenseRepo.findByCategory(categoryId);
      const filtered = expenses.filter((e) => {
        const expenseDate = new Date(e.date);
        return expenseDate >= startDate && expenseDate <= endDate;
      });

      const total = filtered.reduce((sum, e) => sum + e.amount, 0);
      return total / months;
    } catch (error) {
      this.handleError(error, 'calculate monthly average');
    }
  }

  /**
   * Get expense count by category
   */
  async getExpenseCountByCategory(categoryId: string): Promise<number> {
    try {
      this.validateUUID(categoryId, 'Category ID');
      return await this.expenseRepo.getCountByCategory(categoryId);
    } catch (error) {
      this.handleError(error, 'get expense count by category');
    }
  }

  /**
   * Calculate statistics for expenses in date range
   */
  async calculateStatistics(
    startDate: string,
    endDate: string
  ): Promise<{
    total: number;
    count: number;
    average: number;
    min: number;
    max: number;
  }> {
    try {
      this.validateDate(startDate, 'Start date');
      this.validateDate(endDate, 'End date');

      const expenses = await this.expenseRepo.findByDateRange(startDate, endDate);

      if (expenses.length === 0) {
        return { total: 0, count: 0, average: 0, min: 0, max: 0 };
      }

      const amounts = expenses.map((e) => e.amount);
      const total = amounts.reduce((sum, amount) => sum + amount, 0);
      const count = expenses.length;
      const average = total / count;
      const min = Math.min(...amounts);
      const max = Math.max(...amounts);

      return { total, count, average, min, max };
    } catch (error) {
      this.handleError(error, 'calculate statistics');
    }
  }

  /**
   * Check if an expense can be deleted
   * Business rule: Add any restrictions here
   */
  async canDelete(id: string): Promise<{ canDelete: boolean; reason?: string }> {
    try {
      const expense = await this.getExpenseById(id);

      if (!expense) {
        return { canDelete: false, reason: 'Expense not found' };
      }

      // Add business rules here
      // For example: can't delete expenses older than X months
      // Or: can't delete if part of a locked accounting period

      return { canDelete: true };
    } catch (error) {
      this.handleError(error, 'check if expense can be deleted');
    }
  }

  /**
   * Bulk create expenses
   */
  async createBulkExpenses(expenses: Partial<Expense>[]): Promise<Expense[]> {
    try {
      if (!expenses || expenses.length === 0) {
        throw new Error('No expenses provided');
      }

      // Validate all expenses
      for (const expense of expenses) {
        const validation = validateExpenseData({
          amount: expense.amount,
          date: expense.date,
          description: expense.description,
          category_id: expense.category_id,
          user_id: expense.user_id,
        });

        if (!validation.valid) {
          throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }
      }

      // Clean tag_ids from all expenses before bulk insert
      const cleanExpenses = expenses.map(expense => {
        const { tag_ids, expense_tags, tags, ...cleanData } = expense as any;
        return cleanData;
      });

      // Create all expenses
      const created = await this.expenseRepo.createMany(cleanExpenses);

      // Link tags for each expense if provided
      for (let i = 0; i < expenses.length; i++) {
        const tagIds = (expenses[i] as any).tag_ids;
        if (tagIds && tagIds.length > 0) {
          await this.expenseRepo.linkTags(created[i].id, tagIds);
        }
      }

      this.log('createBulkExpenses', 'Bulk expenses created', {
        count: created.length,
      });

      return created;
    } catch (error) {
      this.handleError(error, 'create bulk expenses');
    }
  }
}
