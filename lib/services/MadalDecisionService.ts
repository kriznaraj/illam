import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { MadalDecisionRepository } from '@/lib/repositories/MadalDecisionRepository';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import { ExpenseRepository } from '@/lib/repositories/ExpenseRepository';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { CommitmentPaymentRepository } from '@/lib/repositories/CommitmentRepository';
import { invalidateInsightsCache } from '@/lib/cache-invalidation';
import type { Commitment, MadalDecision, Transfer, TransferKind } from '@/types';

/** The transfer fields a decision changes, and so the ones an undo puts back. */
const TRANSFER_FIELDS = ['kind', 'account_id', 'portfolio_investment_id', 'note', 'status', 'sip_fund', 'sip_month', 'counterparty'] as const;
type TransferSnapshot = Pick<Transfer, (typeof TRANSFER_FIELDS)[number]>;

type InvestmentRow = Record<string, unknown> & { id: string; transfer_id: string | null };
type RemovedInvestment = { row: InvestmentRow; removal: 'deleted' | 'unlinked' };

/** An expense row as stored, with its tags — everything Undo needs to put it back. */
export type ExpenseRow = Record<string, unknown> & {
  id: string;
  date: string;
  amount: number;
  inbox_item_id: string | null;
  expense_tags?: { tag_id: string }[] | null;
};

interface CommittedBefore {
  expense: Record<string, unknown>;
  tag_ids: string[];
  /** The payment this decision created; null when the due month was already recorded as paid. */
  payment_id: string | null;
}

interface TransferBefore {
  transfer: TransferSnapshot;
  investments: RemovedInvestment[];
}

function snapshot(transfer: Transfer): TransferSnapshot {
  return Object.fromEntries(TRANSFER_FIELDS.map((field) => [field, transfer[field] ?? null])) as TransferSnapshot;
}

/**
 * Decisions Madal takes on its own, each recorded with what it takes to undo it (migration 039).
 *
 * The rule: no To-do item unless the Claude API couldn't resolve it. That makes
 * two kinds of change automatic — Claude classifying a waiting transfer from quoted evidence, and
 * a bank statement's proof refiling a filed one — and both have to be reversible by a person who
 * disagrees. The decision row is written *before* the change: a change with no undo record must
 * not happen, so a missing table (039 unapplied) leaves everything as it was.
 */
export class MadalDecisionService extends BaseService {
  private decisions: MadalDecisionRepository;
  private transfers: TransferRepository;
  private expenses: ExpenseRepository;
  private inbox: InboxRepository;
  private payments: CommitmentPaymentRepository;

  constructor(private supabase: SupabaseClient) {
    super();
    this.decisions = new MadalDecisionRepository(supabase);
    this.transfers = new TransferRepository(supabase);
    this.expenses = new ExpenseRepository(supabase);
    this.inbox = new InboxRepository(supabase);
    this.payments = new CommitmentPaymentRepository(supabase);
  }

  /**
   * A filed transfer the statement proves went to the other person becomes a household transfer.
   * A contribution row the transfer itself created is deleted; one it only linked (a hand entry,
   * an auto-monthly row) is unlinked; a SIP claim is released.
   */
  async refileAsFamily(transfer: Transfer, input: { note: string; reason: string; evidence: string }): Promise<MadalDecision> {
    const investment = await this.investmentOf(transfer.id);
    const removal: RemovedInvestment | null = investment
      ? { row: investment, removal: this.createdBy(investment, transfer) ? 'deleted' : 'unlinked' }
      : null;

    const decision = await this.decisions.record({
      inbox_item_id: transfer.inbox_item_id,
      transfer_id: transfer.id,
      expense_id: null,
      decided_by: 'statement',
      action: 'refiled',
      kind: 'family',
      reason: input.reason,
      evidence: input.evidence,
      evidence_key: input.evidence,
      before: { transfer: snapshot(transfer), investments: removal ? [removal] : [] } satisfies TransferBefore,
      model: null,
    });

    try {
      if (removal?.removal === 'deleted') await this.deleteInvestment(removal.row.id);
      if (removal?.removal === 'unlinked') await this.setInvestmentTransfer(removal.row.id, null);
      await this.transfers.update(transfer.id, {
        kind: 'family',
        account_id: null,
        portfolio_investment_id: null,
        sip_fund: null,
        sip_month: null,
        note: input.note,
        status: 'confirmed',
      });
    } catch (error) {
      // Half-done is worse than not done: put back what moved, and drop the record.
      await this.restoreTransfer(transfer.id, { transfer: snapshot(transfer), investments: removal ? [removal] : [] }).catch(() => undefined);
      await this.decisions.delete(decision.id).catch(() => undefined);
      throw error;
    }
    return decision;
  }

  /** Claude's classification of a waiting transfer, applied: one transfer row, nothing else. */
  async classify(
    transfer: Transfer,
    input: { kind: TransferKind; reason: string; evidence: string; evidenceKey: string; model: string | null }
  ): Promise<MadalDecision> {
    const decision = await this.decisions.record({
      inbox_item_id: transfer.inbox_item_id,
      transfer_id: transfer.id,
      expense_id: null,
      decided_by: 'claude',
      action: 'classified',
      kind: input.kind,
      reason: input.reason,
      evidence: input.evidence,
      evidence_key: input.evidenceKey,
      before: { transfer: snapshot(transfer), investments: [] } satisfies TransferBefore,
      model: input.model,
    });
    try {
      await this.transfers.update(transfer.id, { kind: input.kind, status: 'confirmed' });
      if (transfer.inbox_item_id) await this.inbox.clearAttention(transfer.inbox_item_id);
    } catch (error) {
      await this.decisions.delete(decision.id).catch(() => undefined);
      throw error;
    }
    return decision;
  }

  /** Claude was not sure: kept so the To-do item opens with its answer filled in. */
  async suggest(
    transfer: Transfer,
    input: { kind: string; reason: string; evidence: string | null; evidenceKey: string; model: string | null }
  ): Promise<void> {
    await this.decisions.record({
      inbox_item_id: transfer.inbox_item_id,
      transfer_id: transfer.id,
      expense_id: null,
      decided_by: 'claude',
      action: 'suggested',
      kind: input.kind,
      reason: input.reason,
      evidence: input.evidence,
      evidence_key: input.evidenceKey,
      before: {},
      model: input.model,
    });
  }

  /** The AI step re-filing an auto-added expense left in Miscellaneous. */
  async categorise(
    expense: { id: string; category_id: string; inbox_item_id: string | null },
    input: { categoryId: string; categoryName: string; reason: string; evidenceKey: string; model: string | null }
  ): Promise<void> {
    const decision = await this.decisions.record({
      inbox_item_id: expense.inbox_item_id,
      transfer_id: null,
      expense_id: expense.id,
      decided_by: 'claude',
      action: 'categorised',
      kind: input.categoryId,
      reason: input.reason,
      evidence: input.categoryName,
      evidence_key: input.evidenceKey,
      before: { category_id: expense.category_id },
      model: input.model,
    });
    try {
      // needs_review stays: an AI pick is not the household's answer until someone touches it.
      await this.expenses.update(expense.id, { category_id: input.categoryId });
    } catch (error) {
      await this.decisions.delete(decision.id).catch(() => undefined);
      throw error;
    }
  }

  /** The AI step looked at an undecided expense and had no confident answer: not asked again for the same payee. */
  async noteExpenseTried(
    expense: { id: string; inbox_item_id: string | null },
    input: { reason: string; evidenceKey: string; model: string | null }
  ): Promise<void> {
    await this.decisions.record({
      inbox_item_id: expense.inbox_item_id,
      transfer_id: null,
      expense_id: expense.id,
      decided_by: 'claude',
      action: 'suggested',
      kind: null,
      reason: input.reason,
      evidence: null,
      evidence_key: input.evidenceKey,
      before: {},
      model: input.model,
    });
  }

  /**
   * An expense that is really a commitment's instalment (a premium, an EMI) becomes that payment:
   * recorded against its due month, the expense removed, and its alert consumed as the commitment's
   * so automation never re-adds it. Undo puts the expense, its tags and its alert back.
   */
  async commitExpense(expense: ExpenseRow, match: { commitment: Commitment; dueMonth: string }): Promise<MadalDecision> {
    const { expense_tags, ...row } = expense;
    // Joined objects are not columns; only the row's own fields go back in on Undo.
    const columns = Object.fromEntries(Object.entries(row).filter(([, value]) => value === null || typeof value !== 'object'));
    const tagIds = (expense_tags ?? []).map((t) => t.tag_id);
    const before: CommittedBefore = { expense: columns, tag_ids: tagIds, payment_id: null };

    const decision = await this.decisions.record({
      inbox_item_id: expense.inbox_item_id,
      transfer_id: null,
      expense_id: expense.id,
      decided_by: 'statement',
      action: 'committed',
      kind: match.commitment.id,
      reason: `This is the ${match.commitment.name} instalment for ${match.dueMonth} — a commitment, not spending — so it was moved out of expenses.`,
      evidence: [expense.description, expense.merchant].filter(Boolean).join(' · ') || null,
      evidence_key: `${match.commitment.id}|${match.dueMonth}`,
      before: { ...before } as unknown as Record<string, unknown>,
      model: null,
    });

    try {
      const { payment, created } = await this.payments.recordOnce({
        commitment_id: match.commitment.id,
        due_month: match.dueMonth,
        paid_date: expense.date,
        amount: Number(expense.amount),
        source: expense.inbox_item_id ? 'alert' : 'manual',
        inbox_item_id: expense.inbox_item_id,
        transfer_id: null,
        note: 'Moved from expenses',
      });
      if (created) {
        before.payment_id = payment.id;
        await this.decisions.update(decision.id, { before: { ...before } as unknown as Record<string, unknown> });
      }
      await this.deleteExpense(expense.id);
      if (expense.inbox_item_id) {
        await this.inbox.updateConsumed(
          expense.inbox_item_id,
          { action: 'ignored', reason: `commitment: ${match.commitment.name}`, at: new Date().toISOString() },
          { needs_attention: false, attention_reason: null }
        );
      }
    } catch (error) {
      if (before.payment_id) await this.payments.delete(before.payment_id).catch(() => undefined);
      await this.decisions.delete(decision.id).catch(() => undefined);
      throw error;
    }
    await invalidateInsightsCache(this.supabase, expense.date);
    return decision;
  }

  /** Put a decision back exactly as it was. The row stays, stamped, so it is not taken again. */
  async undo(id: string, now: Date = new Date()): Promise<MadalDecision> {
    const decision = await this.decisions.findById(id);
    if (!decision) throw new Error('Decision not found');
    if (decision.undone_at) throw new Error('This decision is already undone');

    switch (decision.action) {
      case 'refiled':
      case 'classified': {
        if (!decision.transfer_id) throw new Error('This decision has no transfer to restore');
        await this.restoreTransfer(decision.transfer_id, decision.before as unknown as TransferBefore);
        break;
      }
      case 'categorised': {
        if (!decision.expense_id) throw new Error('This decision has no expense to restore');
        const categoryId = (decision.before as { category_id?: string }).category_id;
        if (!categoryId) throw new Error('This decision did not record the category it replaced');
        await this.expenses.update(decision.expense_id, { category_id: categoryId });
        break;
      }
      case 'committed': {
        const before = decision.before as unknown as CommittedBefore;
        if (!before.expense) throw new Error('This decision did not record the expense it replaced');
        await this.restoreExpense(before);
        if (before.payment_id) await this.payments.delete(before.payment_id);
        const itemId = before.expense.inbox_item_id as string | null;
        if (itemId) {
          await this.inbox.updateConsumed(itemId, { action: 'created', expense_id: String(before.expense.id), at: now.toISOString() });
        }
        await invalidateInsightsCache(this.supabase, String(before.expense.date));
        break;
      }
      case 'suggested':
        throw new Error('A suggestion changed nothing, so there is nothing to undo');
    }

    await this.decisions.markUndone(decision.id, now.toISOString());
    return { ...decision, undone_at: now.toISOString() };
  }

  private async restoreTransfer(transferId: string, before: TransferBefore): Promise<void> {
    const current = await this.transfers.findById(transferId);
    if (!current) throw new Error('The transfer this decision changed no longer exists');
    // Contribution rows first, so the transfer can point at them again.
    for (const { row, removal } of before.investments ?? []) {
      if (removal === 'deleted') await this.reinsertInvestment(row);
      else await this.setInvestmentTransfer(row.id, transferId);
    }
    await this.transfers.update(transferId, before.transfer);
  }

  /** The contribution row pointing at this transfer, if any — all of it, so it can be restored. */
  private async investmentOf(transferId: string): Promise<InvestmentRow | null> {
    const { data, error } = await this.supabase.from('portfolio_investments').select('*').eq('transfer_id', transferId).maybeSingle();
    if (error) throw new Error(`Failed to read the transfer's contribution: ${error.message}`);
    return (data as InvestmentRow | null) ?? null;
  }

  /** Whether `TransferService.recordInvestment` inserted this row for the transfer (vs. linking an existing one). */
  private createdBy(row: InvestmentRow, transfer: Transfer): boolean {
    const note = [transfer.counterparty, transfer.payment_method].filter(Boolean).join(' · ') || null;
    return (
      row.kind === 'adhoc' &&
      (row.note ?? null) === note &&
      row.investment_date === transfer.date &&
      Number(row.amount) === Number(transfer.amount)
    );
  }

  private async deleteExpense(id: string): Promise<void> {
    const tags = await this.supabase.from('expense_tags').delete().eq('expense_id', id);
    if (tags.error) throw new Error(`Failed to remove the expense's tags: ${tags.error.message}`);
    const { error } = await this.supabase.from('expenses').delete().eq('id', id);
    if (error) throw new Error(`Failed to remove the expense: ${error.message}`);
  }

  private async restoreExpense(before: CommittedBefore): Promise<void> {
    const { error } = await this.supabase.from('expenses').insert([before.expense]);
    if (error) throw new Error(`Failed to restore the expense: ${error.message}`);
    if (before.tag_ids.length > 0) {
      const tags = await this.supabase
        .from('expense_tags')
        .insert(before.tag_ids.map((tag_id) => ({ expense_id: before.expense.id, tag_id })));
      if (tags.error) throw new Error(`Failed to restore the expense's tags: ${tags.error.message}`);
    }
  }

  private async deleteInvestment(id: string): Promise<void> {
    const { error } = await this.supabase.from('portfolio_investments').delete().eq('id', id);
    if (error) throw new Error(`Failed to remove the contribution: ${error.message}`);
  }

  private async setInvestmentTransfer(id: string, transferId: string | null): Promise<void> {
    const { error } = await this.supabase.from('portfolio_investments').update({ transfer_id: transferId }).eq('id', id);
    if (error) throw new Error(`Failed to relink the contribution: ${error.message}`);
  }

  private async reinsertInvestment(row: InvestmentRow): Promise<void> {
    const { account, ...columns } = row as InvestmentRow & { account?: unknown };
    void account;
    const { error } = await this.supabase.from('portfolio_investments').insert([columns]);
    if (error) throw new Error(`Failed to restore the contribution: ${error.message}`);
  }
}
