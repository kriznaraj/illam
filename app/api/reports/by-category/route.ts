import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { ExpenseService } from '@/lib/services/ExpenseService';
import { CategoryService } from '@/lib/services/CategoryService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/by-category
 * Get expenses report for a specific category
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const expenseService = new ExpenseService(supabase);
    const categoryService = new CategoryService(supabase);

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('categoryId');

    if (!categoryId) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      );
    }

    // Get category details
    const category = await categoryService.getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    // Get all expenses for this category
    const expenses = await expenseService.getExpensesByCategory(categoryId);

    // Flatten tags for easier consumption
    type ExpenseWithTags = { expense_tags?: Array<{ tag: unknown }>; [key: string]: unknown };
    const expensesWithTags = expenses.map(expense => ({
      ...expense,
      tags: (expense as unknown as ExpenseWithTags).expense_tags?.map((et: { tag: unknown }) => et.tag).filter(Boolean) || []
    }));

    // Calculate totals
    const totalSpent = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const expenseCount = expenses.length;

    // Group by user
    const byUser: { [key: string]: { name: string; amount: number; count: number } } = {};
    expenses.forEach(expense => {
      const userId = expense.user?.id || 'unknown';
      const userName = expense.user?.full_name || expense.user?.username || 'Unknown';

      if (!byUser[userId]) {
        byUser[userId] = { name: userName, amount: 0, count: 0 };
      }
      byUser[userId].amount += expense.amount;
      byUser[userId].count += 1;
    });

    // Group by date (month)
    const byDate: { [key: string]: number } = {};
    expenses.forEach(expense => {
      const month = expense.date.substring(0, 7); // YYYY-MM
      byDate[month] = (byDate[month] || 0) + expense.amount;
    });

    // Recent expenses (last 10)
    const recentExpenses = expensesWithTags
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);

    return NextResponse.json({
      item: category,
      expenses: expensesWithTags,
      recentExpenses,
      totalSpent,
      expenseCount,
      byUser,
      byDate,
      byCategory: {}, // Empty since we're already filtering by this category
    });
  } catch (error) {
    console.error('Error in GET /api/reports/by-category:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate report' },
      { status: 500 }
    );
  }
}
