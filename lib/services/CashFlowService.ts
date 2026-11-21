import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './BaseService';
import { PortfolioInvestmentService } from './PortfolioInvestmentService';
import { CommitmentPaymentRepository, CommitmentRepository } from '@/lib/repositories/CommitmentRepository';
import { ExpenseRepository } from '@/lib/repositories/ExpenseRepository';
import { IncomeRepository } from '@/lib/repositories/IncomeRepository';
import { TransferRepository } from '@/lib/repositories/TransferRepository';
import { buildCashFlow } from '@/lib/cashflow/buildCashFlow';
import { instalments } from '@/lib/cashflow/commitments';
import { daysFromTodayApp, getTodayAppDate, monthKeys } from '@/lib/utils/dateUtils';
import type { CashFlowReport } from '@/types';

/** A financial year is the longest view; two keeps a comparison possible without unbounded reads. */
const MAX_MONTHS = 24;
const UPCOMING_DAYS = 90;

const monthEnd = (month: string) => {
  const [year, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/**
 * The cash-flow report behind /cash-flow: fetches every source once and leaves what counts
 * to `buildCashFlow` (lib/cashflow/buildCashFlow.ts). A range running past the current month
 * stops at it — the report is of money that moved, and commitments still to come are listed
 * under `upcoming` instead.
 */
export class CashFlowService extends BaseService {
  private income: IncomeRepository;
  private expenses: ExpenseRepository;
  private transfers: TransferRepository;
  private commitments: CommitmentRepository;
  private payments: CommitmentPaymentRepository;
  private investments: PortfolioInvestmentService;

  constructor(supabase: SupabaseClient) {
    super();
    this.income = new IncomeRepository(supabase);
    this.expenses = new ExpenseRepository(supabase);
    this.transfers = new TransferRepository(supabase);
    this.commitments = new CommitmentRepository(supabase);
    this.payments = new CommitmentPaymentRepository(supabase);
    this.investments = new PortfolioInvestmentService(supabase);
  }

  async build(from: string, to: string): Promise<CashFlowReport> {
    if (!monthKeys.isValid(from) || !monthKeys.isValid(to)) throw new Error('from and to must be yyyy-MM');
    if (from > to) throw new Error('from must be on or before to');

    const currentMonth = monthKeys.current();
    const today = getTodayAppDate();
    const end = to > currentMonth ? currentMonth : to;
    if (from > end) throw new Error('from must not be in the future');
    let span = 1;
    for (let m = from; m < end; m = monthKeys.shift(m, 1)) span += 1;
    if (span > MAX_MONTHS) throw new Error(`the range must be at most ${MAX_MONTHS} months`);

    const upcomingTo = monthKeys.shift(currentMonth, 3);
    const [income, expenses, transfers, commitments, payments, contributions] = await Promise.all([
      this.income.findByDateRange(`${from}-01`, monthEnd(end)),
      this.expenses.findAmountsByDateRange(`${from}-01`, monthEnd(end)),
      this.transfers.listBetween(`${from}-01`, monthEnd(end)),
      this.commitments.listAll(),
      this.payments.listBetween(from < currentMonth ? from : currentMonth, upcomingTo),
      this.investments.contributionsByMonth(from, end),
    ]);

    return buildCashFlow({
      from,
      to: end,
      income,
      expenses,
      instalments: instalments(commitments, payments, from, end, today),
      upcoming: instalments(commitments, payments, currentMonth, upcomingTo, today).filter(
        (i) => i.status === 'upcoming' && daysFromTodayApp(i.dueDate) <= UPCOMING_DAYS
      ),
      contributions,
      transfers,
      claimedTransferIds: new Set(payments.map((p) => p.transfer_id).filter((id): id is string => !!id)),
      currentMonth,
    });
  }
}
