import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { CreditCardStatementService } from '@/lib/services/CreditCardStatementService';

export const dynamic = 'force-dynamic';

/**
 * Set a credit card's snapshot for a month from the newest statement at or before
 * the end of that month. The client used to fetch statements and post the snapshot
 * itself, which meant it both required an exact month match (so the Sync button
 * failed on the current month, where statements do not exist yet) and wrote the
 * amount unnormalised.
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
