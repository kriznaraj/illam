import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { InboxService, type RecordRequest } from '@/lib/services/InboxService';

export const dynamic = 'force-dynamic';

/**
 * Record one alert by hand: as an expense, as income, or as nothing worth keeping.
 * The way back for anything automation left alone — see `InboxService.record`.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const service = new InboxService(createServerClientFromRequest(request));
    const body = (await request.json()) as RecordRequest;
    return NextResponse.json(await service.record(params.id, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record this alert';
    console.error('Error recording inbox item:', message);
    // "not found" is a 404; the refusals above ("cannot be recorded as…", "waiting in the
    // transfer sheet") are the caller asking for something the data does not allow.
    const status = /not found/i.test(message) ? 404 : /cannot|must be|is required|waiting in|already/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
