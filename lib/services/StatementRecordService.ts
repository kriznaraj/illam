import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { StatementReconcileService, type ReconcileOutcome } from './StatementReconcileService';
import { CreditCardOverviewRepository, type CreditCardAccountRow } from '@/lib/repositories/CreditCardOverviewRepository';
import { CreditCardStatementRepository } from '@/lib/repositories/CreditCardStatementRepository';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { evaluateAttention } from '@/lib/inbox/attention';
import { formatMoney } from '@/lib/inbox/display';
import { formatters } from '@/lib/utils/dateUtils';
import type { ParsedCardStatement } from '@/lib/statements/cardStatements';
import type { InboxCardStatementData, InboxOwner } from '@/types';

export type CardStatementOutcome =
  | { status: 'created' | 'filled' | 'unchanged'; statementId: string; accountId: string; reconcile?: ReconcileOutcome }
  | { status: 'amount_mismatch'; statementId: string; accountId: string; recorded: number; parsed: number; reconcile?: ReconcileOutcome }
  | { status: 'unknown_card'; last4: string | null }
  | { status: 'incomplete'; missing: string[] };

export interface StatementItemRef {
  id: string;
  receivedDate: string;
  /** Whose expenses the statement's unmatched lines become; without it lines are not reconciled. */
  owner?: InboxOwner;
}

/** Rupees of difference below which a hand-entered amount and a parsed one agree. */
const AMOUNT_TOLERANCE = 1;

/**
 * Turns a parsed card statement into the record the Cards page reads
 * (`credit_card_statements`), and gives its Madal item the real dues.
 *
 * Hand-entered figures win: an existing statement for the same card and month is
 * only filled where empty, and a different amount is flagged, never overwritten.
 */
export class StatementRecordService extends BaseService {
  private accounts: CreditCardOverviewRepository;
  private statements: CreditCardStatementRepository;
  private inbox: InboxRepository;
  private reconciler: StatementReconcileService;

  constructor(supabase: SupabaseClient) {
    super();
    this.accounts = new CreditCardOverviewRepository(supabase);
    this.statements = new CreditCardStatementRepository(supabase);
    this.inbox = new InboxRepository(supabase);
    this.reconciler = new StatementReconcileService(supabase);
  }

  async recordCardStatement(parsed: ParsedCardStatement, item: StatementItemRef): Promise<CardStatementOutcome> {
    const missing = (['statementDate', 'dueDate', 'totalDue'] as const).filter((key) => parsed[key] === null);
    if (missing.length > 0) return { status: 'incomplete', missing };
    const statementDate = parsed.statementDate as string;
    const dueDate = parsed.dueDate as string;
    const totalDue = parsed.totalDue as number;

    const { data: accountRows, error: accountsError } = await this.accounts.listActiveCreditCardAccounts();
    if (accountsError) throw new Error(`Failed to load credit cards: ${accountsError.message}`);
    const account = matchCard((accountRows ?? []) as CreditCardAccountRow[], parsed.last4);

    if (!account) {
      await this.updateItem(item, parsed, { reason: `Card ••${parsed.last4 ?? '????'} is not in Selvam` });
      return { status: 'unknown_card', last4: parsed.last4 };
    }

    const { data: existingRows, error: listError } = await this.statements.listForAccount(account.id, {
      month: statementDate.slice(0, 7),
    });
    if (listError) throw new Error(`Failed to load statements: ${listError.message}`);
    const existing = existingRows?.[0];

    if (!existing) {
      const { data, error } = await this.statements.insert({
        account_id: account.id,
        period_start: parsed.periodStart ?? statementDate,
        period_end: parsed.periodEnd ?? statementDate,
        statement_date: statementDate,
        due_date: dueDate,
        statement_amount: totalDue,
        amount_paid: 0,
        payment_date: null,
        notes: 'From emailed statement',
      });
      if (error) throw new Error(`Failed to record statement: ${error.message}`);
      const statementId = String((data as { id: string }).id);
      const reconcile = await this.reconcile(parsed, account.id, statementId, item);
      await this.updateItem(item, parsed, { statementId, paid: totalDue <= 0, reconcile });
      return { status: 'created', statementId, accountId: account.id, ...(reconcile ? { reconcile } : {}) };
    }

    const recorded = Number(existing.statement_amount ?? 0);
    const paid = Number(existing.amount_paid ?? 0) >= Math.max(recorded, totalDue) - AMOUNT_TOLERANCE;

    const reconcile = await this.reconcile(parsed, account.id, existing.id, item);
    const withReconcile = reconcile ? { reconcile } : {};

    if (recorded > 0 && Math.abs(recorded - totalDue) > AMOUNT_TOLERANCE) {
      await this.updateItem(item, parsed, {
        statementId: existing.id,
        reason: `Statement ${formatMoney(totalDue, 'INR')} vs entered ${formatMoney(recorded, 'INR')}`,
        reconcile,
      });
      return { status: 'amount_mismatch', statementId: existing.id, accountId: account.id, recorded, parsed: totalDue, ...withReconcile };
    }

    if (recorded <= 0) {
      const { error } = await this.statements.update(existing.id, { statement_amount: totalDue });
      if (error) throw new Error(`Failed to fill statement: ${error.message}`);
    }
    await this.updateItem(item, parsed, { statementId: existing.id, paid, reconcile });
    return { status: recorded <= 0 ? 'filled' : 'unchanged', statementId: existing.id, accountId: account.id, ...withReconcile };
  }

  /** Reconcile the statement's lines with expenses; a failure is reported, never fatal to recording. */
  private async reconcile(
    parsed: ParsedCardStatement,
    accountId: string,
    statementId: string,
    item: StatementItemRef
  ): Promise<ReconcileOutcome | undefined> {
    if (!item.owner) return undefined;
    try {
      return await this.reconciler.reconcile({
        statementId,
        accountId,
        owner: item.owner,
        bank: parsed.bank,
        last4: parsed.last4,
        transactions: parsed.transactions,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.warn('StatementRecordService.reconcile', `statement ${statementId}`, reason);
      return { status: 'skipped', reason };
    }
  }

  /** Give the Madal item the parsed dues, and attention that reflects the record. */
  private async updateItem(
    item: StatementItemRef,
    parsed: ParsedCardStatement,
    outcome: { statementId?: string; paid?: boolean; reason?: string; reconcile?: ReconcileOutcome }
  ): Promise<void> {
    const data: InboxCardStatementData = {
      kind: 'card_statement',
      bank: parsed.bank,
      last4: parsed.last4,
      statementDate: parsed.statementDate,
      totalDue: parsed.totalDue,
      minDue: parsed.minDue,
      dueDate: parsed.dueDate,
      passwordProtected: true,
    };
    const attention = outcome.reason
      ? { needsAttention: true, reason: outcome.reason, actionBy: parsed.dueDate }
      : outcome.paid
        ? { needsAttention: false, reason: null, actionBy: null }
        : evaluateAttention(data, item.receivedDate);

    await this.inbox.updateItem(item.id, {
      data,
      summary: [
        parsed.dueDate ? `Due ${formatters.toFullDate(parsed.dueDate)}` : null,
        parsed.last4 ? `••${parsed.last4}` : null,
        reconcileLabel(outcome.reconcile),
      ]
        .filter(Boolean)
        .join(' · '),
      needs_attention: attention.needsAttention,
      attention_reason: attention.reason,
      action_by: attention.actionBy,
      consumed: outcome.statementId
        ? { action: 'statement_recorded', statement_id: outcome.statementId, at: new Date().toISOString() }
        : null,
    });
  }
}

/** "16 matched, 1 added for review" — what reconciling the statement's lines did. */
function reconcileLabel(reconcile: ReconcileOutcome | undefined): string | null {
  if (reconcile?.status !== 'reconciled') return null;
  const { matched, added, unmatched } = reconcile.counts;
  return [`${matched} matched`, added ? `${added} added for review` : null, unmatched ? `${unmatched} unmatched` : null]
    .filter(Boolean)
    .join(', ');
}

/** A card account whose `details.last4` — or, failing that, whose name — carries these digits. */
export function matchCard(accounts: CreditCardAccountRow[], last4: string | null): CreditCardAccountRow | null {
  if (!last4) return null;
  const byDetails = accounts.find((account) => String(account.details?.last4 ?? '') === last4);
  if (byDetails) return byDetails;
  return accounts.find((account) => new RegExp(`(?:^|\\D)${last4}(?:\\D|$)`).test(account.name)) ?? null;
}
