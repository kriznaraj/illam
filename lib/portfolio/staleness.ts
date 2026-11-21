import { STALE_MONTHS, MIN_MATERIAL_RUPEES } from '@/lib/insights/portfolioRules';
import { latestPerAccountMonth } from './monthlySnapshots';

/**
 * Which accounts have been sitting at the same balance long enough that the number
 * on screen is no longer telling you anything.
 *
 * The `stale-snapshots` insight already reports this, but it reports it on
 * `/portfolio/insights` — a page you visit to read conclusions, not on
 * `/portfolio/snapshots`, the one page where you can actually do something about it.
 * A typical household has several such accounts — a property valued once and untouched
 * for over a year, or an SGB holding nobody has updated in years.
 *
 * Thresholds are shared with the insight rule so the two never disagree.
 */

export interface StaleAccountInput {
  id: string;
  name: string;
  type: string;
  is_active?: boolean;
}

export interface StaleSnapshotInput {
  account_id: string;
  /** yyyy-MM-dd */
  snapshot_date: string;
  amount: number;
}

export interface StaleAccount {
  accountId: string;
  name: string;
  type: string;
  amount: number;
  /** Consecutive snapshotted months, inclusive, at this same balance. */
  monthsAtSameValue: number;
  /** yyyy-MM the balance last changed to its current value. */
  since: string;
}

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

export function findStaleAccounts(params: {
  accounts: StaleAccountInput[];
  snapshots: StaleSnapshotInput[];
  /** yyyy-MM; months after this are ignored, so past months can be reviewed too. */
  asOfMonth: string;
  minMonths?: number;
  minAmount?: number;
}): StaleAccount[] {
  const { accounts, snapshots, asOfMonth } = params;
  const minMonths = params.minMonths ?? STALE_MONTHS;
  const minAmount = params.minAmount ?? MIN_MATERIAL_RUPEES;

  // One balance per (account, month), latest date wins — the shared rule in
  // lib/portfolio/monthlySnapshots.ts.
  const byAccount = latestPerAccountMonth(
    snapshots.filter((s) => monthOf(s.snapshot_date) <= asOfMonth)
  );

  const stale: StaleAccount[] = [];

  for (const account of accounts) {
    if (account.is_active === false) continue;

    const series = byAccount.get(account.id);
    if (!series) continue;

    const months = Array.from(series.keys()).sort();
    if (months.length === 0) continue;

    const latest = series.get(months[months.length - 1])!;
    if (Math.abs(latest) < minAmount) continue;

    // Walk back while the balance is unchanged. Only snapshotted months count, so a
    // gap in the history is not mistaken for a frozen balance.
    let run = 0;
    for (let i = months.length - 1; i >= 0; i--) {
      if (series.get(months[i])! !== latest) break;
      run++;
    }
    if (run < minMonths) continue;

    stale.push({
      accountId: account.id,
      name: account.name,
      type: account.type,
      amount: latest,
      monthsAtSameValue: run,
      since: months[months.length - run],
    });
  }

  // Biggest frozen number first — that is the one worth chasing.
  return stale.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}
