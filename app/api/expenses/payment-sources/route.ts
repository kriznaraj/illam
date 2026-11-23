import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { PaymentSourceService } from '@/lib/services/PaymentSourceService';
import { cachedJson } from '@/lib/utils';

/**
 * The household's cards, so the expense list can name and colour a payment method:
 *   GET → { cards: [{ last4, name, color }] }
 *
 * Read from `portfolio_accounts` (Net worth), which is where the names the household uses
 * already live. Ordered oldest first, because the colours are assigned by position.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const service = new PaymentSourceService(createServerClientFromRequest(request));
    return cachedJson({ cards: await service.listCards() }, 'expenses');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load payment sources';
    console.error('Error in GET /api/expenses/payment-sources:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
