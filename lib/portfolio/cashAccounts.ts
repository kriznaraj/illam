/**
 * Cash accounts sit outside the investment boundary.
 *
 * Net worth sums every account, the salary and savings accounts included. A ₹40,000
 * move from the salary account to a brokerage therefore leaves net worth where it was,
 * so it cannot also be "money you added" — subtracting it anyway understated market
 * gain by every such transfer. Contributions are measured at the edge of the
 * *investment* accounts instead: money crossing into them from cash (or straight from
 * payroll, like EPF) is a contribution, and a move within either side is not.
 *
 * `portfolio_accounts.is_cash` is nullable. NULL means "decide from the
 * type"; true/false is an explicit override, such as the Prepaid account named Cash.
 */

export const CASH_TYPE_NAMES: readonly string[] = ['Saving Account', 'Salary Account'];

export function isCashAccount(account: {
  type: string | null | undefined;
  name?: string | null;
  is_cash?: boolean | null;
}): boolean {
  if (typeof account.is_cash === 'boolean') return account.is_cash;
  if (account.type != null && CASH_TYPE_NAMES.includes(account.type)) return true;
  // Until 033 is applied the column is absent: the one Prepaid account that is literally cash.
  return /^cash$/i.test(account.name?.trim() ?? '');
}
