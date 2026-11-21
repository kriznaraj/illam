import type { Expense, Tag } from '@/types';

type ExpenseTagRow = {
  tag?: Tag | null;
};

export const toExpenseWithFlattenedTags = (expense: Expense): Expense => {
  const rows = Array.isArray(expense.expense_tags) ? (expense.expense_tags as ExpenseTagRow[]) : [];
  const tags = rows
    .map((row) => row?.tag)
    .filter((tag): tag is Tag => Boolean(tag));

  return {
    ...expense,
    tags,
  };
};

export const toExpensesWithFlattenedTags = (expenses: Expense[]): Expense[] => {
  return expenses.map(toExpenseWithFlattenedTags);
};
