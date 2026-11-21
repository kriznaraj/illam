import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { ExpenseService } from './ExpenseService';
import { IncomeService } from './IncomeService';
import { PortfolioInvestmentService } from './PortfolioInvestmentService';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import { TransactionRuleRepository } from '@/lib/repositories/TransactionRuleRepository';
import { InboxRepository } from '@/lib/repositories/InboxRepository';
import { UserRepository } from '@/lib/repositories/UserRepository';
import { invalidateInsightsCache } from '@/lib/cache-invalidation';
import { casAccounts, ownerUsername } from '@/lib/household';
import { suggestAccount, type AccountSuggestion } from '@/lib/inbox/automation/suggestAccount';
import {
  describeSipMatch,
  matchSipAcrossAccounts,
  sipMonthsAround,
  type SipInstalmentMatch,
} from '@/lib/portfolio/sipMatch';
import {
  MANUAL_MATCH_DAYS,
  candidateMatchesLink,
  findContributionCandidates,
  findMatchingTransfer,
  monthEndDate,
  preselectCandidate,
  shiftAppDate,
  type ContributionCandidate,
  type ContributionLink,
  type SipFund,
} from '@/lib/portfolio/contributionMatch';
import type { IncomeKind, InboxOwner, Transfer, TransferKind, TransferStatus } from '@/types';

export const TRANSFER_KINDS: readonly TransferKind[] = [
  'own_account',
  'investment',
  'loan',
  'card_bill',
  'cash',
  'tax',
  'family',
  'other',
];

/**
 * Kinds the classifier only suggests when the payee names them outright (CBDT, an ATM, the
 * other person's name, a card-bill payee) — so `autoResolve` confirms them as suggested.
 * `investment` and `other` are guesses, and so is `own_account`: a transfer narrated with
 * the owner's own name reads as a self-transfer but can be a US-stock brokerage deposit.
 */
const SELF_EVIDENT_KINDS: ReadonlySet<TransferKind> = new Set(['tax', 'cash', 'family', 'card_bill']);
/** Kinds worth checking against the SIP calendar before leaving them to a person. */
const SIP_CHECKED_KINDS: ReadonlySet<TransferKind> = new Set(['investment', 'other', 'own_account']);

export interface TransferDecision {
  /**
   * A transfer kind — or 'expense', when the money was spent after all, or 'income', when a
   * credit turned out to be money earned rather than money moved (migration 035).
   */
  kind: TransferKind | 'expense' | 'income';
  account_id?: string | null;
  category_id?: string | null;
  /** For 'income': what kind of earning it was, and who paid it. */
  income_kind?: IncomeKind | null;
  source_name?: string | null;
  note?: string | null;
  /** Save a payee rule so the next alert from this payee is applied without asking. */
  remember?: boolean;
  /**
   * For an investment: the contribution already on record that this debit is — a hand entry,
   * an auto-monthly row or a SIP instalment. Absent or null records a new contribution.
   */
  link?: ContributionLink | null;
}

export interface TransferDecisionResult {
  transfer: Transfer | null;
  expenseId: string | null;
  incomeId?: string | null;
}

export interface TransferCandidates {
  suggestion: AccountSuggestion | null;
  /** The account the candidates were computed for: the one asked for, else the transfer's, else the suggestion. */
  accountId: string | null;
  candidates: ContributionCandidate[];
  preselected: ContributionCandidate | null;
}

/**
 * The transfer log. Automation creates rows from alerts; ad-hoc ones wait as
 * `needs_review` until the user says what the money was for (the rule: every
 * ad-hoc transfer is reviewed, logged and categorised).
 *
 * An investment is one money record per movement: confirming it links the contribution
 * already on record when there is one, and a retried confirm finds the row it created.
 */
/** The Selvam accounts that belong to one mailbox owner, from the CAS mapping. */
function ownerFolioAccounts(owner: InboxOwner): string[] {
  const accounts = casAccounts(owner);
  if (!accounts) return [];
  return 'folios' in accounts ? [accounts.demat, accounts.folios] : [accounts.demat, ...accounts.folioAccounts];
}

export class TransferService extends BaseService {
  private transfers: TransferRepository;
  private rules: TransactionRuleRepository;
  private inbox: InboxRepository;
  private users: UserRepository;

  constructor(private supabase: SupabaseClient) {
    super();
    this.transfers = new TransferRepository(supabase);
    this.rules = new TransactionRuleRepository(supabase);
    this.inbox = new InboxRepository(supabase);
    this.users = new UserRepository(supabase);
  }

  async list(status?: TransferStatus): Promise<Transfer[]> {
    if (status && status !== 'needs_review' && status !== 'confirmed') {
      throw new Error('status must be needs_review or confirmed');
    }
    return this.transfers.list({ status });
  }

  async confirm(id: string, decision: TransferDecision): Promise<TransferDecisionResult> {
    this.validateUUID(id, 'id');
    const transfer = await this.transfers.findById(id);
    if (!transfer) throw new Error('Transfer not found');
    if (transfer.status === 'confirmed') throw new Error('Transfer is already confirmed');

    const result = await this.apply(transfer, decision);
    if (decision.remember) await this.remember(transfer, decision);
    return result;
  }

  /**
   * Carry out a decision. Shared with automation, which applies a saved payee
   * rule's decision the same way a person's would be applied.
   */
  async apply(transfer: Transfer, decision: TransferDecision): Promise<TransferDecisionResult> {
    if (decision.kind !== 'expense' && decision.kind !== 'income' && !TRANSFER_KINDS.includes(decision.kind)) {
      throw new Error(`kind must be expense, income or one of ${TRANSFER_KINDS.join(', ')}`);
    }

    if (decision.kind === 'expense') {
      // Guarded because the two are not symmetric: money arriving can never be a spend, and
      // an expense row taken from a credit would subtract money that was added.
      if (transfer.direction === 'credit') throw new Error('A credit cannot be recorded as an expense');
      return this.applyAsExpense(transfer, decision);
    }
    if (decision.kind === 'income') {
      if (transfer.direction !== 'credit') throw new Error('Only a credit can be recorded as income');
      return this.applyAsIncome(transfer, decision);
    }

    if (decision.kind === 'investment' && !decision.account_id) {
      throw new Error('account_id is required for an investment');
    }

    let portfolioInvestmentId = transfer.portfolio_investment_id;
    let sipClaim: { sip_fund: string; sip_month: string } | null = null;
    if (decision.kind === 'investment' && decision.account_id && !portfolioInvestmentId) {
      const recorded = await this.recordInvestment(transfer, decision.account_id, decision.link ?? null);
      portfolioInvestmentId = recorded.investmentId;
      sipClaim = recorded.sipClaim;
    }

    let updated: Transfer;
    try {
      updated = await this.transfers.update(transfer.id, {
        kind: decision.kind,
        account_id: decision.account_id ?? transfer.account_id ?? null,
        portfolio_investment_id: portfolioInvestmentId ?? null,
        note: decision.note ?? transfer.note,
        status: 'confirmed',
        ...(sipClaim ?? {}),
      });
    } catch (error) {
      if (sipClaim && /duplicate key|unique/i.test(error instanceof Error ? error.message : '')) {
        throw new Error('That SIP instalment is already claimed by another transfer');
      }
      throw error;
    }

    if (transfer.inbox_item_id) await this.inbox.clearAttention(transfer.inbox_item_id);
    return { transfer: updated, expenseId: null, incomeId: null };
  }

  /**
   * Settle a transfer without asking, when the evidence leaves nothing to decide. Returns the
   * confirmed row, or null when a person still has to look.
   *
   * "Transfers are always reviewed" was the original rule; it was relaxed because confirming
   * every email is not realistic — only conflicts need review. So two cases settle here:
   *
   * - **The payee says what it is.** CBDT is tax, HDFC ATM is cash, the other person's name
   *   is a family transfer, a card-bill payee is a card bill. The classifier already
   *   read the payee to suggest the kind; the sheet only ever asked the person to agree.
   * - **The SIP calendar names the instalment.** A debit matching a declared SIP — fund, amount
   *   and day, nearest due date, owner breaking a tie — is that instalment, and claiming it is
   *   exactly what a person would pick on the sheet (a month of SIP debits typically matches
   *   the declared funds one-for-one). `matchSipAcrossAccounts` returns null on a genuine tie, and
   *   that stays a question.
   *
   * Everything else stays `needs_review`: a merchant-less NEFT with no SIP behind it, money
   * received, and an investment payee with no instalment — the suggestion for those comes from
   * history, and a confident wrong account is what causes mis-filing.
   *
   * Best-effort: any failure leaves the transfer waiting, which is what it did before.
   */
  async autoResolve(transfer: Transfer): Promise<Transfer | null> {
    if (transfer.status !== 'needs_review' || transfer.direction !== 'debit') return null;
    try {
      if (SELF_EVIDENT_KINDS.has(transfer.kind)) {
        const { transfer: applied } = await this.apply(transfer, { kind: transfer.kind, account_id: transfer.account_id });
        return applied;
      }

      if (!SIP_CHECKED_KINDS.has(transfer.kind)) return null;
      const sip = await this.matchSipSchedule(transfer);
      if (!sip) return null;
      const candidates = await this.findCandidates(transfer, sip.accountId);
      const instalment = candidates.find((c) => c.kind === 'sip' && c.fund === sip.fund && c.month === sip.month);
      if (!instalment) return null;

      const { transfer: applied } = await this.apply(transfer, {
        kind: 'investment',
        account_id: sip.accountId,
        link: { kind: 'sip', fund: sip.fund, month: sip.month },
        note: describeSipMatch(sip),
      });
      return applied;
    } catch (error) {
      this.warn('TransferService.autoResolve', `left ${transfer.id} for review`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * What an investment transfer might already be on record as, on `accountId` (or the account
   * the transfer carries, or the one suggested from earlier transfers).
   */
  async candidates(id: string, accountId?: string | null): Promise<TransferCandidates> {
    this.validateUUID(id, 'id');
    if (accountId) this.validateUUID(accountId, 'account_id');
    const transfer = await this.transfers.findById(id);
    if (!transfer) throw new Error('Transfer not found');

    /*
     * The SIP calendar is asked first, and it outranks history. A SIP is a declaration —
     * this fund, this amount, this day — while `suggestAccount` only infers from what a
     * similar amount was filed as before, which is an inference that learns from its own
     * mistakes: if one ₹10,000 instalment is filed to a brokerage wallet, the next ones follow
     * it there, and each wrong answer makes the next more confident. See lib/portfolio/sipMatch.ts.
     */
    const sipMatch = await this.matchSipSchedule(transfer);
    const confirmed = await this.transfers.listInvestmentTransfers({ limit: 200 });
    const suggestion = sipMatch
      ? { accountId: sipMatch.accountId, reason: describeSipMatch(sipMatch) }
      : suggestAccount(transfer, confirmed);

    const account = accountId || transfer.account_id || suggestion?.accountId || null;
    const candidates = account && !transfer.portfolio_investment_id ? await this.findCandidates(transfer, account) : [];

    // The matched instalment is preselected even beside other candidates: a mandate on a
    // known date is better evidence than a hand entry that happens to be the same size.
    const matched =
      sipMatch && account === sipMatch.accountId
        ? candidates.find((c) => c.kind === 'sip' && c.fund === sipMatch.fund && c.month === sipMatch.month) ?? null
        : null;

    return { suggestion, accountId: account, candidates, preselected: matched ?? preselectCandidate(candidates) };
  }

  /**
   * Which SIP instalment, if any, this debit is — scanned across every account that runs
   * SIPs. Best-effort: the sheet still works from history if the schedules cannot be read.
   */
  private async matchSipSchedule(transfer: Transfer): Promise<SipInstalmentMatch | null> {
    if (transfer.portfolio_investment_id) return null;
    try {
      const months = sipMonthsAround(transfer.date);
      const [accounts, claimedSips] = await Promise.all([
        new PortfolioInvestmentService(this.supabase).sipSchedules(),
        this.transfers.listSipClaimsEverywhere(months, transfer.id),
      ]);
      return matchSipAcrossAccounts({
        date: transfer.date,
        amount: Number(transfer.amount),
        accounts,
        claimedSips,
        // The same ₹2,500 SIP on the 15th can run under both people's accounts; whose
        // bank account was debited is what tells them apart. the CAS mapping already
        // records each owner's demat and folio accounts, so there is nothing new to maintain.
        preferAccountIds: ownerFolioAccounts(transfer.owner),
      });
    } catch (error) {
      this.warn('TransferService.candidates', 'SIP schedule scan failed', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * The confirmed investment transfer a hand-entered contribution would duplicate — checked
   * before /portfolio/investments adds a row, so a deposit recorded from its bank debit is
   * not typed in a second time.
   */
  async findRecordedTransfer(accountId: string, date: string, amount: number): Promise<Transfer | null> {
    const nearby = await this.transfers.listInvestmentTransfers({
      accountId,
      from: shiftAppDate(date, -MANUAL_MATCH_DAYS),
      to: shiftAppDate(date, MANUAL_MATCH_DAYS),
    });
    return findMatchingTransfer(date, amount, nearby);
  }

  private async findCandidates(transfer: Transfer, accountId: string): Promise<ContributionCandidate[]> {
    const investments = new PortfolioInvestmentService(this.supabase);
    const month = transfer.date.slice(0, 7);
    const aroundFrom = shiftAppDate(transfer.date, -MANUAL_MATCH_DAYS);
    const aroundTo = shiftAppDate(transfer.date, MANUAL_MATCH_DAYS);
    const monthStart = `${month}-01`;
    const monthEnd = monthEndDate(month);

    const [rows, linkedIds, claimedSips, funds] = await Promise.all([
      investments.listForMatching(accountId, aroundFrom < monthStart ? aroundFrom : monthStart, aroundTo > monthEnd ? aroundTo : monthEnd),
      this.transfers.listLinkedInvestmentIds(),
      // The same months `findSipInstalments` looks at, or an instalment already taken in a
      // neighbouring month would be offered a second time.
      this.transfers.listSipClaims(accountId, sipMonthsAround(transfer.date), transfer.id),
      investments.sipFunds(accountId),
    ]);

    return findContributionCandidates({
      date: transfer.date,
      amount: Number(transfer.amount),
      // A row a transfer points at is taken even before migration 034 records it on the row.
      rows: rows.map((row) => ({ ...row, transfer_id: row.transfer_id ?? (linkedIds.has(row.id) ? 'linked' : null) })),
      funds: funds as SipFund[],
      claimedSips,
    });
  }

  private async recordInvestment(
    transfer: Transfer,
    accountId: string,
    link: ContributionLink | null
  ): Promise<{ investmentId: string | null; sipClaim: { sip_fund: string; sip_month: string } | null }> {
    const investments = new PortfolioInvestmentService(this.supabase);

    if (link) {
      // Checked against the candidates computed here, never trusted from the client.
      const allowed = await this.findCandidates(transfer, accountId);
      const match = allowed.find((candidate) => candidateMatchesLink(candidate, link));
      if (!match) throw new Error("link must be one of this transfer's candidate contributions");
      if (match.kind === 'sip') return { investmentId: null, sipClaim: { sip_fund: match.fund, sip_month: match.month } };
      const linked = await investments.linkToTransfer(match.rowId, transfer.id, accountId);
      return { investmentId: linked.id, sipClaim: null };
    }

    // A retried confirm — or one cut off between this insert and the transfer update — finds its own row.
    const existing = await investments.findByTransfer(transfer.id);
    if (existing) return { investmentId: existing.id, sipClaim: null };

    const created = await investments.create({
      account_id: accountId,
      investment_date: transfer.date,
      amount: Number(transfer.amount),
      kind: 'adhoc',
      note: [transfer.counterparty, transfer.payment_method].filter(Boolean).join(' · ') || null,
      transfer_id: transfer.id,
    });
    return { investmentId: created.id, sipClaim: null };
  }

  private async applyAsExpense(transfer: Transfer, decision: TransferDecision): Promise<TransferDecisionResult> {
    if (!decision.category_id) throw new Error('category_id is required for an expense');

    const expense = await new ExpenseService(this.supabase).createExpense({
      date: transfer.date,
      amount: Number(transfer.amount),
      category_id: decision.category_id,
      description: transfer.counterparty ?? `${transfer.payment_method ?? 'Bank'} payment`,
      user_id: await this.ownerUserId(transfer.owner),
      source: 'inbox',
      inbox_item_id: transfer.inbox_item_id,
      payment_method: transfer.payment_method,
      merchant: transfer.counterparty,
      needs_review: false,
    });

    // It was never a transfer: drop the log row and record the expense on the alert.
    await this.transfers.delete(transfer.id);
    if (transfer.inbox_item_id) {
      await this.inbox.updateConsumed(
        transfer.inbox_item_id,
        { action: 'created', expense_id: expense.id, at: new Date().toISOString() },
        { needs_attention: false, attention_reason: null }
      );
    }
    await invalidateInsightsCache(this.supabase, transfer.date);
    return { transfer: null, expenseId: expense.id, incomeId: null };
  }

  /**
   * A credit the user says was earned. Like `applyAsExpense`, the transfer row goes away: the
   * money was not moved between the household's own pots, so there is nothing to keep in the
   * transfer log, and leaving a row behind would show the same ₹ twice in Madal.
   */
  private async applyAsIncome(transfer: Transfer, decision: TransferDecision): Promise<TransferDecisionResult> {
    const kind = decision.income_kind ?? 'other';

    const income = await new IncomeService(this.supabase).create({
      date: transfer.date,
      amount: Number(transfer.amount),
      currency: 'INR',
      kind,
      source_name: decision.source_name ?? transfer.counterparty,
      description: transfer.counterparty ?? `${transfer.payment_method ?? 'Bank'} credit`,
      user_id: await this.ownerUserId(transfer.owner),
      inbox_item_id: transfer.inbox_item_id,
      source: 'inbox',
      needs_review: false,
      note: decision.note ?? transfer.note,
    });

    await this.transfers.delete(transfer.id);
    if (transfer.inbox_item_id) {
      await this.inbox.updateConsumed(
        transfer.inbox_item_id,
        { action: 'income', income_id: income.id, at: new Date().toISOString() },
        { needs_attention: false, attention_reason: null }
      );
    }
    return { transfer: null, expenseId: null, incomeId: income.id };
  }

  private async remember(transfer: Transfer, decision: TransferDecision): Promise<void> {
    // A merchant-less alert ("Payment") has nothing stable to match next time.
    const payee = transfer.counterparty?.trim().toLowerCase();
    if (!payee) return;

    // Income is deliberately not remembered: a payee that once sent earnings may next send a
    // refund, and a rule would book it without anyone looking.
    if (decision.kind === 'income') return;

    const isExpense = decision.kind === 'expense';
    await this.rules.create({
      owner: transfer.owner,
      match_counterparty: payee,
      match_payment_method: null,
      action: isExpense ? 'expense' : 'transfer',
      category_id: isExpense ? decision.category_id ?? null : null,
      transfer_kind: isExpense ? null : (decision.kind as TransferKind),
      account_id: isExpense ? null : decision.account_id ?? null,
    });
  }

  private async ownerUserId(owner: InboxOwner): Promise<string> {
    const user = await this.users.findByUsername(ownerUsername(owner));
    if (!user) throw new Error(`No user "${ownerUsername(owner)}" for inbox owner ${owner}`);
    return user.id;
  }
}
