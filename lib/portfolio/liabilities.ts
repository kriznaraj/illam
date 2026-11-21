import type { PortfolioAccount, PortfolioAccountType } from '@/types';

/**
 * Liability accounts hold money *owed*, not money held.
 *
 * Every net-worth figure in the app is a plain `sum(portfolio_snapshots.amount)` —
 * `lib/portfolio/dashboardCalculations.ts`, `PortfolioReportService`, and the two
 * RPCs that exist only in the database (`get_latest_snapshots_per_account`,
 * `get_prev_snapshots_per_account`). A liability balance stored positive is
 * therefore *added* to net worth instead of subtracted, making the error worth
 * twice the balance.
 *
 * The sign is normalised here, on the write path, rather than at each read site:
 * two of those read sites are SQL functions that live only in the database, so a
 * read-side fix could never be complete.
 *
 * See migration 028.
 */

/**
 * Used when `portfolio_account_types.is_liability` cannot be read — i.e. before
 * migration 028 has been applied by hand in the Supabase SQL editor. The column
 * is the real source of truth; this list only keeps the app correct in the gap.
 */
export const FALLBACK_LIABILITY_TYPE_NAMES: readonly string[] = ['Credit Card', 'Loan'];

/** Account type names that are liabilities, given the rows loaded from the database. */
export function liabilityTypeNames(types: Pick<PortfolioAccountType, 'name' | 'is_liability'>[] | null): Set<string> {
  if (!types || types.length === 0) return new Set(FALLBACK_LIABILITY_TYPE_NAMES);

  // Pre-migration the column is absent, so every row reads as undefined. Falling
  // back on "no type is a liability" would silently reintroduce the sign bug.
  const flagged = types.filter((t) => t.is_liability === true).map((t) => t.name);
  if (flagged.length > 0) return new Set(flagged);

  const columnMissing = types.every((t) => t.is_liability === undefined || t.is_liability === null);
  return columnMissing ? new Set(FALLBACK_LIABILITY_TYPE_NAMES) : new Set();
}

export function isLiabilityType(typeName: string | null | undefined, liabilityTypes: Set<string>): boolean {
  return typeName != null && liabilityTypes.has(typeName);
}

export function isLiabilityAccount(
  account: Pick<PortfolioAccount, 'type'> | null | undefined,
  liabilityTypes: Set<string>
): boolean {
  return isLiabilityType(account?.type, liabilityTypes);
}

/**
 * The amount as it must be stored. Liabilities are always negative, whatever sign
 * the caller supplied — the statement sync passes a positive statement total, and
 * a human typing into `/portfolio/snapshots` should not have to remember a minus.
 *
 * Zero has no sign to preserve; `-Math.abs(0)` is `-0`, which serialises to `-0`
 * in JSON and reads as a bug, so it is normalised back to `0`.
 */
export function normalizeSnapshotAmount(amount: number, isLiability: boolean): number {
  if (!isLiability) return amount;
  const owed = -Math.abs(amount);
  return owed === 0 ? 0 : owed;
}

/**
 * How much is owed, as a positive number, for display. Liability snapshots are
 * stored negative; showing "-42,150 owed" reads as a double negative.
 */
export function amountOwed(storedAmount: number): number {
  return Math.abs(storedAmount);
}
