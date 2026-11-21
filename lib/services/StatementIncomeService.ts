import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, format } from 'date-fns';
import { BaseService } from './BaseService';
import { IncomeService, INCOME_KIND_LABEL } from './IncomeService';
import { TransferService } from './TransferService';
import { IncomeRepository } from '@/lib/repositories/IncomeRepository';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import { UserRepository } from '@/lib/repositories/UserRepository';
import { ownerUsername } from '@/lib/household';
import { matchStatementLines, type StatementAccountLines } from '@/lib/inbox/automation/statementNarration';
import { readIncomeLine, statementRefs } from '@/lib/cashflow/statementIncome';
import { redact, truncate } from '@/lib/inbox/text';
import { parseAppDate } from '@/lib/utils/dateUtils';
import type { IncomeKind, InboxOwner } from '@/types';

export interface StatementIncomeOutcome {
  /** New income rows written from statement lines. */
  recorded: { kind: IncomeKind; amount: number }[];
  /** Waiting Madal credits the statement showed to be income, filed as income. */
  settled: number;
}

/** How far apart a hand entry and the statement line may be dated and still be the same money. */
const HAND_ENTRY_DAYS = 3;
const shiftDays = (date: string, days: number) => format(addDays(parseAppDate(date), days), 'yyyy-MM-dd');
const cents = (value: number) => Math.round(Number(value) * 100);

/**
 * Money in, read off bank statements — the only source of income, by design. Each credit
 * `readIncomeLine` recognises becomes an `income` row keyed by its
 * statement line, so a statement read again adds nothing. A line that is already money on
 * record is left alone:
 *  - a credit Madal is waiting on is filed as income through `TransferService.apply`, which
 *    is what a person tapping "Income" would do;
 *  - a credit a person already decided (a confirmed transfer) stays as they decided;
 *  - a hand entry of the same amount within three days is the same money.
 * Best-effort per line; the statement's balances are applied whatever happens here.
 */
export class StatementIncomeService extends BaseService {
  private income: IncomeRepository;
  private incomeService: IncomeService;
  private transfers: TransferRepository;
  private transferService: TransferService;
  private users: UserRepository;

  constructor(supabase: SupabaseClient) {
    super();
    this.income = new IncomeRepository(supabase);
    this.incomeService = new IncomeService(supabase);
    this.transfers = new TransferRepository(supabase);
    this.transferService = new TransferService(supabase);
    this.users = new UserRepository(supabase);
  }

  async record(owner: InboxOwner, sourceId: string, bank: string, accounts: readonly StatementAccountLines[]): Promise<StatementIncomeOutcome> {
    const outcome: StatementIncomeOutcome = { recorded: [], settled: 0 };
    const candidates = accounts.flatMap((account) => {
      const refs = statementRefs(sourceId, account.last4, account.lines);
      return account.lines
        .map((line, index) => ({ line, ref: refs[index], reading: readIncomeLine(line) }))
        .filter((c): c is typeof c & { reading: NonNullable<typeof c.reading> } => c.reading !== null);
    });
    if (candidates.length === 0) return outcome;

    const user = await this.users.findByUsername(ownerUsername(owner));
    if (!user) throw new Error(`No user "${ownerUsername(owner)}" for inbox owner ${owner}`);

    const dates = candidates.map((c) => c.line.date).sort();
    const [done, ownTransfers, handEntries] = await Promise.all([
      this.income.findStatementRefs(candidates.map((c) => c.ref)),
      this.transfers.list({ limit: 500 }).then((all) => all.filter((t) => t.owner === owner && t.direction === 'credit')),
      this.income.findByDateRange(shiftDays(dates[0], -HAND_ENTRY_DAYS), shiftDays(dates[dates.length - 1], HAND_ENTRY_DAYS)),
    ]);
    const transferOf = new Map(matchStatementLines(ownTransfers, accounts, { includeConfirmed: true }).map((m) => [m.line, m.transfer]));
    const claimed = new Set<string>();

    for (const { line, ref, reading } of candidates) {
      if (done.has(ref)) continue;
      try {
        const transfer = transferOf.get(line);
        if (transfer) {
          if (transfer.status !== 'needs_review') continue;
          await this.transferService.apply(transfer, {
            kind: 'income',
            income_kind: reading.kind,
            source_name: reading.sourceName,
            note: truncate(`Statement: ${redact(line.narration)}`, 200),
          });
          outcome.settled += 1;
          continue;
        }

        const sameMoney = handEntries.find(
          (row) =>
            !claimed.has(row.id) &&
            row.user_id === user.id &&
            row.source !== 'statement' &&
            cents(row.amount) === cents(line.amount) &&
            Math.abs(parseAppDate(row.date).getTime() - parseAppDate(line.date).getTime()) <= HAND_ENTRY_DAYS * 86_400_000
        );
        if (sameMoney) {
          claimed.add(sameMoney.id);
          continue;
        }

        await this.incomeService.create({
          date: line.date,
          amount: line.amount,
          currency: 'INR',
          kind: reading.kind,
          source_name: reading.sourceName,
          description: truncate(redact(line.narration), 200),
          user_id: user.id,
          source: 'statement',
          statement_ref: ref,
          needs_review: false,
          note: `From the ${bank} statement`,
        });
        outcome.recorded.push({ kind: reading.kind, amount: line.amount });
      } catch (error) {
        // A duplicate key is a concurrent read of the same statement having written it first.
        if (error instanceof Error && /duplicate key/i.test(error.message)) continue;
        this.warn('StatementIncomeService.record', `${line.date} ₹${line.amount}`, error instanceof Error ? error.message : error);
      }
    }

    if (outcome.recorded.length > 0 || outcome.settled > 0) {
      this.log(
        'StatementIncomeService.record',
        `${owner} ${sourceId}: ${outcome.recorded.map((r) => `${INCOME_KIND_LABEL[r.kind]} ₹${r.amount}`).join(', ') || 'nothing new'}; ${outcome.settled} Madal credits filed as income`
      );
    }
    return outcome;
  }
}
