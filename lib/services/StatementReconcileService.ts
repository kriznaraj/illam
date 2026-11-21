import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, format } from 'date-fns';
import { BaseService } from './BaseService';
import { AUTO_ADD_FROM_KEY } from './InboxAutomationService';
import { CommitmentService } from './CommitmentService';
import { CommitmentRepository } from '@/lib/repositories/CommitmentRepository';
import { StatementTransactionRepository, type StatementTransactionWrite } from '@/lib/repositories/StatementTransactionRepository';
import { ExpenseRepository } from '@/lib/repositories/ExpenseRepository';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { CategoryRepository } from '@/lib/repositories/CategoryRepository';
import { UserRepository } from '@/lib/repositories/UserRepository';
import { AppConfigRepository } from '@/lib/repositories/AppConfigRepository';
import { TagRepository } from '@/lib/repositories/TagRepository';
import { ownerUsername } from '@/lib/household';
import { matchCategoryByKeyword } from '@/lib/expenses/categoryMatcher';
import { AUTO_TAG_NAME } from '@/lib/expenses/autoTag';
import {
  findLineAlert,
  matchStatementLine,
  statementDescription,
  statementMerchant,
  STATEMENT_MATCH_WINDOW_DAYS,
  type LineAlert,
  type ReconcileExpense,
} from '@/lib/statements/reconcile';
import type { CardStatementTransaction } from '@/lib/statements/cardStatements';
import { parseAppDate, toAppTimezoneDate } from '@/lib/utils/dateUtils';
import type { Expense, InboxItem, InboxOwner, InboxTransactionData, StatementTransactionStatus } from '@/types';

export type ReconcileOutcome =
  | { status: 'reconciled'; lines: number; counts: Record<StatementTransactionStatus, number> }
  | { status: 'skipped'; reason: string };

export interface ReconcileInput {
  statementId: string;
  accountId: string;
  /** Whose expenses new lines become. */
  owner: InboxOwner;
  bank: string;
  last4: string | null;
  transactions: readonly CardStatementTransaction[];
  now?: Date;
}

const shiftDays = (date: string, days: number) => format(addDays(parseAppDate(date), days), 'yyyy-MM-dd');
const isDuplicateKey = (error: unknown) => error instanceof Error && /duplicate key/i.test(error.message);
// Money a statement shows leaving that was logged as a transfer or a card bill, not spent.
const TRANSFER_ACTIONS: ReadonlySet<string> = new Set(['transfer', 'card_bill']);
// An EMI instalment's principal repays a purchase already spent (and recorded) earlier;
// its interest and GST are new charges. Seen live: "OFFUS EMI,PRIN NB:03".
const EMI_PRINCIPAL = /\bEMI\b.{0,20}\bPRIN/i;

/**
 * Reconciles a recorded card statement's lines with expenses:
 *  - a debit that an expense describes is *matched*, and fills in that expense's
 *    payment method and merchant — the statement names merchants many alerts don't;
 *  - a debit with no expense is *added* as a needs_review expense (fees included),
 *    taking over this card's alert for it if there is one, from the auto-add cut on;
 *  - before the cut it stays *unmatched*; credits, and money an alert logged as a
 *    transfer, are *ignored*.
 * A line once matched, added or ignored is final — re-sending the statement, or
 * deleting the expense it added, never adds it again.
 */
export class StatementReconcileService extends BaseService {
  private lines: StatementTransactionRepository;
  private expenses: ExpenseRepository;
  private inbox: InboxRepository;
  private categories: CategoryRepository;
  private users: UserRepository;
  private appConfig: AppConfigRepository;
  private tags: TagRepository;
  private commitmentRepo: CommitmentRepository;
  private commitments: CommitmentService;

  constructor(supabase: SupabaseClient) {
    super();
    this.lines = new StatementTransactionRepository(supabase);
    this.expenses = new ExpenseRepository(supabase);
    this.inbox = new InboxRepository(supabase);
    this.categories = new CategoryRepository(supabase);
    this.users = new UserRepository(supabase);
    this.appConfig = new AppConfigRepository(supabase);
    this.tags = new TagRepository(supabase);
    this.commitmentRepo = new CommitmentRepository(supabase);
    this.commitments = new CommitmentService(supabase);
  }

  async reconcile(input: ReconcileInput): Promise<ReconcileOutcome> {
    if (input.transactions.length === 0) return { status: 'skipped', reason: 'no transactions on the statement' };

    let existing;
    try {
      existing = await this.lines.listForStatement(input.statementId);
    } catch (error) {
      // Before migration 032 there is no table; recording the statement must not fail for it.
      return { status: 'skipped', reason: error instanceof Error ? error.message : String(error) };
    }
    const settled = new Map(existing.filter((line) => line.status !== 'unmatched').map((line) => [line.line_no, line]));

    const dates = input.transactions.map((t) => t.date).sort();
    const start = shiftDays(dates[0], -STATEMENT_MATCH_WINDOW_DAYS);
    const end = shiftDays(dates[dates.length - 1], STATEMENT_MATCH_WINDOW_DAYS);

    const [expenses, claimedByLines, alertItems, categories, configRes, user, autoTag, commitments] = await Promise.all([
      this.expenses.findReconcileCandidates(start, end),
      this.lines.listExpenseIdsBetween(shiftDays(start, -STATEMENT_MATCH_WINDOW_DAYS), shiftDays(end, STATEMENT_MATCH_WINDOW_DAYS)),
      this.inbox.listTransactionsBetween(`${shiftDays(start, -1)}T00:00:00+05:30`, `${shiftDays(end, 1)}T23:59:59+05:30`),
      this.categories.findAllSorted(),
      this.appConfig.getKeys([AUTO_ADD_FROM_KEY]),
      this.users.findByUsername(ownerUsername(input.owner)),
      // Absent until migration 036 is applied; a null simply leaves the row unlabelled.
      this.tags.findByName(AUTO_TAG_NAME).catch(() => null),
      // Best-effort: without them a premium paid by card is reconciled as before.
      this.commitmentRepo.listAll().catch(() => []),
    ]);
    if (configRes.error) throw new Error(`Failed to load app config: ${configRes.error.message}`);
    const configured = configRes.data?.find((row) => row.key === AUTO_ADD_FROM_KEY)?.value ?? null;
    const autoAddFrom = configured && /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : null;
    const miscellaneousId = categories.find((c) => c.name.toLowerCase() === 'miscellaneous')?.id ?? null;

    const linkedByAlert = new Map(
      expenses.filter((e) => e.inbox_item_id).map((e) => [e.inbox_item_id as string, e.id])
    );
    const alerts = alertItems
      .map((item) => ({ item, data: item.data as InboxTransactionData }))
      .filter(({ data }) => data.kind === 'transaction' && data.direction === 'debit' && data.currency === 'INR')
      .map(({ item, data }) => ({
        item,
        data,
        line: {
          id: item.id,
          date: data.txnDate ?? toAppTimezoneDate(new Date(item.received_at)),
          amount: data.amount,
          ofThisCard:
            data.bank !== input.bank
              ? false
              : data.last4
                ? data.last4 === input.last4
                : data.instrument === 'card'
                  ? true
                  : null,
          linkedExpenseId: linkedByAlert.get(item.id) ?? null,
          consumedAction: item.consumed?.action ?? null,
        } satisfies LineAlert,
      }));
    const alertOfThisCard = new Map(
      alerts.filter((a) => a.line.ofThisCard !== null).map((a) => [a.line.id, a.line.ofThisCard as boolean])
    );
    const alertById = new Map(alerts.map((a) => [a.line.id, a]));

    const method = [input.bank, 'card', input.last4 ? `••${input.last4}` : null].filter(Boolean).join(' ');
    const at = (input.now ?? new Date()).toISOString();
    const claimed = new Set(claimedByLines);
    const claimedAlerts = new Set<string>();
    const counts: Record<StatementTransactionStatus, number> = { matched: 0, added: 0, unmatched: 0, ignored: 0 };
    const rows: StatementTransactionWrite[] = [];

    for (let index = 0; index < input.transactions.length; index++) {
      const line = input.transactions[index];
      const lineNo = index + 1;
      const prior = settled.get(lineNo);
      const merchant = statementMerchant(line.description);
      const base = {
        statement_id: input.statementId,
        account_id: input.accountId,
        line_no: lineNo,
        txn_date: line.date,
        description: statementDescription(line.description),
        merchant,
        amount: line.amount,
        direction: line.direction,
      };
      const record = (status: StatementTransactionStatus, expenseId: string | null, alertId: string | null) => {
        rows.push({ ...base, status, expense_id: expenseId, inbox_item_id: alertId });
        counts[status] += 1;
      };

      if (prior) {
        // An expense this line added that nobody has touched is looked at again: an EMI
        // principal, or an expense the first pass could not see (the no-last-4 alerts
        // above, before they counted as unknown), makes it a duplicate.
        const own = prior.status === 'added' && prior.expense_id ? expenses.find((e) => e.id === prior.expense_id) : undefined;
        if (own && own.needs_review && own.source === 'statement') {
          if (EMI_PRINCIPAL.test(line.description)) {
            await this.expenses.delete(own.id);
            if (own.inbox_item_id) {
              await this.inbox.updateConsumed(own.inbox_item_id, { action: 'ignored', reason: 'EMI principal', at }, { needs_attention: false, attention_reason: null });
            }
            record('ignored', null, null);
            continue;
          }
          const logged = expenses.filter((e) => e.id !== own.id && e.source !== 'statement');
          const better = matchStatementLine(line, logged, { claimed, alertOfThisCard });
          if (better) {
            claimed.add(better.id);
            await this.expenses.delete(own.id);
            if (own.inbox_item_id) {
              await this.inbox.updateConsumed(own.inbox_item_id, { action: 'linked', expense_id: better.id, at }, { needs_attention: false, attention_reason: null });
            }
            await this.enrich(better, merchant, method, better.inbox_item_id ? alertById.get(better.inbox_item_id)?.item : undefined);
            record('matched', better.id, better.inbox_item_id);
            continue;
          }
        }
        counts[prior.status] += 1;
        continue;
      }

      if (line.direction === 'credit' || EMI_PRINCIPAL.test(line.description)) {
        record('ignored', null, null);
        continue;
      }

      // An insurance premium or EMI on the card is a commitment's payment, never an expense.
      const paid = await this.commitments
        .recordDebit({ text: line.description, date: line.date, amount: line.amount, source: 'statement', note: method }, commitments)
        .catch((error) => {
          this.warn('StatementReconcileService', `commitment check failed for line ${lineNo}`, error);
          return null;
        });
      if (paid) {
        record('ignored', null, null);
        continue;
      }

      const expense = matchStatementLine(line, expenses, { claimed, alertOfThisCard });
      if (expense) {
        claimed.add(expense.id);
        const alert = expense.inbox_item_id ? alertById.get(expense.inbox_item_id) : undefined;
        await this.enrich(expense, merchant, method, alert?.item);
        record('matched', expense.id, expense.inbox_item_id);
        continue;
      }

      const lineAlert = findLineAlert(line, alerts.map((a) => a.line), claimedAlerts);
      if (lineAlert) claimedAlerts.add(lineAlert.id);
      if (lineAlert?.consumedAction && TRANSFER_ACTIONS.has(lineAlert.consumedAction)) {
        record('ignored', null, lineAlert.id);
        continue;
      }

      const categoryId = matchCategoryByKeyword(merchant, categories)?.categoryId ?? miscellaneousId;
      if (!autoAddFrom || line.date < autoAddFrom || !user || !categoryId) {
        record('unmatched', null, lineAlert?.id ?? null);
        continue;
      }

      let created: Expense;
      try {
        created = await this.expenses.create({
          date: line.date,
          amount: line.amount,
          category_id: categoryId,
          description: merchant,
          user_id: user.id,
          source: 'statement',
          inbox_item_id: lineAlert?.id ?? null,
          payment_method: method,
          merchant,
          needs_review: true,
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        // Automation created an expense for the alert meanwhile; the next run matches it.
        record('unmatched', null, lineAlert?.id ?? null);
        continue;
      }

      // Provenance label, best-effort: the expense is written, and failing here would
      // re-decide the statement line on the next run over a cosmetic miss.
      if (autoTag?.id) {
        try {
          await this.expenses.linkTags(created.id, [autoTag.id]);
        } catch (error) {
          this.warn('StatementReconcileService', `could not label expense ${created.id} "${AUTO_TAG_NAME}"`, error);
        }
      }

      const alert = lineAlert ? alertById.get(lineAlert.id) : undefined;
      if (alert) {
        await this.inbox.updateConsumed(
          alert.item.id,
          { action: 'created', expense_id: created.id, at },
          { needs_attention: true, attention_reason: 'Expense added · review' }
        );
        await this.nameAlert(alert.item, merchant);
      }
      record('added', created.id, lineAlert?.id ?? null);
    }

    await this.lines.upsertMany(rows);
    return { status: 'reconciled', lines: input.transactions.length, counts };
  }

  /** Fill in what the statement knows and the expense lacks; a person's own words are kept. */
  private async enrich(expense: ReconcileExpense, merchant: string, method: string, alert: InboxItem | undefined) {
    const patch: Partial<Expense> = {};
    if (!expense.payment_method) patch.payment_method = method;
    if (!expense.merchant) patch.merchant = merchant;
    // An auto-added expense still named after how it was paid ("Axis Bank card ••2303 payment").
    if (expense.needs_review && expense.source !== 'manual' && /\bpayment$/i.test(expense.description)) {
      patch.description = merchant;
    }
    if (Object.keys(patch).length > 0) await this.expenses.update(expense.id, patch);
    if (alert) await this.nameAlert(alert, merchant);
  }

  /** An alert that said only "Payment" takes the merchant the statement names. */
  private async nameAlert(alert: InboxItem, merchant: string) {
    const data = alert.data as InboxTransactionData;
    if (data.merchant) return;
    await this.inbox.updateItem(alert.id, { title: merchant, data: { ...data, merchant } });
  }
}
