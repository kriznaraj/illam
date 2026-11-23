import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { TransferService } from './TransferService';
import { MadalDecisionService, type ExpenseRow } from './MadalDecisionService';
import { CommitmentPaymentRepository, CommitmentRepository } from '@/lib/repositories/CommitmentRepository';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import { COMMITMENT_KINDS, findCommitment, FREQUENCY_MONTHS, matchesText, MIN_MATCH_LENGTH, type CommitmentMatch } from '@/lib/cashflow/commitments';
import { matchStatementLines, type StatementAccountLines } from '@/lib/inbox/automation/statementNarration';
import { monthKeys } from '@/lib/utils/dateUtils';
import type { Commitment, CommitmentFrequency, CommitmentKind, CommitmentPayment, CommitmentPaymentSource, InboxOwner } from '@/types';

export interface DebitEvidence {
  text: string;
  date: string;
  amount: number;
  source: CommitmentPaymentSource;
  inbox_item_id?: string | null;
  transfer_id?: string | null;
  note?: string | null;
}

export interface RecordedCommitmentPayment extends CommitmentMatch {
  payment: CommitmentPayment;
  created: boolean;
}

/**
 * Commitments: insurance premiums and loan EMIs, declared once and never
 * expenses (lib/cashflow/commitments.ts). Besides the CRUD behind /cash-flow/commitments,
 * this is where every place that sees money leave — a bank statement line, a card statement
 * line, a Madal alert — asks "is this a commitment?" before it would make an expense of it.
 */
export class CommitmentService extends BaseService {
  private commitments: CommitmentRepository;
  private payments: CommitmentPaymentRepository;
  private transfers: TransferRepository;
  private transferService: TransferService;

  constructor(private supabase: SupabaseClient) {
    super();
    this.commitments = new CommitmentRepository(supabase);
    this.payments = new CommitmentPaymentRepository(supabase);
    this.transfers = new TransferRepository(supabase);
    this.transferService = new TransferService(supabase);
  }

  list(): Promise<Commitment[]> {
    return this.commitments.listAll();
  }

  listPayments(fromMonth: string, toMonth: string): Promise<CommitmentPayment[]> {
    return this.payments.listBetween(fromMonth, toMonth);
  }

  async create(input: Partial<Commitment>): Promise<Commitment> {
    this.validateRequired(input as Record<string, unknown>, ['name', 'kind', 'amount', 'frequency', 'start_month']);
    return this.commitments.create(this.validated(input) as Partial<Commitment>);
  }

  async update(id: string, changes: Partial<Commitment>): Promise<Commitment> {
    this.validateUUID(id, 'id');
    const current = await this.commitments.findById(id);
    if (!current) throw new Error('Commitment not found');
    const merged = this.validated({ ...current, ...changes });
    const patch = Object.fromEntries(Object.keys(changes).filter((key) => key in merged).map((key) => [key, merged[key as keyof typeof merged]]));
    return this.commitments.update(id, { ...patch, updated_at: new Date().toISOString() } as Partial<Commitment>);
  }

  async remove(id: string): Promise<void> {
    this.validateUUID(id, 'id');
    await this.commitments.delete(id);
  }

  /**
   * A payment a person vouches for — a premium paid from an account no statement reaches, or an
   * advance (`covers_through`) settling later due months too. When the due month already has a
   * payment (a statement found the advance), only its coverage is set, never its amount.
   */
  async markPaid(input: {
    commitment_id: string;
    due_month: string;
    paid_date: string;
    amount: number;
    covers_through?: string | null;
    note?: string | null;
  }): Promise<CommitmentPayment> {
    this.validateUUID(input.commitment_id, 'commitment_id');
    if (!monthKeys.isValid(input.due_month)) throw new Error('due_month must be yyyy-MM');
    this.validateDate(input.paid_date, 'paid_date');
    this.validatePositiveNumber(Number(input.amount), 'amount');
    const coversThrough = input.covers_through || null;
    if (coversThrough && (!monthKeys.isValid(coversThrough) || coversThrough <= input.due_month)) {
      throw new Error('covers_through must be yyyy-MM, after due_month');
    }
    const { payment, created } = await this.payments.recordOnce({
      commitment_id: input.commitment_id,
      due_month: input.due_month,
      paid_date: input.paid_date,
      amount: Number(input.amount),
      source: 'manual',
      inbox_item_id: null,
      transfer_id: null,
      ...(coversThrough ? { covers_through: coversThrough } : {}),
      note: input.note ?? null,
    });
    if (created) return payment;
    if (coversThrough === (payment.covers_through ?? null)) throw new Error(`${monthKeys.label(input.due_month)} is already recorded as paid`);
    return this.payments.update(payment.id, { covers_through: coversThrough });
  }

  async removePayment(id: string): Promise<void> {
    this.validateUUID(id, 'id');
    await this.payments.delete(id);
  }

  /**
   * Expenses that are really instalments of a declared commitment, moved into its payments.
   *
   * The checks before an expense is made (statement lines, card lines, alerts) only help once the
   * commitment exists. A premium recorded before then stayed an expense — a large annual family
   * health-insurance premium makes its month read as a spike. So every declared commitment also
   * sweeps the expenses since its start month: the same text-and-date match as a debit, each move
   * recorded with Undo (MadalDecisionService.commitExpense). Best-effort per expense; returns how
   * many moved.
   */
  async claimRecordedExpenses(): Promise<number> {
    const commitments = (await this.commitments.listAll()).filter((c) => c.active && c.match_text);
    if (commitments.length === 0) return 0;
    const since = `${commitments.map((c) => c.start_month).sort()[0]}-01`;

    const { data, error } = await this.supabase
      .from('expenses')
      .select('*, expense_tags(tag_id)')
      .gte('date', since)
      .limit(5000);
    if (error) throw new Error(`Failed to read expenses: ${error.message}`);

    const decisions = new MadalDecisionService(this.supabase);
    let moved = 0;
    for (const expense of (data ?? []) as unknown as ExpenseRow[]) {
      const text = [expense.description, expense.merchant].filter(Boolean).join(' ');
      if (!commitments.some((c) => matchesText(c, text))) continue;
      const match = findCommitment(commitments, { text, date: expense.date, amount: Number(expense.amount) });
      if (!match) continue;
      try {
        await decisions.commitExpense(expense, match);
        moved += 1;
      } catch (error) {
        this.warn('CommitmentService.claimRecordedExpenses', `expense ${expense.id} left as it was`, error instanceof Error ? error.message : error);
      }
    }
    if (moved > 0) this.log('CommitmentService.claimRecordedExpenses', `${moved} expense(s) moved into commitment payments`);
    return moved;
  }

  /**
   * The commitment this debit pays, recorded against its due month — or null. Pass the
   * commitments when checking many debits in one run, to read them once.
   */
  async recordDebit(debit: DebitEvidence, commitments?: readonly Commitment[]): Promise<RecordedCommitmentPayment | null> {
    const match = findCommitment(commitments ?? (await this.commitments.listAll()), debit);
    if (!match) return null;
    const { payment, created } = await this.payments.recordOnce({
      commitment_id: match.commitment.id,
      due_month: match.dueMonth,
      paid_date: debit.date,
      amount: debit.amount,
      source: debit.source,
      inbox_item_id: debit.inbox_item_id ?? null,
      transfer_id: debit.transfer_id ?? null,
      note: debit.note ?? null,
    });
    return { ...match, payment, created };
  }

  /**
   * Every debit on a bank statement that pays a commitment. A Madal transfer that is the same
   * debit is claimed too: a waiting one is confirmed (as `loan` for an EMI), and its id goes on
   * the payment either way, so the cash-flow report never counts the money twice. Best-effort
   * per line.
   */
  async recordFromStatement(owner: InboxOwner, accounts: readonly StatementAccountLines[]): Promise<RecordedCommitmentPayment[]> {
    const commitments = (await this.commitments.listAll()).filter((c) => c.active && c.match_text);
    if (commitments.length === 0 || accounts.length === 0) return [];

    const ownTransfers = (await this.transfers.list({ limit: 500 })).filter((t) => t.owner === owner && t.direction === 'debit');
    const transferOf = new Map(matchStatementLines(ownTransfers, accounts, { includeConfirmed: true }).map((m) => [m.line, m.transfer]));

    const recorded: RecordedCommitmentPayment[] = [];
    for (const line of accounts.flatMap((a) => a.lines)) {
      if (line.direction !== 'debit' || !commitments.some((c) => matchesText(c, line.narration))) continue;
      try {
        const transfer = transferOf.get(line);
        const result = await this.recordDebit(
          { text: line.narration, date: line.date, amount: line.amount, source: 'statement', transfer_id: transfer?.id ?? null },
          commitments
        );
        if (!result) continue;
        recorded.push(result);
        if (transfer?.status === 'needs_review') {
          await this.transferService.apply(transfer, {
            kind: result.commitment.kind === 'loan' ? 'loan' : 'other',
            note: `${result.commitment.name} (${monthKeys.shortLabel(result.dueMonth)})`,
          });
        }
      } catch (error) {
        this.warn('CommitmentService.recordFromStatement', `${line.date} ₹${line.amount}`, error instanceof Error ? error.message : error);
      }
    }
    return recorded;
  }

  private validated(input: Partial<Commitment>): Partial<Commitment> {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('name is required');
    const kind = input.kind as CommitmentKind;
    if (!COMMITMENT_KINDS.includes(kind)) throw new Error(`kind must be one of ${COMMITMENT_KINDS.join(', ')}`);
    const amount = Number(input.amount);
    this.validatePositiveNumber(amount, 'amount');
    const frequency = input.frequency as CommitmentFrequency;
    if (!(frequency in FREQUENCY_MONTHS)) throw new Error(`frequency must be one of ${Object.keys(FREQUENCY_MONTHS).join(', ')}`);
    if (!monthKeys.isValid(input.start_month)) throw new Error('start_month must be yyyy-MM');
    const endMonth = input.end_month || null;
    if (endMonth && (!monthKeys.isValid(endMonth) || endMonth < (input.start_month as string))) {
      throw new Error('end_month must be yyyy-MM, on or after start_month');
    }
    const dueDay = Number(input.due_day ?? 1);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('due_day must be between 1 and 31');
    const matchText = input.match_text?.trim() || null;
    if (matchText && matchText.replace(/[^a-z0-9]/gi, '').length < MIN_MATCH_LENGTH) {
      throw new Error(`match_text must have at least ${MIN_MATCH_LENGTH} letters or digits`);
    }
    if (input.account_id) this.validateUUID(input.account_id, 'account_id');

    return {
      name,
      kind,
      amount,
      frequency,
      start_month: input.start_month,
      due_day: dueDay,
      end_month: endMonth,
      match_text: matchText,
      account_id: input.account_id || null,
      note: input.note?.trim() || null,
      active: input.active ?? true,
    };
  }
}
