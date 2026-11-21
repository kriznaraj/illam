import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { MadalDecisionService } from './MadalDecisionService';
import { ExpenseCategorizationService } from './ExpenseCategorizationService';
import { getProvider, isAIEnabled, TASKS } from '@/lib/ai';
import { TransferResolutionSchema } from '@/lib/ai/schemas';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import { MadalDecisionRepository } from '@/lib/repositories/MadalDecisionRepository';
import { ExpenseRepository } from '@/lib/repositories/ExpenseRepository';
import { CategoryRepository } from '@/lib/repositories/CategoryRepository';
import { CommitmentRepository } from '@/lib/repositories/CommitmentRepository';
import { TODO_FROM } from '@/lib/repositories/InboxRepository';
import { householdDescription, memberName, memberSlugs, payeeNames } from '@/lib/household';
import { awaitsStatement } from '@/lib/inbox/automation/statementWait';
import {
  autoApplyKind,
  buildResolvePrompt,
  evidenceKey,
  historyLine,
  normalizeForQuote,
  relevantHistory,
  resolveSystem,
} from '@/lib/inbox/automation/claudeResolve';
import { toAppTimezoneDate } from '@/lib/utils/dateUtils';

export interface ResolverOutcome {
  /** Transfers Claude settled without asking (each undoable). */
  classified: number;
  /** Transfers left in the To-do with Claude's answer filled in. */
  suggested: number;
  /** Auto-added expenses moved out of Miscellaneous. */
  categorised: number;
}


/** At most this many Claude calls per run: the run shares Vercel's 60 s with everything else. */
const MAX_TRANSFERS_PER_RUN = 6;
const MAX_EXPENSES_PER_RUN = 6;

/**
 * The last step before anything reaches a person: what the rules and the
 * bank statement could not settle is put to Claude.
 *
 * - A waiting transfer whose statement has had its chance (`awaitsStatement`) is classified. The
 *   answer is applied when its quoted evidence checks out (`autoApplyKind`), else recorded as a
 *   suggestion for the To-do sheet. Each transfer is asked once per piece of evidence.
 * - An auto-added expense still in Miscellaneous gets one more try at a category.
 *
 * Every change goes through MadalDecisionService, so each has an undo record. Best-effort
 * throughout: without a key, or on any failure, things stay exactly as the rules left them.
 */
export class TransferResolverService extends BaseService {
  private transfers: TransferRepository;
  private decisionLog: MadalDecisionRepository;
  private decisions: MadalDecisionService;
  private expenses: ExpenseRepository;
  private categories: CategoryRepository;
  private categorizer: ExpenseCategorizationService;

  constructor(private supabase: SupabaseClient) {
    super();
    this.transfers = new TransferRepository(supabase);
    this.decisionLog = new MadalDecisionRepository(supabase);
    this.decisions = new MadalDecisionService(supabase);
    this.expenses = new ExpenseRepository(supabase);
    this.categories = new CategoryRepository(supabase);
    this.categorizer = new ExpenseCategorizationService();
  }

  async run(options: { now: Date; deadline: number }): Promise<ResolverOutcome> {
    const outcome: ResolverOutcome = { classified: 0, suggested: 0, categorised: 0 };
    if (!isAIEnabled()) return outcome;
    try {
      await this.resolveTransfers(options, outcome);
      await this.recategorise(options, outcome);
    } catch (error) {
      this.warn('TransferResolverService.run', 'stopped early', error instanceof Error ? error.message : error);
    }
    return outcome;
  }

  private async resolveTransfers(options: { now: Date; deadline: number }, outcome: ResolverOutcome): Promise<void> {
    const today = toAppTimezoneDate(options.now);
    const all = await this.transfers.list({ limit: 500 });
    const waiting = all.filter((t) => t.status === 'needs_review' && !awaitsStatement(t, today));
    if (waiting.length === 0) return;

    const asked = await this.decisionLog.decidedKeys('transfer_id', waiting.map((t) => t.id));
    const due = waiting.filter((t) => !asked.has(`${t.id}|${evidenceKey(t)}`)).slice(0, MAX_TRANSFERS_PER_RUN);
    if (due.length === 0) return;

    const commitments = await new CommitmentRepository(this.supabase)
      .listAll()
      .then((rows) => rows.map((c) => `${c.name}${c.match_text ? ` (prints as "${c.match_text}")` : ''}`))
      .catch(() => [] as string[]);
    const householdNames = memberSlugs().flatMap(payeeNames);
    const confirmed = all.filter((t) => t.status === 'confirmed');

    for (const transfer of due) {
      if (Date.now() > options.deadline) return;
      const history = relevantHistory(transfer, confirmed.filter((t) => t.owner === transfer.owner)).map(historyLine);
      const result = await getProvider().complete({
        task: 'resolve-transfer',
        schema: TransferResolutionSchema,
        schemaName: 'transfer_resolution',
        system: resolveSystem(householdDescription()),
        prompt: buildResolvePrompt({ transfer, ownerName: memberName(transfer.owner), householdNames, commitments, history }),
      });
      // A failed call records nothing, so the next run asks again.
      if (!result.ok) {
        this.warn('TransferResolverService', `transfer ${transfer.id}: ${result.error.kind}`, result.error.message);
        continue;
      }

      const answer = result.data;
      const evidence = [transfer.note ?? '', transfer.counterparty ?? '', transfer.payment_method ?? '', ...history];
      const kind = autoApplyKind(answer, transfer.direction, evidence);
      const key = evidenceKey(transfer);
      try {
        if (kind) {
          await this.decisions.classify(transfer, { kind, reason: answer.reason, evidence: answer.quote ?? '', evidenceKey: key, model: result.usage.model });
          outcome.classified += 1;
        } else {
          await this.decisions.suggest(transfer, { kind: answer.kind, reason: answer.reason, evidence: answer.quote, evidenceKey: key, model: result.usage.model });
          outcome.suggested += 1;
        }
      } catch (error) {
        this.warn('TransferResolverService', `transfer ${transfer.id} not recorded`, error instanceof Error ? error.message : error);
      }
    }
  }

  private async recategorise(options: { now: Date; deadline: number }, outcome: ResolverOutcome): Promise<void> {
    const undecided = (await this.expenses.findUndecidedInboxExpenses(TODO_FROM.slice(0, 10))).filter((e) => e.merchant);
    if (undecided.length === 0) return;
    const keyOf = (e: { merchant: string | null }) => normalizeForQuote(e.merchant ?? '');
    const tried = await this.decisionLog.decidedKeys('expense_id', undecided.map((e) => e.id));
    const due = undecided.filter((e) => !tried.has(`${e.id}|${keyOf(e)}`)).slice(0, MAX_EXPENSES_PER_RUN);
    if (due.length === 0) return;

    const categories = await this.categories.findAllSorted();
    const misc = categories.find((c) => c.name.toLowerCase() === 'miscellaneous')?.id ?? null;
    const options_ = categories.map((c) => ({ id: c.id, name: c.name, group_name: c.group_name }));
    const model = TASKS['classify-expense'].model;

    for (const expense of due) {
      if (Date.now() > options.deadline) return;
      try {
        const suggestion = await this.categorizer.suggestOne(expense.merchant as string, options_);
        const confident =
          suggestion.source === 'ai' && suggestion.confidence !== 'low' && !suggestion.notAnExpense && suggestion.categoryId && suggestion.categoryId !== misc;
        if (confident) {
          await this.decisions.categorise(expense, {
            categoryId: suggestion.categoryId as string,
            categoryName: suggestion.categoryName ?? '',
            reason: suggestion.reasoning ?? `Filed under ${suggestion.categoryName}.`,
            evidenceKey: keyOf(expense),
            model,
          });
          outcome.categorised += 1;
        } else if (suggestion.source === 'ai') {
          // Asked and not sure: not asked again for this payee. A failed call (no 'ai' answer) is retried.
          await this.decisions.noteExpenseTried(expense, {
            reason: suggestion.reasoning ?? 'No confident category for this payee.',
            evidenceKey: keyOf(expense),
            model,
          });
        }
      } catch (error) {
        this.warn('TransferResolverService', `expense ${expense.id} left as it was`, error instanceof Error ? error.message : error);
      }
    }
  }
}

