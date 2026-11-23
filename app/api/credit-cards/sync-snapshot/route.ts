import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { CreditCardStatementService } from '@/lib/services/CreditCardStatementService';

export const dynamic = 'force-dynamic';

/**
 * Set a credit card's snapshot for a month from the newest statement at or before
 * the end of that month (statements for the current month usually do not exist yet).
 * Done server-side so the liability sign is normalised in one place.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request);
    const service = new CreditCardStatementService(supabase);

    const { account_id, month } = await request.json();
    if (!month) {
      return NextResponse.json({ error: 'month is required' }, { status: 400 });
    }

    // No account_id means every active card — they are reconciled together at month
    // end, and one request beats one round trip and one re-render per card.
    const result = account_id
      ? await service.syncSnapshotForMonth(String(account_id), String(month))
      : await service.syncAllSnapshotsForMonth(String(month));

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to sync credit card snapshot' }, { status: 500 });
  }
}
