import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { MadalDecisionRepository } from '@/lib/repositories/MadalDecisionRepository';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 100;

/** What Madal decided on its own about these alerts (`?items=id,id`), newest first. */
export async function GET(request: NextRequest) {
  try {
    const items = (new URL(request.url).searchParams.get('items') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
      .slice(0, MAX_ITEMS);
    const decisions = await new MadalDecisionRepository(createServerClientFromRequest(request)).listForItems(items);
    return NextResponse.json({ decisions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch decisions';
    console.error('Error fetching Madal decisions:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
