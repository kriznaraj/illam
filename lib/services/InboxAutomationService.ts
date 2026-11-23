import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, differenceInHours, format } from 'date-fns';
import { BaseService } from './BaseService';
import { TransferService } from './TransferService';
import { IncomeService } from './IncomeService';
import { CommitmentService } from './CommitmentService';
import { CommitmentRepository } from '@/lib/repositories/CommitmentRepository';
import { findCommitment } from '@/lib/cashflow/commitments';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { ExpenseRepository } from '@/lib/repositories/ExpenseRepository';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import { TransactionRuleRepository } from '@/lib/repositories/TransactionRuleRepository';
import { CreditCardStatementRepository } from '@/lib/repositories/CreditCardStatementRepository';
import { UserRepository } from '@/lib/repositories/UserRepository';
import { CategoryRepository } from '@/lib/repositories/CategoryRepository';
import { AppConfigRepository } from '@/lib/repositories/AppConfigRepository';
import { TagRepository } from '@/lib/repositories/TagRepository';
import { classifyTransaction, type Classification, type StatementRef } from '@/lib/inbox/automation/classify';
import { findExpenseMatch, MATCH_WINDOW_DAYS, type ExpenseCandidate } from '@/lib/inbox/automation/match';
import { findTwinAlert } from '@/lib/inbox/automation/duplicates';
import { findHouseholdPairs } from '@/lib/inbox/automation/householdPairs';
import { paymentMethodLabel } from '@/lib/inbox/automation/owners';
import { memberName, memberSlugs, ownerUsername } from '@/lib/household';
import { spendTime } from '@/lib/inbox/automation/spendTime';
import { ExpenseCategorizationService } from './ExpenseCategorizationService';
import { TransferResolverService, type ResolverOutcome } from './TransferResolverService';
import { matchCategoryByKeyword } from '@/lib/expenses/categoryMatcher';
import { AUTO_TAG_NAME } from '@/lib/expenses/autoTag';
import { categoryFromHistory } from '@/lib/expenses/merchantHistory';
import { invalidateInsightsCache } from '@/lib/cache-invalidation';
import { parseAppDate, toAppTimezoneDate } from '@/lib/utils/dateUtils';
import type {
  Category,
  CategorySource,
  Commitment,
  InboxConsumed,
  InboxItem,
  InboxOwner,
  InboxTransactionData,
  TransactionRule,
  Transfer,
} from '@/types';



/**
 * How long an unlogged spend waits for someone to log it by hand before it is added.
 *
 * Zero by design: don't wait 24h, sync as soon as possible. The delay was
 * there to stop a hand entry made later in the day colliding with an auto-added row, but
 * that collision is already handled from the other side: `ExpenseService.createExpense`
 * merges a hand entry into the auto-added row it repeats, and `ExpenseReviewService.mergeInto`
 * is the manual fallback. Waiting a day bought nothing and cost a day of the list being wrong.
 *
 * Kept as a named constant rather than deleted: it is the one dial that trades "the list is
 * current" against "the list is tidy", and a future change may want it back at a few hours.
 */
export const AUTO_ADD_GRACE_HOURS = 0;
/** app_config key: alerts dated before it only enrich, never create. */
export const AUTO_ADD_FROM_KEY = 'inbox_auto_add_from';
const STATEMENT_LOOKBACK_DAYS = 60;

// Statement recording happens at ingest (StatementCaptureService), never in this run.
export type ProcessOutcome = Exclude<InboxConsumed['action'], 'statement_recorded' | 'statement_unread'> | 'waiting' | 'error';

export interface ProcessAction {
  itemId: string;
  owner: InboxOwner;
  txnDate: string;
  amount: number;
  title: string;
  outcome: ProcessOutcome;
  detail: string | null;
}

export interface ProcessResult {
  dryRun: boolean;
  counts: Record<ProcessOutcome, number>;
  actions: ProcessAction[];
  /** Items not reached before the time budget ran out; the next call picks them up. */
  remaining: number;
  /** Transfers already waiting that this run settled without asking (`resolveOpenTransfers`). */
  resolved: number;
  /** What Claude settled, suggested or re-filed this run (`TransferResolverService`). */
  claude?: ResolverOutcome;
}

/**
 * Each alert costs ~0.4 s of round trips, so a large backlog would outlast a 60 s
 * request limit run serially. A few run at once, and each call stops starting
 * new items once its budget is spent, so a backlog drains over several calls
 * instead of failing.
 */
export const DEFAULT_CONCURRENCY = 4;

/** Description of an auto-added spend whose alert names no payee. */
export const UNKNOWN_PAYEE = 'Unknown payee';

/** Claude is not asked to start a decision with less than this left — the slowest call takes ~25 s. */
const CLAUDE_CALL_ROOM_MS = 25_000;
/** With no budget given (a script, a test), the Claude step still stops after this long. */
const CLAUDE_STEP_MAX_MS = 60_000;

/** The AI category step stands aside after this much of the run's 40 s budget. */
const AI_CATEGORY_CUTOFF_MS = 30_000;

interface RunContext {
  now: Date;
  dryRun: boolean;
  rules: TransactionRule[];
  statements: StatementRef[];
  claimedStatements: Set<string>;
  /** Statement id → the inbox item whose bill payment settled it in an earlier run. */
  linkedStatements: Map<string, string | null>;
  candidates: ExpenseCandidate[];
  claimedExpenses: Set<string>;
  categories: Category[];
  miscellaneousId: string | null;
  autoAddFrom: string | null;
  /** The shared `auto` label, stamped on every row automation creates. */
  autoTagId: string | null;
  userIds: Record<InboxOwner, string | null>;
  /** Transaction alerts around this run's items, to spot a bank sending one alert twice. */
  alerts: InboxItem[];
  /** Insurance premiums and EMIs: a debit paying one is never an expense or a transfer. */
  commitments: Commitment[];
  /** When this run started (wall clock), so the AI step can stand aside near the time budget. */
  startedAtMs: number;
  /** One AI answer per payee per run: the same merchant often appears several times in a sync. */
  aiCategories: Map<string, Promise<string | null>>;
}

const emptyCounts = (): Record<ProcessOutcome, number> => ({
  linked: 0,
  created: 0,
  history_unmatched: 0,
  card_bill: 0,
  transfer: 0,
  income: 0,
  ignored: 0,
  waiting: 0,
  error: 0,
});

const shiftDays = (date: string, days: number) => format(addDays(parseAppDate(date), days), 'yyyy-MM-dd');

const isDuplicateKey = (error: unknown) => error instanceof Error && /duplicate key/i.test(error.message);

/**
 * Madal automation over transaction alerts.
 *
 * Idempotent: an item is acted on once and then carries `consumed`; the
 * guarded write in `InboxRepository.markConsumed` and the unique indexes on
 * `expenses.inbox_item_id` / `transfers.inbox_item_id` make an overlapping run
 * (each Gmail account syncs independently) a no-op rather than a duplicate.
 * A failure on one item leaves it unconsumed, so the next run retries it.
 */
export class InboxAutomationService extends BaseService {
  private inbox: InboxRepository;
  private expenses: ExpenseRepository;
  private transfers: TransferRepository;
  private rules: TransactionRuleRepository;
  private statements: CreditCardStatementRepository;
  private users: UserRepository;
  private categories: CategoryRepository;
  private appConfig: AppConfigRepository;
  private tags: TagRepository;
  private transferService: TransferService;

  private categorizer: ExpenseCategorizationService;

  constructor(private supabase: SupabaseClient) {
    super();
    this.inbox = new InboxRepository(supabase);
    this.expenses = new ExpenseRepository(supabase);
    this.transfers = new TransferRepository(supabase);
    this.rules = new TransactionRuleRepository(supabase);
    this.statements = new CreditCardStatementRepository(supabase);
    this.users = new UserRepository(supabase);
    this.categories = new CategoryRepository(supabase);
    this.appConfig = new AppConfigRepository(supabase);
    this.tags = new TagRepository(supabase);
    this.transferService = new TransferService(supabase);
    this.categorizer = new ExpenseCategorizationService();
  }

  async process(
    options: { now?: Date; dryRun?: boolean; timeBudgetMs?: number; concurrency?: number } = {}
  ): Promise<ProcessResult> {
    const startedAt = Date.now();
    const budget = options.timeBudgetMs ?? Number.POSITIVE_INFINITY;
    const now = options.now ?? new Date();
    const result: ProcessResult = { dryRun: options.dryRun === true, counts: emptyCounts(), actions: [], remaining: 0, resolved: 0 };

    if (!result.dryRun) result.resolved = await this.resolveOpenTransfers(now);
    // A premium recorded as an expense before its commitment was declared moves out of expenses.
    if (!result.dryRun) {
      await new CommitmentService(this.supabase)
        .claimRecordedExpenses()
        .catch((error: unknown) => this.warn('InboxAutomationService.process', 'commitment sweep skipped', error instanceof Error ? error.message : error));
    }

    const items = (await this.inbox.listUnconsumed('transaction')).filter(
      (item) => (item.data as InboxTransactionData).kind === 'transaction'
    );
    if (items.length === 0) {
      if (!result.dryRun) result.claude = await this.askClaude(now, startedAt, budget);
      return result;
    }

    const ctx = await this.loadContext(items, now, result.dryRun);

    // Safe to interleave: every claim on a shared expense or statement is taken
    // synchronously, before the first await of the item that takes it.
    const actions: (ProcessAction | undefined)[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length && Date.now() - startedAt < budget) {
        const index = next++;
        const item = items[index];
        const data = item.data as InboxTransactionData;
        const txnDate = data.txnDate ?? toAppTimezoneDate(new Date(item.received_at));
        let outcome: ProcessOutcome;
        let detail: string | null = null;
        try {
          ({ outcome, detail } = await this.handle(item, data, txnDate, ctx));
        } catch (error) {
          outcome = 'error';
          detail = error instanceof Error ? error.message : String(error);
          this.warn('InboxAutomationService.process', `item ${item.id} failed`, detail);
        }
        result.counts[outcome] += 1;
        actions[index] = { itemId: item.id, owner: item.owner, txnDate, amount: data.amount, title: item.title, outcome, detail };
      }
    };
    const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, items.length));
    await Promise.all(Array.from({ length: concurrency }, worker));

    result.actions = actions.filter((action): action is ProcessAction => action !== undefined);
    result.remaining = items.length - result.actions.length;
    // New alerts first; Claude gets what is left of the budget, and only once they are all done.
    if (!result.dryRun && result.remaining === 0) result.claude = await this.askClaude(now, startedAt, budget);
    return result;
  }

  /**
   * The last step before anything reaches a person: what the rules could not settle goes to Claude,
   * within what is left of this call's time budget (minus room for the slowest Claude call).
   */
  private async askClaude(now: Date, startedAt: number, budget: number): Promise<ResolverOutcome | undefined> {
    const deadline = Number.isFinite(budget) ? startedAt + budget - CLAUDE_CALL_ROOM_MS : Date.now() + CLAUDE_STEP_MAX_MS;
    if (Date.now() > deadline) return undefined;
    return new TransferResolverService(this.supabase).run({ now, deadline });
  }

  /**
   * Give every transfer still waiting another chance to settle itself. The backlog was queued
   * when every transfer was reviewed by rule, and a SIP added to the calendar after its debit
   * arrived only becomes matchable later. A handful of rows per run; failures leave them waiting.
   */
  private async resolveOpenTransfers(now: Date): Promise<number> {
    const listOpen = async () => {
      try {
        return await this.transfers.list({ status: 'needs_review', limit: 200 });
      } catch (error) {
        this.warn('InboxAutomationService.resolveOpenTransfers', 'could not read open transfers', error instanceof Error ? error.message : error);
        return null;
      }
    };

    let open = await listOpen();
    if (!open) return 0;
    let resolved = await this.releaseRedecided(open, now);
    if (resolved > 0) open = (await listOpen()) ?? [];

    for (const transfer of open) {
      if (await this.transferService.autoResolve(transfer)) resolved += 1;
    }

    // Both halves of money moved between the two of them.
    for (const { debit, credit } of findHouseholdPairs((await listOpen()) ?? [])) {
      try {
        await this.transferService.apply(debit, { kind: 'family', note: `Household transfer · to ${memberName(credit.owner)}` });
        await this.transferService.apply(credit, { kind: 'family', note: `Household transfer · from ${memberName(debit.owner)}` });
        resolved += 2;
      } catch (error) {
        this.warn('InboxAutomationService.resolveOpenTransfers', `pair ${debit.id}/${credit.id} left waiting`, error instanceof Error ? error.message : error);
      }
    }
    return resolved;
  }

  /**
   * Decide each waiting transfer's alert again, with what the classifier knows today. A transfer
   * is the classifier's answer at the time, and it improves: a card debit became an expense
   * ("a card cannot move money"), "CC BILLPAY" became a bill payee — and the alerts it had
   * already queued would otherwise wait for a person forever. One that is no longer a transfer
   * is released (the row deleted, the alert unconsumed) and decided by this same run, through
   * the same `handle` as a new alert; one that is still a transfer stays exactly as it was.
   * Best-effort: a failure leaves everything waiting.
   */
  private async releaseRedecided(open: Transfer[], now: Date): Promise<number> {
    try {
      const withAlert = open.filter((t) => t.inbox_item_id);
      if (withAlert.length === 0) return 0;
      const items = (await this.inbox.findByIds(withAlert.map((t) => t.inbox_item_id as string))).filter(
        (item) => (item.data as InboxTransactionData | null)?.kind === 'transaction'
      );
      if (items.length === 0) return 0;
      const ctx = await this.loadContext(items, now, false);

      let released = 0;
      for (const transfer of withAlert) {
        const item = items.find((i) => i.id === transfer.inbox_item_id);
        if (!item) continue;
        const data = item.data as InboxTransactionData;
        const txnDate = data.txnDate ?? toAppTimezoneDate(new Date(item.received_at));
        const { classification } = this.decide(item, data, txnDate, ctx);
        if (classification.kind === 'transfer') continue;
        await this.transfers.delete(transfer.id);
        await this.inbox.updateItem(item.id, { consumed: null });
        released += 1;
      }
      return released;
    } catch (error) {
      this.warn('InboxAutomationService.releaseRedecided', 'left transfers waiting', error instanceof Error ? error.message : error);
      return 0;
    }
  }

  private async loadContext(items: InboxItem[], now: Date, dryRun: boolean): Promise<RunContext> {
    const dates = items
      .map((item) => (item.data as InboxTransactionData).txnDate ?? toAppTimezoneDate(new Date(item.received_at)))
      .sort();
    const first = dates[0];
    const last = dates[dates.length - 1];

    const [rules, statementsRes, linkedStatements, candidates, categories, configRes, memberUsers, alerts, autoTag, commitments] = await Promise.all([
      this.rules.listNewestFirst(),
      this.statements.listSince(shiftDays(first, -STATEMENT_LOOKBACK_DAYS)),
      this.transfers.listLinkedStatements(shiftDays(first, -STATEMENT_LOOKBACK_DAYS)),
      this.expenses.findMatchCandidates(shiftDays(first, -MATCH_WINDOW_DAYS), shiftDays(last, MATCH_WINDOW_DAYS)),
      this.categories.findAllSorted(),
      this.appConfig.getKeys([AUTO_ADD_FROM_KEY]),
      Promise.all(memberSlugs().map(async (slug) => [slug, (await this.users.findByUsername(ownerUsername(slug)))?.id ?? null] as const)),
      this.inbox.listTransactionsBetween(`${shiftDays(first, -1)}T00:00:00+05:30`, `${shiftDays(last, 1)}T23:59:59+05:30`),
      // Best-effort: without the tag, no label is stamped.
      this.tags.findByName(AUTO_TAG_NAME).catch(() => null),
      // Best-effort: with no commitments, every alert is decided on its own merits.
      new CommitmentRepository(this.supabase).listAll().catch(() => []),
    ]);

    if (statementsRes.error) throw new Error(`Failed to load card statements: ${statementsRes.error.message}`);
    if (configRes.error) throw new Error(`Failed to load app config: ${configRes.error.message}`);

    // Paid and unpaid: a bill payment links to a statement already marked paid by hand too.
    const statements: StatementRef[] = (statementsRes.data ?? []).map((s) => ({
      id: String(s.id),
      account_id: String(s.account_id),
      statement_date: String(s.statement_date),
      statement_amount: Number(s.statement_amount ?? 0),
      amount_paid: Number(s.amount_paid ?? 0),
      payment_date: s.payment_date ? String(s.payment_date) : null,
    }));

    const configured = configRes.data?.find((row) => row.key === AUTO_ADD_FROM_KEY)?.value ?? null;

    return {
      now,
      dryRun,
      rules,
      statements,
      claimedStatements: new Set(),
      linkedStatements,
      candidates,
      claimedExpenses: new Set(),
      categories,
      miscellaneousId: categories.find((c) => c.name.toLowerCase() === 'miscellaneous')?.id ?? null,
      // No cut configured means never auto-add — the safe default.
      autoAddFrom: configured && /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : null,
      autoTagId: autoTag?.id ?? null,
      userIds: Object.fromEntries(memberUsers),
      alerts,
      commitments,
      startedAtMs: Date.now(),
      aiCategories: new Map(),
    };
  }

  /** What an alert is, given everything this run knows. Pure over `ctx`; shared by `handle` and the re-check of waiting transfers. */
  private decide(item: InboxItem, data: InboxTransactionData, txnDate: string, ctx: RunContext) {
    const preferredUserId = ctx.userIds[item.owner] ?? null;
    const matchable = data.direction === 'debit' && data.outcome === 'success' && data.currency === 'INR';
    const match = matchable
      ? findExpenseMatch({ amount: data.amount, txnDate }, ctx.candidates, { preferredUserId, claimed: ctx.claimedExpenses })
      : null;

    const classification = classifyTransaction(data, {
      owner: item.owner,
      rules: ctx.rules,
      // Not claimed earlier in this run, and not settled by a different alert in an earlier one.
      statements: ctx.statements.filter((s) => {
        if (ctx.claimedStatements.has(s.id)) return false;
        const linkedBy = ctx.linkedStatements.get(s.id);
        return linkedBy === undefined || linkedBy === item.id;
      }),
      hasExpenseMatch: match !== null,
    });
    return { match, classification };
  }

  private async handle(
    item: InboxItem,
    data: InboxTransactionData,
    txnDate: string,
    ctx: RunContext
  ): Promise<{ outcome: ProcessOutcome; detail: string | null }> {
    // A run killed between linking an expense and marking the alert (a timeout) leaves
    // the link in place; finish recording it rather than re-deciding the alert.
    const alreadyLinked = ctx.candidates.find((c) => c.inbox_item_id === item.id);
    if (alreadyLinked) {
      await this.consume(item, { action: 'linked', expense_id: alreadyLinked.id, at: ctx.now.toISOString() }, ctx);
      return { outcome: 'linked', detail: `${alreadyLinked.id} (recovered)` };
    }

    // A bank sometimes sends one alert twice, seconds apart; only the first copy is acted on.
    const twin = findTwinAlert(item, ctx.alerts);
    if (twin) {
      await this.consume(item, { action: 'ignored', reason: 'duplicate alert', at: ctx.now.toISOString() }, ctx);
      return { outcome: 'ignored', detail: `duplicate of ${twin.id}` };
    }

    // A premium or an EMI: recorded against its commitment, and nothing else is made of it.
    if (data.direction === 'debit' && data.outcome === 'success' && data.currency === 'INR' && ctx.commitments.length > 0) {
      const text = [data.merchant, item.title].filter(Boolean).join(' ');
      if (ctx.dryRun) {
        const would = findCommitment(ctx.commitments, { text, date: txnDate, amount: data.amount });
        if (would) return { outcome: 'ignored', detail: `commitment: ${would.commitment.name}` };
      } else {
        const paid = await new CommitmentService(this.supabase).recordDebit(
          { text, date: txnDate, amount: data.amount, source: 'alert', inbox_item_id: item.id },
          ctx.commitments
        );
        if (paid) {
          const reason = `commitment: ${paid.commitment.name}`;
          await this.consume(item, { action: 'ignored', reason, at: ctx.now.toISOString() }, ctx, { needs_attention: false, attention_reason: null });
          return { outcome: 'ignored', detail: reason };
        }
      }
    }

    const { match, classification } = this.decide(item, data, txnDate, ctx);

    switch (classification.kind) {
      case 'ignore':
        await this.consume(item, { action: 'ignored', reason: classification.reason, at: ctx.now.toISOString() }, ctx);
        return { outcome: 'ignored', detail: classification.reason };

      case 'card_bill':
        return this.handleCardBill(item, data, txnDate, classification, ctx);

      case 'transfer':
        return this.handleTransfer(item, data, txnDate, classification, ctx);

      case 'income':
        return this.handleIncome(item, data, txnDate, classification, ctx);

      case 'expense':
        return this.handleExpense(item, data, txnDate, match, classification, ctx);
    }
  }

  /**
   * A credit the mail named outright — today only an INDmoney dividend.
   * Recorded in the currency it was paid in: these arrive in USD inside the US wallet, and
   * the app holds no rate to turn them into rupees with.
   */
  private async handleIncome(
    item: InboxItem,
    data: InboxTransactionData,
    txnDate: string,
    classification: Extract<Classification, { kind: 'income' }>,
    ctx: RunContext
  ): Promise<{ outcome: ProcessOutcome; detail: string | null }> {
    const detail = `${classification.incomeKind}${classification.sourceName ? `: ${classification.sourceName}` : ''}`;
    if (ctx.dryRun) return { outcome: 'income', detail };

    const userId = ctx.userIds[item.owner] ?? null;
    if (!userId) throw new Error(`No user "${ownerUsername(item.owner)}" for inbox owner ${item.owner}`);

    // Idempotent on inbox_item_id, so an overlapping run or a retried one records the same row.
    const income = await new IncomeService(this.supabase).recordFromInbox({
      inbox_item_id: item.id,
      date: txnDate,
      amount: data.amount,
      currency: data.currency,
      kind: classification.incomeKind,
      source_name: classification.sourceName,
      description: item.title,
      user_id: userId,
      note: classification.reason,
    });

    await this.consume(
      item,
      { action: 'income', income_id: income.id, at: ctx.now.toISOString() },
      ctx,
      { needs_attention: false, attention_reason: null }
    );
    return { outcome: 'income', detail: `${detail} · ${income.id}` };
  }

  private async handleExpense(
    item: InboxItem,
    data: InboxTransactionData,
    txnDate: string,
    match: ExpenseCandidate | null,
    classification: Extract<Classification, { kind: 'expense' }>,
    ctx: RunContext
  ): Promise<{ outcome: ProcessOutcome; detail: string | null }> {
    const method = paymentMethodLabel(data);
    const at = ctx.now.toISOString();
    const when = spendTime(data, item.received_at);

    if (match) {
      ctx.claimedExpenses.add(match.id);
      if (!ctx.dryRun) {
        // Enrich only: the person's description, category and date are theirs.
        await this.expenses.update(match.id, { inbox_item_id: item.id, payment_method: method, merchant: data.merchant, ...when });
        await this.consume(item, { action: 'linked', expense_id: match.id, at }, ctx);
      }
      return { outcome: 'linked', detail: match.id };
    }

    if (differenceInHours(ctx.now, new Date(item.received_at)) < AUTO_ADD_GRACE_HOURS) {
      return { outcome: 'waiting', detail: null };
    }

    if (!ctx.autoAddFrom || txnDate < ctx.autoAddFrom) {
      await this.consume(item, { action: 'history_unmatched', at }, ctx);
      return { outcome: 'history_unmatched', detail: null };
    }

    const userId = ctx.userIds[item.owner] ?? null;
    const placed: { categoryId: string | null; source: CategorySource } = classification.categoryId
      ? { categoryId: classification.categoryId, source: 'rule' }
      : await this.categorise(data.merchant, ctx);
    const categoryId = placed.categoryId ?? ctx.miscellaneousId;
    if (!userId) throw new Error(`No user "${ownerUsername(item.owner)}" for inbox owner ${item.owner}`);
    if (!categoryId) throw new Error('No category to file the expense under (Miscellaneous is missing)');

    // A saved payee rule is the user's own decision, so its expense needs no review.
    const confirmed = classification.ruleId !== null;
    // Never the payment method: it already has its own coloured dot on the row, and "HDFC Bank
    // card payment" as the description told the user nothing about what was bought.
    const description = data.merchant ?? UNKNOWN_PAYEE;
    if (ctx.dryRun) return { outcome: 'created', detail: description };

    let expenseId: string;
    try {
      const expense = await this.expenses.create({
        date: txnDate,
        amount: data.amount,
        category_id: categoryId,
        description,
        user_id: userId,
        source: 'inbox',
        inbox_item_id: item.id,
        payment_method: method,
        merchant: data.merchant,
        needs_review: !confirmed,
        ...when,
      });
      expenseId = expense.id;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Another run already created it. The next pass finds it among the candidates
      // (alreadyLinked above) and records it; nothing is created twice.
      return { outcome: 'created', detail: 'already created by another run' };
    }

    await this.stampAutoTag(expenseId, ctx);

    // Only a spend automation could not place is a To-do. One filed from this household's
    // own past answer or the keyword table needs nothing from anyone (only conflicts need
    // review); it still carries `needs_review` until someone edits it,
    // because the hand-entry merge and the category history read that flag.
    const undecided = categoryId === ctx.miscellaneousId;
    await this.consume(
      item,
      { action: 'created', expense_id: expenseId, category_source: placed.source, at },
      ctx,
      !confirmed && undecided
        ? { needs_attention: true, attention_reason: 'Expense added · pick a category' }
        : { needs_attention: false, attention_reason: null }
    );
    // Every auto-added row moves the month's numbers now, not only the ones
    // a payee rule confirmed, so the cached insights for its month are stale either way.
    await invalidateInsightsCache(this.supabase, txnDate);
    return { outcome: 'created', detail: expenseId };
  }

  /**
   * Label the row as machine-made, so the list can say so and you can filter on it.
   *
   * Best-effort on purpose. The expense is already written by the time this runs, and a
   * missing label is cosmetic where a thrown error here would leave the alert unconsumed and
   * the spend re-decided on the next pass. With no `auto` tag this is a no-op, not a failure.
   */
  private async stampAutoTag(expenseId: string, ctx: RunContext): Promise<void> {
    if (!ctx.autoTagId) return;
    try {
      await this.expenses.linkTags(expenseId, [ctx.autoTagId]);
    } catch (error) {
      this.warn('InboxAutomationService.stampAutoTag', `could not label expense ${expenseId} "${AUTO_TAG_NAME}"`, error);
    }
  }

  /**
   * Where to file an unmatched spend.
   *
   * What this household already decided about the payee comes first: it is the user's own
   * answer about this exact shop, where the keyword table only recognises a generic word. A
   * good share of review expenses carrying a payee had an earlier confirmed expense from the
   * same payee — a snack shop filed under Quick bites several times over — and every one of
   * them had still been auto-filed under Miscellaneous.
   *
   * Best-effort on purpose: a lookup that fails must not stop the spend being recorded, so it
   * falls through to keywords exactly as before.
   */
  /**
   * A category for an auto-added spend: what this household already confirmed for the payee, else
   * the keyword table, else Haiku (when configured), else nothing (the caller files Miscellaneous).
   * Every step is best-effort — adding the expense never fails because a lookup did.
   */
  private async categorise(
    merchant: string | null,
    ctx: RunContext
  ): Promise<{ categoryId: string | null; source: CategorySource }> {
    if (!merchant) return { categoryId: null, source: 'none' };
    try {
      const prior = await this.expenses.findByMerchant(merchant);
      const decided = categoryFromHistory(merchant, prior);
      if (decided) return { categoryId: decided.categoryId, source: 'history' };
    } catch (error) {
      this.warn('InboxAutomationService.categorise', `history lookup failed for ${merchant}`, error);
    }
    const keyword = matchCategoryByKeyword(merchant, ctx.categories)?.categoryId ?? null;
    if (keyword) return { categoryId: keyword, source: 'keyword' };

    const ai = await this.categoriseWithAI(merchant, ctx);
    return ai ? { categoryId: ai, source: 'ai' } : { categoryId: null, source: 'none' };
  }

  /**
   * Haiku's pick for a payee nothing else could place. Only a confident answer naming one of the
   * household's own categories counts, and Miscellaneous is not an answer. The row still carries
   * `needs_review` and merchantHistory never counts unconfirmed rows, so a wrong guess cannot
   * outvote a correction. Skipped once the run is near its time budget.
   */
  private categoriseWithAI(merchant: string, ctx: RunContext): Promise<string | null> {
    const key = merchant.toLowerCase();
    const cached = ctx.aiCategories.get(key);
    if (cached) return cached;
    if (Date.now() - ctx.startedAtMs > AI_CATEGORY_CUTOFF_MS) return Promise.resolve(null);

    const answer = this.categorizer
      .suggestOne(merchant, ctx.categories.map((c) => ({ id: c.id, name: c.name, group_name: c.group_name })))
      .then((s) =>
        s.source === 'ai' && s.confidence !== 'low' && !s.notAnExpense && s.categoryId && s.categoryId !== ctx.miscellaneousId
          ? s.categoryId
          : null
      )
      .catch((error: unknown) => {
        this.warn('InboxAutomationService.categoriseWithAI', `AI categorisation failed for ${merchant}`, error);
        return null;
      });
    ctx.aiCategories.set(key, answer);
    return answer;
  }


  private async handleCardBill(
    item: InboxItem,
    data: InboxTransactionData,
    txnDate: string,
    classification: Extract<Classification, { kind: 'card_bill' }>,
    ctx: RunContext
  ): Promise<{ outcome: ProcessOutcome; detail: string | null }> {
    const statement = ctx.statements.find((s) => s.id === classification.statementId);
    if (!statement) throw new Error(`Statement ${classification.statementId} vanished mid-run`);
    ctx.claimedStatements.add(statement.id);
    const detail = `${statement.id}${classification.alreadyPaid ? ' (already marked paid)' : ''}`;
    if (ctx.dryRun) return { outcome: 'card_bill', detail };

    const transfer = await this.createTransfer(item, data, txnDate, {
      kind: 'card_bill',
      status: 'confirmed',
      account_id: statement.account_id,
      credit_card_statement_id: statement.id,
      note: 'Card bill payment',
    });

    // A statement marked paid by hand keeps the person's figures; only an unpaid one is settled.
    // Setting the total (not adding to it) keeps a retried run from paying twice.
    if (!classification.alreadyPaid) {
      const { error } = await this.statements.update(statement.id, {
        amount_paid: statement.statement_amount,
        payment_date: txnDate,
      });
      if (error) throw new Error(`Failed to mark statement paid: ${error.message}`);
    }

    await this.consume(item, { action: 'card_bill', statement_id: statement.id, transfer_id: transfer.id, at: ctx.now.toISOString() }, ctx);
    return { outcome: 'card_bill', detail };
  }

  private async handleTransfer(
    item: InboxItem,
    data: InboxTransactionData,
    txnDate: string,
    classification: Extract<Classification, { kind: 'transfer' }>,
    ctx: RunContext
  ): Promise<{ outcome: ProcessOutcome; detail: string | null }> {
    if (ctx.dryRun) return { outcome: 'transfer', detail: `${classification.suggestedKind}: ${classification.reason}` };

    const created = await this.createTransfer(item, data, txnDate, {
      kind: classification.suggestedKind,
      status: 'needs_review',
      account_id: classification.accountId,
      note: classification.reason,
    });

    let transfer: Transfer = created;
    // A saved rule is a decision the user already made: apply it instead of asking again —
    // except for money written into Selvam. An investment rule only prefills the account, so a
    // person sees whether the debit is a hand entry, auto-monthly row or SIP instalment already
    // on record before anything is added.
    const ruleCanApply =
      created.status === 'needs_review' && classification.ruleId !== null && classification.suggestedKind !== 'investment';
    if (ruleCanApply) {
      const applied = await this.transferService.apply(created, {
        kind: classification.suggestedKind,
        account_id: classification.accountId,
      });
      transfer = applied.transfer ?? created;
    }
    // Then whatever the evidence settles on its own — a payee that names the kind, or a SIP
    // instalment on the calendar. Only a genuine question is left for a person.
    if (transfer.status === 'needs_review') {
      transfer = (await this.transferService.autoResolve(transfer)) ?? transfer;
    }

    const needsReview = transfer.status === 'needs_review';
    await this.consume(
      item,
      { action: 'transfer', transfer_id: transfer.id, at: ctx.now.toISOString() },
      ctx,
      needsReview ? { needs_attention: true, attention_reason: 'Transfer to classify' } : { needs_attention: false, attention_reason: null }
    );
    return { outcome: 'transfer', detail: `${transfer.kind}${needsReview ? ' · needs review' : ''}` };
  }

  private async createTransfer(
    item: InboxItem,
    data: InboxTransactionData,
    txnDate: string,
    fields: Pick<Transfer, 'kind' | 'status' | 'note'> & Partial<Pick<Transfer, 'account_id' | 'credit_card_statement_id'>>
  ): Promise<Transfer> {
    try {
      return await this.transfers.create({
        inbox_item_id: item.id,
        owner: item.owner,
        date: txnDate,
        amount: data.amount,
        direction: data.direction,
        counterparty: data.merchant,
        payment_method: paymentMethodLabel(data),
        account_id: fields.account_id ?? null,
        credit_card_statement_id: fields.credit_card_statement_id ?? null,
        kind: fields.kind,
        status: fields.status,
        note: fields.note,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Already logged — by an overlapping run, or by one that timed out before
      // marking the alert. Carry on with that row so the alert gets recorded.
      const existing = await this.transfers.findByInboxItem(item.id);
      if (!existing) throw error;
      return existing;
    }
  }

  private async consume(
    item: InboxItem,
    consumed: InboxConsumed,
    ctx: RunContext,
    attention?: { needs_attention: boolean; attention_reason: string | null }
  ): Promise<void> {
    if (ctx.dryRun) return;
    await this.inbox.markConsumed(item.id, consumed, attention);
  }
}
