import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { MadalDecisionService } from '@/lib/services/MadalDecisionService';

export const dynamic = 'force-dynamic';

/** Put back what Madal decided on its own. */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const decision = await new MadalDecisionService(createServerClientFromRequest(request)).undo(params.id);
    return NextResponse.json({ decision });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to undo';
    console.error('Error undoing a Madal decision:', message);
    const status = message === 'Decision not found' ? 404 : /already undone|nothing to undo|no longer exists|no transfer|no expense|did not record/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
