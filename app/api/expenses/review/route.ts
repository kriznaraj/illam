import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { ExpenseReviewService } from '@/lib/services/ExpenseReviewService';

/**
 * An expense Madal added for review, besides confirming it:
 *   GET  ?id=                              → { candidates }: expenses it may repeat
 *   POST { id, action: 'merge', into }     → merge it into an expense it repeats
 *   POST { id, action: 'dismiss' }         → remove it as not an expense
 */
export const dynamic = 'force-dynamic';

const statusFor = (message: string) =>
  /not found/i.test(message) ? 404 : /^Only |cannot|same amount|Invalid|must be|is required/i.test(message) ? 400 : 500;

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  try {
    const service = new ExpenseReviewService(createServerClientFromRequest(request));
    return NextResponse.json({ candidates: await service.duplicateCandidates(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to look for duplicates';
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function POST(request: NextRequest) {
  let body: { id?: string; action?: string; into?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const service = new ExpenseReviewService(createServerClientFromRequest(request));
    if (body.action === 'merge') {
      if (!body.into) return NextResponse.json({ error: 'into is required to merge' }, { status: 400 });
      await service.mergeInto(body.id, body.into);
    } else if (body.action === 'dismiss') {
      await service.dismiss(body.id);
    } else {
      return NextResponse.json({ error: "action must be 'merge' or 'dismiss'" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update the expense';
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
