import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from '@/lib/services/BaseService';
import { TagReportRepository } from '@/lib/repositories/reports/TagReportRepository';

export class TagReportService extends BaseService {
  private repo: TagReportRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new TagReportRepository(supabase);
  }

  async getTagReport(params: { tagId: string; startDate?: string; endDate?: string }) {
    try {
      this.validateUUID(params.tagId, 'Tag ID');

      const { data: tag, error: tagError } = await this.repo.getTag(params.tagId);
      if (tagError || !tag) {
        return { status: 404 as const, body: { error: 'Tag not found' } };
      }

      const { data: links, error: linksError } = await this.repo.listExpenseIdsForTag(params.tagId);
      if (linksError) {
        return { status: 500 as const, body: { error: 'Failed to fetch expenses' } };
      }

      const expenseIds = (links ?? []).map((l: any) => l.expense_id).filter(Boolean);
      if (expenseIds.length === 0) {
        return {
          status: 200 as const,
          body: { tag, expenses: [], totalSpent: 0, expenseCount: 0, byCategory: {}, byUser: {}, byDate: {} },
        };
      }

      const { data: expenses, error: expensesError } = await this.repo.listExpensesByIds(
        expenseIds,
        params.startDate,
        params.endDate
      );
      if (expensesError) {
        return { status: 500 as const, body: { error: 'Failed to fetch expenses' } };
      }

      const safeExpenses: any[] = Array.isArray(expenses) ? expenses : [];
      const totalSpent = safeExpenses.reduce((sum, exp) => sum + parseFloat(exp.amount.toString()), 0);

      const byCategory: Record<string, { name: string; amount: number; color: string; count: number }> = {};
      safeExpenses.forEach((exp) => {
        if (!exp.category) return;
        if (!byCategory[exp.category.id]) {
          byCategory[exp.category.id] = { name: exp.category.name, amount: 0, color: exp.category.color, count: 0 };
        }
        byCategory[exp.category.id].amount += parseFloat(exp.amount.toString());
        byCategory[exp.category.id].count += 1;
      });

      const byUser: Record<string, { name: string; amount: number; count: number }> = {};
      const userIds = [...new Set(safeExpenses.map((e) => e.user_id).filter(Boolean))];
      const { data: users } = userIds.length > 0 ? await this.repo.listUsersByIds(userIds) : { data: [] as any[] };
      const userMap = new Map((users ?? []).map((u: any) => [u.id, u.full_name]));

      safeExpenses.forEach((exp) => {
        if (!exp.user_id) return;
        const userId = exp.user_id;
        if (!byUser[userId]) {
          byUser[userId] = { name: userMap.get(userId) || 'Unknown User', amount: 0, count: 0 };
        }
        byUser[userId].amount += parseFloat(exp.amount.toString());
        byUser[userId].count += 1;
      });

      const byDate: Record<string, number> = {};
      safeExpenses.forEach((exp) => {
        byDate[exp.date] = (byDate[exp.date] || 0) + parseFloat(exp.amount.toString());
      });

      return {
        status: 200 as const,
        body: {
          tag,
          expenses: safeExpenses,
          totalSpent,
          expenseCount: safeExpenses.length,
          byCategory,
          byUser,
          byDate,
        },
      };
    } catch (error) {
      this.handleError(error, 'get tag report');
    }
  }
}

