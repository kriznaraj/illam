import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { TransferService } from './TransferService';
import { PortfolioInvestmentService } from './PortfolioInvestmentService';
import { MadalDecisionService } from './MadalDecisionService';
import { contributionDestinations, otherMemberNames, type ContributionDestination } from '@/lib/household';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import {
  accountAliases,
  destinationAccount,
  matchStatementLines,
  readNarration,
  unalertedDebits,
  type StatementAccountLines,
} from '@/lib/inbox/automation/statementNarration';
import { redact, truncate } from '@/lib/inbox/text';
import type { InboxOwner, Transfer } from '@/types';

export interface TransferStatementOutcome {
  /** Waiting transfers a statement line was found for. */
  matched: number;
  /** Of those, confirmed by this run — from the narration, or by the usual rules once it said what they were. */
  settled: number;
  /** Contributions recorded from statement lines no alert ever reported (standing instructions). */
  recorded: number;
  /**
   * Confirmed transfers the statement proves went to the other person, though filed as something
   * else, and refiled as household transfers — with an undo record (migration 039). For
   * example, a ₹40,000 transfer filed as a brokerage deposit whose statement line prints
   * "…1303-TPT-…-K BOB". These used to wait for a person; they are now refiled automatically.
   */
  refiled: Transfer[];
  /** Contradicted transfers that could not be refiled (039 unapplied, a write failed): a person looks. */
  contradicted: Transfer[];
}

/** How far apart a hand entry and the statement line may be dated and still be the same money. */
export const CONTRIBUTION_GUARD_DAYS = 3;

const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Gives each waiting transfer what its bank statement says about it (lib/inbox/automation/
 * statementNarration.ts). Only accounts whose every line reconciled are read. A household
 * transfer is confirmed outright; any other reading becomes the transfer's suggested kind and
 * payee, and the narration its note, then `autoResolve` decides as it does for a new alert —
 * a card bill or tax settles, an investment settles only when the SIP calendar names it.
 * Best-effort per transfer: one that fails is left as it was.
 */
export class TransferStatementService extends BaseService {
  private transfers: TransferRepository;
  private transferService: TransferService;

  private investments: PortfolioInvestmentService;
  private decisions: MadalDecisionService;

  constructor(
    supabase: SupabaseClient,
    private destinations: Partial<Record<InboxOwner, Record<string, ContributionDestination>>> = contributionDestinations()
  ) {
    super();
    this.transfers = new TransferRepository(supabase);
    this.transferService = new TransferService(supabase);
    this.investments = new PortfolioInvestmentService(supabase);
    this.decisions = new MadalDecisionService(supabase);
  }

  async settleFromStatement(owner: InboxOwner, accounts: readonly StatementAccountLines[]): Promise<TransferStatementOutcome> {
    const outcome: TransferStatementOutcome = { matched: 0, settled: 0, recorded: 0, refiled: [], contradicted: [] };
    if (accounts.length === 0) return outcome;

    const waiting = (await this.transfers.list({ status: 'needs_review', limit: 200 })).filter((t) => t.owner === owner);
    const aliases = new Map(accounts.flatMap((a) => Array.from(accountAliases(a.lines).entries())));

    for (const { transfer, line } of matchStatementLines(waiting, accounts)) {
      outcome.matched += 1;
      const note = truncate(`Statement: ${redact(line.narration)}`, 200);
      const reading = readNarration(line.narration, owner, undefined, aliases);
      try {
        if (reading?.settle) {
          await this.transferService.apply(transfer, { kind: reading.kind, note });
          outcome.settled += 1;
          continue;
        }
        const patch: Partial<Transfer> = {
          note,
          ...(reading ? { kind: reading.kind } : {}),
          ...(reading?.counterparty && !transfer.counterparty ? { counterparty: reading.counterparty } : {}),
        };
        const updated = await this.transfers.update(transfer.id, patch);
        if (await this.transferService.autoResolve(updated)) outcome.settled += 1;
      } catch (error) {
        this.warn('TransferStatementService.settleFromStatement', `transfer ${transfer.id} left as it was`, error instanceof Error ? error.message : error);
      }
    }

    const all = (await this.transfers.list({ limit: 500 })).filter((t) => t.owner === owner);
    outcome.recorded = await this.recordUnalerted(owner, accounts, aliases, all);
    const contradictions = matchStatementLines(
      all.filter((t) => t.status === 'confirmed'),
      accounts,
      { includeConfirmed: true }
    ).filter(({ transfer, line }) => transfer.kind !== 'family' && readNarration(line.narration, owner, undefined, aliases)?.settle);
    for (const { transfer, line } of contradictions) {
      const narration = redact(line.narration);
      const other = otherMemberNames(owner);
      try {
        await this.decisions.refileAsFamily(transfer, {
          note: truncate(`Statement: ${narration}`, 200),
          reason: `The bank statement shows this went to ${other}, so it was refiled from ${transfer.kind.replace('_', ' ')} to a household transfer.`,
          evidence: truncate(narration, 300),
        });
        outcome.refiled.push(transfer);
      } catch (error) {
        this.warn('TransferStatementService.settleFromStatement', `could not refile transfer ${transfer.id}`, error instanceof Error ? error.message : error);
        outcome.contradicted.push(transfer);
      }
    }

    this.log(
      'TransferStatementService.settleFromStatement',
      `${owner}: ${outcome.matched} matched, ${outcome.settled} settled, ${outcome.recorded} contributions recorded, ${outcome.refiled.length} refiled`
    );
    return outcome;
  }

  /**
   * A debit into a mapped destination (the member's `contributionDestinations`) that no alert reported and no
   * contribution already records is a contribution nobody entered — recorded on the mapped
   * account. "Already records" is any row of the same amount within three days on that account
   * or the ones where a hand entry may sit; re-reading a statement therefore adds nothing twice.
   * Best-effort per line.
   */
  private async recordUnalerted(
    owner: InboxOwner,
    accounts: readonly StatementAccountLines[],
    aliases: ReadonlyMap<string, string>,
    all: readonly Transfer[]
  ): Promise<number> {
    const mapped = this.destinations[owner];
    if (!mapped) return 0;

    let recorded = 0;
    for (const line of unalertedDebits(all, accounts)) {
      const last4 = destinationAccount(line.narration);
      const destination = last4 ? mapped[last4] : undefined;
      if (!last4 || !destination) continue;
      try {
        const from = shiftDays(line.date, -CONTRIBUTION_GUARD_DAYS);
        const to = shiftDays(line.date, CONTRIBUTION_GUARD_DAYS);
        const existing = (
          await Promise.all([destination.accountId, ...destination.alsoCheck].map((id) => this.investments.listForMatching(id, from, to)))
        ).flat();
        if (existing.some((row) => Math.round(Number(row.amount) * 100) === Math.round(line.amount * 100))) continue;

        const via = /\bSI\b/.test(line.narration) ? 'Standing instruction' : 'Transfer';
        await this.investments.create({
          account_id: destination.accountId,
          investment_date: line.date,
          amount: line.amount,
          kind: 'adhoc',
          note: `${via} to ${aliases.get(last4) ?? `account ••${last4}`} (from the bank statement)`,
        });
        recorded += 1;
      } catch (error) {
        this.warn('TransferStatementService.recordUnalerted', `${line.date} ₹${line.amount}`, error instanceof Error ? error.message : error);
      }
    }
    return recorded;
  }
}
