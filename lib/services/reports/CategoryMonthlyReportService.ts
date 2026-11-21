import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from '@/lib/services/BaseService';
import { CategoryMonthlyReportRepository } from '@/lib/repositories/reports/CategoryMonthlyReportRepository';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';

export class CategoryMonthlyReportService extends BaseService {
  private repo: CategoryMonthlyReportRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new CategoryMonthlyReportRepository(supabase);
  }

  async getReport(params: { monthsBack: number }) {
    try {
      const monthsBack = Number.isFinite(params.monthsBack) && params.monthsBack > 0 ? params.monthsBack : 12;

      const endDate = new Date();
      const startDate = subMonths(endDate, monthsBack - 1);
      const start = format(startOfMonth(startDate), 'yyyy-MM-dd');
      const end = format(endOfMonth(endDate), 'yyyy-MM-dd');

      const [{ data: expenses, error }, { data: categories }] = await Promise.all([
        this.repo.listExpenses(start, end),
        this.repo.listCategories(),
      ]);

      if (error) {
        return { status: 500 as const, body: { error: 'Failed to fetch expenses' } };
      }

      const months: string[] = [];
      for (let i = monthsBack - 1; i >= 0; i--) {
        const monthDate = subMonths(endDate, i);
        months.push(format(monthDate, 'yyyy-MM'));
      }

      type CategoryData = { id: string; name: string; color: string; icon?: string; group_name?: string };
      type CategoryRow = CategoryData;
      type ExpenseRow = {
        date: string;
        amount: number;
        category_id: string;
        categories?: CategoryData | CategoryData[];
      };
      const categoryMonthlyData: Record<
        string,
        { category: CategoryData; monthlyTotals: Record<string, number>; total: number }
      > = {};

      (categories as CategoryRow[] | null | undefined ?? []).forEach((category) => {
        categoryMonthlyData[category.id] = { category, monthlyTotals: {}, total: 0 };
        months.forEach((m) => (categoryMonthlyData[category.id].monthlyTotals[m] = 0));
      });

      (expenses as ExpenseRow[] | undefined)?.forEach((expense) => {
        const month = format(new Date(expense.date), 'yyyy-MM');
        const category = Array.isArray(expense.categories) ? expense.categories[0] : expense.categories;
        const categoryId = category?.id || expense.category_id;
        const amount = parseFloat(expense.amount.toString());

        if (categoryMonthlyData[categoryId]) {
          categoryMonthlyData[categoryId].monthlyTotals[month] += amount;
          categoryMonthlyData[categoryId].total += amount;
        }
      });

      const monthlyTotals: Record<string, number> = {};
      months.forEach((m) => (monthlyTotals[m] = 0));
      Object.values(categoryMonthlyData).forEach((catData) => {
        months.forEach((m) => (monthlyTotals[m] += catData.monthlyTotals[m]));
      });

      const groupedData: Record<
        string,
        Array<{ category: CategoryData; monthlyTotals: Record<string, number>; total: number }>
      > = {};

      Object.values(categoryMonthlyData).forEach((catData) => {
        const groupName = catData.category.group_name;
        if (!groupName) return;
        if (!groupedData[groupName]) groupedData[groupName] = [];
        groupedData[groupName].push(catData);
      });

      return {
        status: 200 as const,
        body: {
          months,
          groupedData,
          monthlyTotals,
          grandTotal: Object.values(monthlyTotals).reduce((sum, val) => sum + val, 0),
        },
      };
    } catch (e) {
      this.handleError(e, 'get category monthly report');
    }
  }
}

