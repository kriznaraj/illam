/**
 * POST /api/portfolio/investments/recurring
 *
 * Restate an account's auto-recurring rows from a given month onwards.
 *
 * Saving `recurring_monthly_amount` on the account is not enough on its own:
 * the monthly contributions are materialised rows, and the materialiser only
 * inserts missing months. Months that already have a row — routinely including
 * future ones, because the page materialises whatever range it is asked for —
 * keep the old figure until this runs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { PortfolioInvestmentService } from '@/lib/services/PortfolioInvestmentService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new PortfolioInvestmentService(supabase);

    const body = await request.json();
    const { account_id, amount, from_month } = body ?? {};

    if (!account_id) {
      return NextResponse.json({ error: 'account_id is required' }, { status: 400 });
    }

    const result = await service.setRecurringAmountFrom({
      accountId: String(account_id),
      amount: Number(amount),
      fromMonth: String(from_month ?? ''),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update recurring amount';
    // Bad month / non-positive amount are caller errors, not server faults.
    const status = /must be|is required/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
