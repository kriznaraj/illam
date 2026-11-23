import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { InboxService } from '@/lib/services/InboxService';

export const dynamic = 'force-dynamic';

/** Statements that stopped arriving on their usual rhythm — the Net worth snapshots page shows them. */
export async function GET(request: NextRequest) {
  try {
    const late = await new InboxService(createServerClientFromRequest(request)).lateStatements();
    return NextResponse.json({ late }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check statements';
    console.error('Error checking late statements:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
