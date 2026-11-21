import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { StatementCaptureService, type StatementReadOutcome } from './StatementCaptureService';
import { ExpenseService } from './ExpenseService';
import { IncomeService } from './IncomeService';
import { InboxRepository, TODO_FROM } from '@/lib/repositories/InboxRepository';
import { CreditCardStatementRepository } from '@/lib/repositories/CreditCardStatementRepository';
import { IncomeRepository } from '@/lib/repositories/IncomeRepository';
import { ExpenseRepository } from '@/lib/repositories/ExpenseRepository';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import { UserRepository } from '@/lib/repositories/UserRepository';
import { paymentMethodLabel } from '@/lib/inbox/automation/owners';
import { ownerUsername } from '@/lib/household';
import { invalidateInsightsCache } from '@/lib/cache-invalidation';
import { matchSource, senderAddress } from '@/lib/inbox/sources';
import { isSensitiveMessage } from '@/lib/inbox/guard';
import { extractMessage, EXTRACTOR_VERSION } from '@/lib/inbox/extractors';
import { evaluateAttention } from '@/lib/inbox/attention';
import { htmlToText, looksLikeHtml, redact, truncate } from '@/lib/inbox/text';
import { getTodayAppDate, toAppTimezoneDate } from '@/lib/utils/dateUtils';
import { awaitsStatement } from '@/lib/inbox/automation/statementWait';
import { findLateStatements, isStatementArrival, SELVAM_STATEMENT_SOURCES, type LateStatement } from '@/lib/inbox/statementCadence';
import type {
  IncomeKind,
  InboxIngestAttachment,
  InboxIngestMessage,
  InboxItem,
  InboxListResponse,
  InboxOwner,
  InboxStatus,
  InboxTransactionData,
  InboxView,
} from '@/types';

export const INBOX_VIEWS: readonly InboxView[] = ['todo', 'headsup', 'money', 'statements', 'all'];

/**
 * The five views Madal had before 2026-09-27, mapped onto the four it has now. A link
 * saved on /home, a bookmark, or a page served from the PWA's cache still asks for the
 * old name, and answering it with a 400 would break the inbox for as long as that cache
 * lives. `cards` and `investments` both land on `statements`: the split was 21 rows
 * against 45 and never earned a tab of its own.
 */
const VIEW_ALIASES: Readonly<Record<string, InboxView>> = {
  attention: 'todo',
  transactions: 'money',
  cards: 'statements',
  investments: 'statements',
};
export const INBOX_STATUSES: readonly InboxStatus[] = ['new', 'done', 'dismissed'];

/** Extraction only needs the top of a message; long statement footers add nothing. */
const MAX_BODY_CHARS = 20_000;
const MAX_ATTACHMENTS = 20;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const STATEMENT_HISTORY_DAYS = 180;

const GMAIL_MESSAGE_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Statements this far before the To-do cut can still be behind a bill flagged inside it. */
const STATEMENT_LOOKBACK_FROM = '2026-07-01';

const REDECIDABLE_ACTIONS: ReadonlySet<string> = new Set(['ignored', 'history_unmatched']);

export type IngestResult =
  | { status: 'stored'; item: InboxItem; statements?: StatementReadOutcome[] }
  | { status: 'ignored'; reason: 'unknown_sender' | 'sensitive' };

/** What a person asked Madal to do with one alert, from the item's own screen. */
export type RecordRequest =
  | { as: 'expense'; category_id: string; description?: string | null }
  | { as: 'income'; kind: IncomeKind; source_name?: string | null }
  | { as: 'ignore' };

export interface RecordResult {
  item: InboxItem;
  expenseId: string | null;
  incomeId: string | null;
}

export class InboxService extends BaseService {
  private repository: InboxRepository;
  private expenses: ExpenseRepository;
  private income: IncomeRepository;
  private transfers: TransferRepository;
  private users: UserRepository;
  private statements: CreditCardStatementRepository;
  private statementCapture: StatementCaptureService;

  constructor(private supabase: SupabaseClient) {
    super();
    this.repository = new InboxRepository(supabase);
    this.expenses = new ExpenseRepository(supabase);
    this.income = new IncomeRepository(supabase);
    this.transfers = new TransferRepository(supabase);
    this.users = new UserRepository(supabase);
    this.statements = new CreditCardStatementRepository(supabase);
    this.statementCapture = new StatementCaptureService(supabase);
  }

  /**
   * Turn one pushed message into an inbox item. The body is read here and
   * dropped — only the extractor's output is written.
   */
  async ingest(owner: InboxOwner, message: InboxIngestMessage, today?: string): Promise<IngestResult> {
    this.validateRequired(message as unknown as Record<string, unknown>, ['messageId', 'mailbox', 'from', 'date']);
    if (!GMAIL_MESSAGE_ID.test(message.messageId)) {
      throw new Error('messageId must be a Gmail message id');
    }
    const receivedAt = new Date(message.date);
    if (Number.isNaN(receivedAt.getTime())) {
      throw new Error('date must be a valid date');
    }

    const source = matchSource(message.from);
    if (!source) return { status: 'ignored', reason: 'unknown_sender' };

    const subject = String(message.subject ?? '');
    const rawBody = String(message.body ?? '');
    // Some senders (Groww) send HTML-only mail, which Gmail's plain body passes on as markup.
    const body = (looksLikeHtml(rawBody) ? htmlToText(rawBody) : rawBody).slice(0, MAX_BODY_CHARS);
    if (isSensitiveMessage(subject, body)) return { status: 'ignored', reason: 'sensitive' };

    const receivedDate = toAppTimezoneDate(receivedAt);
    const attachmentNames = (Array.isArray(message.attachmentNames) ? message.attachmentNames : [])
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .slice(0, MAX_ATTACHMENTS)
      .map((name) => truncate(redact(name), 120));

    const extracted = extractMessage(source, { subject, body, receivedDate, attachmentNames });
    const attention = evaluateAttention(extracted.data, receivedDate, today);

    const item = await this.repository.upsertByMessage({
      owner,
      mailbox: message.mailbox.trim().toLowerCase(),
      gmail_message_id: message.messageId,
      received_at: receivedAt.toISOString(),
      from_address: senderAddress(message.from),
      source: source.id,
      kind: extracted.kind,
      title: extracted.title,
      summary: extracted.summary,
      data: extracted.data,
      attachment_names: attachmentNames,
      needs_attention: attention.needsAttention,
      attention_reason: attention.reason,
      action_by: attention.actionBy,
      extractor: source.extractor,
      extractor_version: EXTRACTOR_VERSION,
    });

    this.log('InboxService.ingest', `stored ${source.id} ${extracted.kind}`, { id: item.id });

    // Automation that only ignored an alert or left it unmatched wrote nothing else, so a
    // re-read (an extractor fix, a moved auto-add cut) can safely let it decide again.
    if (extracted.kind === 'transaction' && item.consumed && REDECIDABLE_ACTIONS.has(item.consumed.action)) {
      await this.repository.updateItem(item.id, { consumed: null });
    }
    // A re-read can show an "alert" moved no money — ICICI's Standing Instruction reminders
    // were auto-added as expenses before extractor v3. Undo what that alone created.
    if (extracted.kind !== 'transaction' && item.consumed?.action === 'created') {
      await this.undoAutoAddedExpense(item);
    }
    // A re-read that finally names the payee. Extractor v6 reads Axis's two-column alerts, where
    // 31 of 46 had no payee at all and became expenses described "Axis Bank card ••2303 payment"
    // — nothing for the category matcher, so every one landed in Miscellaneous. The alert is
    // fixed by the upsert above, but the expense it already created is not, and `created` is not
    // a redecidable action. Drop that expense so the next process run rebuilds it with the payee,
    // and with the category this household files that payee under.
    if (extracted.kind === 'transaction' && item.consumed?.action === 'created') {
      await this.redoExpenseWithBetterPayee(item, extracted.data as InboxTransactionData);
    }

    // Statement PDFs are read in memory after the item is safely stored.
    if (source.attachments && Array.isArray(message.attachments) && message.attachments.length > 0) {
      const attachments = message.attachments
        .filter(
          (a): a is InboxIngestAttachment =>
            !!a && typeof a.name === 'string' && typeof a.contentType === 'string' && typeof a.base64 === 'string'
        )
        .slice(0, MAX_ATTACHMENTS);
      try {
        const { records } = await this.statementCapture.capture({
          owner,
          sourceId: source.id,
          inboxItemId: item.id,
          receivedDate,
          extractedData: extracted.data,
          body,
          attachments,
        });
        if (records.length > 0) return { status: 'stored', item, statements: records };
      } catch (error) {
        // A statement that cannot be read must not cost the email it came with.
        this.warn('InboxService.ingest', `statement capture failed for ${source.id}`, error instanceof Error ? error.message : error);
      }
    }

    return { status: 'stored', item };
  }

  /**
   * Re-run an auto-added expense whose alert can now be read better.
   *
   * Fires only when the re-read genuinely adds a payee the expense does not have, so an ordinary
   * re-sync — the script re-sends a 90-day window every run — changes nothing and the row does
   * not churn. Once rebuilt the two agree, so it cannot repeat.
   */
  private async redoExpenseWithBetterPayee(item: InboxItem, data: InboxTransactionData): Promise<void> {
    const merchant = data.merchant?.trim();
    if (!merchant) return;

    const expenseId = item.consumed?.expense_id;
    const expense = expenseId ? await this.expenses.findById(expenseId) : null;
    if (!expense) return;
    // Confirmed, edited into something else, or taken over — the person's now, not ours to redo.
    if (!(expense.needs_review && expense.source === 'inbox' && expense.inbox_item_id === item.id)) return;
    if ((expense.merchant ?? '').trim() === merchant) return;

    await this.expenses.delete(expense.id);
    await this.repository.updateItem(item.id, { consumed: null });
    this.log('InboxService.ingest', `re-reading ${item.id} named the payee "${merchant}"; its expense will be rebuilt`);
  }

  /** Delete the expense an item auto-added, only while it is unconfirmed and still that item's own. */
  private async undoAutoAddedExpense(item: InboxItem): Promise<void> {
    const expenseId = item.consumed?.expense_id;
    const expense = expenseId ? await this.expenses.findById(expenseId) : null;
    if (expense && !(expense.needs_review && expense.source === 'inbox' && expense.inbox_item_id === item.id)) {
      return; // confirmed, edited into something else, or taken over — the person's now
    }
    if (expense) await this.expenses.delete(expense.id);
    await this.repository.updateItem(item.id, { consumed: null });
    this.log('InboxService.ingest', `undid auto-added expense of re-read item ${item.id}`);
  }

  async list(filter: {
    view?: InboxView;
    owner?: InboxOwner;
    before?: string;
    limit?: number;
  }): Promise<InboxListResponse> {
    const requested = filter.view ?? 'all';
    const view = VIEW_ALIASES[requested] ?? requested;
    if (!INBOX_VIEWS.includes(view)) throw new Error(`view must be one of ${INBOX_VIEWS.join(', ')}`);
    if (filter.before && Number.isNaN(new Date(filter.before).getTime())) {
      throw new Error('before must be a valid date');
    }
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

    /*
     * What is open and what is already settled, from tables `inbox_items` cannot see on its
     * own: a transfer still to classify, an auto-added expense automation could not place,
     * a card statement since paid. Each outlives (or outdates) the ingest-time attention
     * flag. Resolved once and used for both the list and the count, so the badge and the
     * view can never disagree.
     */
    const work = await this.openWork();

    const [items, attentionCount] = await Promise.all([
      this.repository.list({ view, owner: filter.owner, before: filter.before, limit, ...work }),
      this.repository.countOpenWork(work, filter.owner),
    ]);

    return {
      items,
      attentionCount,
      nextCursor: items.length === limit ? items[items.length - 1].received_at : null,
    };
  }

  private async openWork(): Promise<{ openItemIds: string[]; settledItemIds: string[]; today: string }> {
    const today = getTodayAppDate();
    const [transferIds, expenseIds, settledItemIds] = await Promise.all([
      this.openTransferItemIds(today),
      this.undecidedExpenseItemIds(),
      this.paidStatementItemIds(),
    ]);
    return { openItemIds: [...transferIds, ...expenseIds], settledItemIds, today };
  }

  /*
   * All three lookups are best-effort: one that fails must not take the inbox down with it.
   * The view then shows a little less (or a paid bill a little longer), never something wrong.
   */

  private async openTransferItemIds(today: string): Promise<string[]> {
    try {
      const open = await this.transfers.list({ status: 'needs_review', limit: 500 });
      // One whose bank statement has not arrived yet is waiting on evidence, not on a person.
      return open
        .filter((transfer) => !awaitsStatement(transfer, today))
        .map((transfer) => transfer.inbox_item_id)
        .filter((id): id is string => Boolean(id));
    } catch (error) {
      this.warn('InboxService.list', 'could not read open transfers', error instanceof Error ? error.message : error);
      return [];
    }
  }

  private async undecidedExpenseItemIds(): Promise<string[]> {
    try {
      return await this.expenses.findUndecidedInboxItemIds(TODO_FROM.slice(0, 10));
    } catch (error) {
      this.warn('InboxService.list', 'could not read expenses awaiting a category', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /** "Card bill due" stays flagged until a week past the due date — paid or not. Paid drops out. */
  private async paidStatementItemIds(): Promise<string[]> {
    try {
      const flagged = await this.repository.listFlaggedStatementItems();
      if (flagged.length === 0) return [];
      const { data, error } = await this.statements.listSince(STATEMENT_LOOKBACK_FROM);
      if (error) throw new Error(error.message);
      const paid = new Set(
        (data ?? [])
          .filter((s) => Number(s.statement_amount ?? 0) > 0 && Number(s.amount_paid ?? 0) >= Number(s.statement_amount) - 0.005)
          .map((s) => String(s.id))
      );
      return flagged.filter((item) => paid.has(item.statementId)).map((item) => item.id);
    } catch (error) {
      this.warn('InboxService.list', 'could not read card statements', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Statements that stopped arriving on their usual rhythm (lib/inbox/statementCadence.ts).
   * Six months of history is enough to learn a monthly rhythm and short enough to forget
   * a source that changed.
   */
  async lateStatements(today: string = getTodayAppDate()): Promise<LateStatement[]> {
    try {
      const since = new Date(Date.parse(`${today}T00:00:00Z`) - STATEMENT_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const rows = await this.repository.listStatementArrivals(SELVAM_STATEMENT_SOURCES, since);
      return findLateStatements(
        rows
          .filter((row) => isStatementArrival(row.source, row.kind))
          .map((row) => ({ owner: row.owner, source: row.source, date: toAppTimezoneDate(new Date(row.received_at)) })),
        today
      );
    } catch (e) {
      this.handleError(e, 'find late statements');
    }
  }

  async setStatus(id: string, status: InboxStatus): Promise<InboxItem> {
    this.validateUUID(id, 'id');
    if (!INBOX_STATUSES.includes(status)) {
      throw new Error(`status must be one of ${INBOX_STATUSES.join(', ')}`);
    }
    return this.repository.update(id, { status });
  }

  /**
   * Record an alert by hand, from its own screen in Madal.
   *
   * Automation only ever acts on an alert once, and its answer sticks: a spend dated before
   * `inbox_auto_add_from` is left as `history_unmatched`, an alert read inside the 24-hour
   * grace window is skipped, and every credit was thrown away as `ignored` before migration
   * 035. There was no way back from any of those — the alert simply sat in the list with
   * nothing to press — which is what made moving one into Selavu hard. This is that way back,
   * and it works whatever automation decided.
   *
   * Idempotent: an alert that already produced a record returns it rather than making a
   * second one, so a double tap on a slow connection cannot book the same money twice.
   */
  async record(id: string, request: RecordRequest): Promise<RecordResult> {
    this.validateUUID(id, 'id');
    const item = await this.repository.findById(id);
    if (!item) throw new Error('Inbox item not found');

    const existing = await this.alreadyRecorded(item);
    if (existing) return existing;

    if (request.as === 'ignore') {
      const updated = await this.consumeAsIgnored(item, 'set aside by hand');
      return { item: updated, expenseId: null, incomeId: null };
    }

    const data = item.data as InboxTransactionData;
    if (data.kind !== 'transaction') throw new Error('Only a transaction alert can be recorded');

    // A transfer row is the other place this alert's money can be accounted for. Letting the
    // two run in parallel would record it twice, so the classify sheet owns those.
    const transfer = await this.transfers.findByInboxItem(item.id);
    if (transfer) {
      throw new Error(
        transfer.status === 'needs_review'
          ? 'This alert is waiting in the transfer sheet — classify it there'
          : 'This alert is already logged as a transfer'
      );
    }

    const date = data.txnDate ?? toAppTimezoneDate(new Date(item.received_at));
    const userId = await this.ownerUserId(item.owner);

    if (request.as === 'expense') {
      if (data.direction !== 'debit') throw new Error('Money received cannot be recorded as an expense');
      // Expenses are rupees-only — there is no currency column and no rate to invent one with.
      if (data.currency !== 'INR') throw new Error(`An expense cannot be recorded in ${data.currency}`);
      this.validateUUID(request.category_id, 'category_id');

      const expense = await new ExpenseService(this.supabase).createExpense({
        date,
        amount: data.amount,
        category_id: request.category_id,
        description: request.description?.trim() || data.merchant || `${paymentMethodLabel(data)} payment`,
        user_id: userId,
        source: 'inbox',
        inbox_item_id: item.id,
        payment_method: paymentMethodLabel(data),
        merchant: data.merchant,
        // Entered by a person, so it counts straight away.
        needs_review: false,
      });

      const updated = await this.consume(item, { action: 'created', expense_id: expense.id, at: new Date().toISOString() });
      await invalidateInsightsCache(this.supabase, date);
      return { item: updated, expenseId: expense.id, incomeId: null };
    }

    if (data.direction !== 'credit') throw new Error('Money spent cannot be recorded as income');
    const income = await new IncomeService(this.supabase).recordFromInbox({
      inbox_item_id: item.id,
      date,
      amount: data.amount,
      currency: data.currency,
      kind: request.kind,
      source_name: request.source_name?.trim() || data.merchant,
      description: item.title,
      user_id: userId,
    });

    const updated = await this.consume(item, { action: 'income', income_id: income.id, at: new Date().toISOString() });
    return { item: updated, expenseId: null, incomeId: income.id };
  }

  /** The record this alert already produced, if any — checked before writing a second one. */
  private async alreadyRecorded(item: InboxItem): Promise<RecordResult | null> {
    const expenseId = item.consumed?.expense_id ?? null;
    const incomeId = item.consumed?.income_id ?? null;
    if (!expenseId && !incomeId) return null;
    // A row deleted since releases the alert to be recorded again — "Not an expense" for a
    // spend, deleting the income row for a credit, or either removed straight from SQL.
    if (expenseId && !(await this.expenses.findById(expenseId))) return null;
    if (incomeId && !(await this.income.findById(incomeId))) return null;
    return { item, expenseId, incomeId };
  }

  private async consume(item: InboxItem, consumed: NonNullable<InboxItem['consumed']>): Promise<InboxItem> {
    await this.repository.updateConsumed(item.id, consumed, { needs_attention: false, attention_reason: null });
    return { ...item, consumed, needs_attention: false, attention_reason: null };
  }

  private async consumeAsIgnored(item: InboxItem, reason: string): Promise<InboxItem> {
    return this.consume(item, { action: 'ignored', reason, at: new Date().toISOString() });
  }

  private async ownerUserId(owner: InboxOwner): Promise<string> {
    const user = await this.users.findByUsername(ownerUsername(owner));
    if (!user) throw new Error(`No user "${ownerUsername(owner)}" for inbox owner ${owner}`);
    return user.id;
  }
}
