import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { HomeStatsRepository } from '@/lib/repositories/HomeStatsRepository';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { toAppTimezoneDate, parseAppDate } from '@/lib/utils/dateUtils';

export class HomeStatsService extends BaseService {
  private repo: HomeStatsRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.repo = new HomeStatsRepository(supabase);
  }

  async getHomeStats(now: Date = new Date()) {
    try {
      // Anchor to the APP_TIMEZONE calendar day. The server runs in UTC, so a
      // raw `now` puts 00:00-05:30 IST on the previous day -- which shows
      // yesterday's todos, and on the 1st reports last month's spend as this month's.
      const todayYmd = toAppTimezoneDate(now);
      const today = parseAppDate(todayYmd);
      const startDate = format(startOfMonth(today), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(today), 'yyyy-MM-dd');

      const [
        { data: expenses },
        { data: recentExpenses },
        { data: latestSnapshots },
        { data: prevSnapshots },
        { data: todayTodos },
      ] = await Promise.all([
        this.repo.listMonthlyExpenses(startDate, endDate),
        this.repo.listRecentExpenses(10),
        this.repo.latestSnapshotsPerAccount(),
        this.repo.prevSnapshotsPerAccount(),
        this.repo.listTodayOpenTodos(todayYmd, 5),
      ]);

      const monthlyExpenses = expenses?.reduce((sum: number, exp: any) => sum + parseFloat(exp.amount.toString()), 0) ?? 0;
      const expenseCount = expenses?.length ?? 0;

      const netWorth = (latestSnapshots ?? []).reduce((sum: number, s: { amount: number }) => sum + s.amount, 0);
      const previousNetWorth = (prevSnapshots ?? []).reduce((sum: number, s: { amount: number }) => sum + s.amount, 0);

      const netWorthGrowth =
        previousNetWorth > 0 ? ((netWorth - previousNetWorth) / Math.abs(previousNetWorth)) * 100 : 0;

      const recentExpensesWithTags = (recentExpenses ?? []).map((expense: any) => ({
        ...expense,
        tags: expense.expense_tags?.map((et: { tag: unknown }) => et.tag).filter(Boolean) || [],
      }));

      return {
        monthlyExpenses,
        expenseCount,
        netWorth,
        netWorthGrowth,
        recentExpenses: recentExpensesWithTags,
        todayTodos: todayTodos ?? [],
        todayTodoCount: todayTodos?.length ?? 0,
      };
    } catch (error) {
      this.handleError(error, 'get home stats');
    }
  }
}

