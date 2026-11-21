import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioSnapshotService } from './PortfolioSnapshotService';
import { statementAccountIds } from '@/lib/household';
import { deriveSnapshotDate } from '@/lib/utils';
import type { InboxOwner } from '@/types';
import type { StatementLine } from '@/lib/statements/accountStatements';

/** One account's month-end balance as a statement printed it. */
export interface StatementBalance {
  last4: string;
  closing: number;
  /** The statement's own figures for this account agree with each other. */
  reconciled: boolean;
  /** Its transaction lines, when the reader reads them and every one reconciled. */
  lines?: StatementLine[];
}

export interface BalanceStatement {
  /** yyyy-MM-dd the balances are as of. */
  periodTo: string | null;
  balances: StatementBalance[];
}

export type BalanceResult =
  | { last4: string; status: 'applied'; accountId: string; amount: number }
  /** Read, but no Selvam account is mapped to it (the member's `statementAccounts`). */
  | { last4: string; status: 'unmapped'; amount: number }
  | { last4: string; status: 'not_reconciled'; amount: number }
  | { last4: string; status: 'failed'; message: string };

export type BalanceApplyOutcome =
  | { status: 'done'; snapshotDate: string; results: BalanceResult[] }
  /** Only a statement ending on a month end is that month's close. */
  | { status: 'not_month_end'; periodTo: string | null };

/** "2026-07-31" is a month end; "2026-07-15" is not. */
export function isMonthEnd(date: string | null): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate() === day;
}

/**
 * Applies the month-end balances an emailed statement prints (bank accounts, NPS)
 * to the Selvam accounts the member's `statementAccounts` maps them to.
 *
 * Like the CAS (CasImportService), the statement replaces that month's snapshot: it
 * is the exact close, where a hand-entered value is the balance on whatever day it
 * was typed. And like the CAS, only an account whose own figures reconcile is
 * applied. The snapshot is the 1st of the following month — a snapshot dated the 1st
 * is the previous month's close (CLAUDE.md, *Insights*).
 */
export class StatementBalanceService extends BaseService {
  private snapshots: PortfolioSnapshotService;

  constructor(
    supabase: SupabaseClient,
    private mapping: Partial<Record<InboxOwner, Record<string, string>>> = statementAccountIds()
  ) {
    super();
    this.snapshots = new PortfolioSnapshotService(supabase);
  }

  async apply(owner: InboxOwner, sourceId: string, statement: BalanceStatement): Promise<BalanceApplyOutcome> {
    if (!isMonthEnd(statement.periodTo)) return { status: 'not_month_end', periodTo: statement.periodTo };
    const snapshotDate = deriveSnapshotDate(statement.periodTo) as string;

    const results: BalanceResult[] = [];
    for (const balance of statement.balances) {
      const accountId = this.mapping[owner]?.[`${sourceId}:${balance.last4}`];
      if (!accountId) {
        results.push({ last4: balance.last4, status: 'unmapped', amount: balance.closing });
        continue;
      }
      if (!balance.reconciled) {
        results.push({ last4: balance.last4, status: 'not_reconciled', amount: balance.closing });
        continue;
      }
      try {
        await this.snapshots.upsert({ account_id: accountId, snapshot_date: snapshotDate, amount: balance.closing });
        results.push({ last4: balance.last4, status: 'applied', accountId, amount: balance.closing });
      } catch (error) {
        results.push({ last4: balance.last4, status: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    }
    this.log('StatementBalanceService.apply', `${sourceId} ${snapshotDate}: ${results.map((r) => `••${r.last4} ${r.status}`).join(', ')}`);
    return { status: 'done', snapshotDate, results };
  }
}
