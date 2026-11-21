import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from '@/lib/services/BaseService';
import { EventReportRepository } from '@/lib/repositories/reports/EventReportRepository';

export class EventReportService extends BaseService {
  private repo: EventReportRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new EventReportRepository(supabase);
  }

  async getEventReport(params: { eventId: string }) {
    try {
      this.validateUUID(params.eventId, 'Event ID');

      const { data: event, error: eventError } = await this.repo.getEvent(params.eventId);
      if (eventError || !event) {
        return { status: 404 as const, body: { error: 'Event not found' } };
      }

      const { data: expenses, error: expensesError } = await this.repo.listExpenses(params.eventId);
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
          event,
          expenses: safeExpenses,
          totalSpent,
          expenseCount: safeExpenses.length,
          byCategory,
          byUser,
          byDate,
          budgetRemaining: event.budget ? event.budget - totalSpent : null,
          budgetUsedPercent: event.budget ? (totalSpent / event.budget) * 100 : null,
        },
      };
    } catch (error) {
      this.handleError(error, 'get event report');
    }
  }
}

