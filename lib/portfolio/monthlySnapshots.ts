/**
 * Reducing `portfolio_snapshots` to one balance per account per month.
 *
 * `snapshot_date` is unique per (account, **date**), not per (account, month). The
 * convention is one row on the 1st, but a few sit mid-month: an account can carry
 * both a 02-01 and a 02-27 row.
 *
 * Summing every row in a month therefore counts those accounts twice — lakhs of
 * phantom value, which shows on /portfolio/types/Stocks as a one-month spike far
 * above the months either side. The latest date within the month is the only
 * correct reading.
 *
 * `preparePortfolioData` in lib/insights/portfolioRules.ts already did this, which is
 * why the insights pages were right while the dashboard and the type pages were not.
 * This is that rule, in one place.
 */

export interface DatedSnapshot {
  account_id: string;
  /** yyyy-MM-dd */
  snapshot_date: string;
  amount: number;
}

const monthOf = (isoDate: string) => String(isoDate).slice(0, 7);

/**
 * accountId → (yyyy-MM → the winning row), keeping the latest `snapshot_date` in each
 * month. Returns the row itself for callers that need its id or units — editing or
 * deleting a month's snapshot has to act on the row actually being shown.
 */
export function latestRowPerAccountMonth<T extends DatedSnapshot>(
  snapshots: T[]
): Map<string, Map<string, T>> {
  const byAccount = new Map<string, Map<string, T>>();

  for (const snapshot of snapshots) {
    const month = monthOf(snapshot.snapshot_date);

    let series = byAccount.get(snapshot.account_id);
    if (!series) {
      series = new Map<string, T>();
      byAccount.set(snapshot.account_id, series);
    }

    const incumbent = series.get(month);
    // `>=` would let an equal date overwrite; rows are unique per date, so keeping
    // the first of an exact tie is arbitrary but stable.
    if (incumbent !== undefined && incumbent.snapshot_date >= snapshot.snapshot_date) continue;
    series.set(month, snapshot);
  }

  return byAccount;
}

/**
 * accountId → (yyyy-MM → balance), keeping the latest `snapshot_date` in each month.
 */
export function latestPerAccountMonth(snapshots: DatedSnapshot[]): Map<string, Map<string, number>> {
  const byAccount = new Map<string, Map<string, number>>();

  for (const [accountId, rows] of latestRowPerAccountMonth(snapshots)) {
    const series = new Map<string, number>();
    for (const [month, row] of rows) series.set(month, Number(row.amount));
    byAccount.set(accountId, series);
  }

  return byAccount;
}

/**
 * Like `latestPerAccountMonth`, but every account also has a balance in each of `months`
 * after its first snapshot: a month without a row holds the last known balance. A month's
 * statements arrive over several days, so on the 10th most accounts have no row yet;
 * reading them as zero makes net worth look like it collapsed. This is the rule
 * `preparePortfolioData` (lib/insights/portfolioRules.ts) and PortfolioReportService use.
 */
export function carriedPerAccountMonth(
  snapshots: DatedSnapshot[],
  months?: string[]
): Map<string, Map<string, number>> {
  const byAccount = latestPerAccountMonth(snapshots);
  const allMonths =
    months ?? Array.from(new Set(Array.from(byAccount.values()).flatMap((series) => Array.from(series.keys())))).sort();
  const carried = new Map<string, Map<string, number>>();

  for (const [accountId, series] of byAccount) {
    const filled = new Map<string, number>();
    let last: number | undefined;
    for (const month of allMonths) {
      const value = series.get(month);
      if (value !== undefined) last = value;
      if (last !== undefined) filled.set(month, last);
    }
    carried.set(accountId, filled);
  }

  return carried;
}

/**
 * yyyy-MM → total across accounts, deduped. `accountIds` narrows to a subset
 * (one account type, say); omit it to total everything. With `carryForward`, an account
 * with no row in a month counts at its last known balance (see `carriedPerAccountMonth`).
 */
export function monthlyTotals(
  snapshots: DatedSnapshot[],
  accountIds?: Iterable<string>,
  options: { carryForward?: boolean } = {}
): Map<string, number> {
  const only = accountIds ? new Set(accountIds) : null;
  const included = only ? snapshots.filter((s) => only.has(s.account_id)) : snapshots;
  // Carried over every month in the data, not just the subset's: a type whose accounts
  // are all still unrecorded this month still has a this-month value.
  const allMonths = Array.from(new Set(snapshots.map((s) => monthOf(s.snapshot_date)))).sort();
  const byAccount = options.carryForward
    ? carriedPerAccountMonth(included, allMonths)
    : latestPerAccountMonth(included);
  const totals = new Map<string, number>();

  for (const series of byAccount.values()) {
    for (const [month, amount] of series) {
      totals.set(month, (totals.get(month) ?? 0) + amount);
    }
  }

  return new Map(Array.from(totals.entries()).sort(([a], [b]) => a.localeCompare(b)));
}
