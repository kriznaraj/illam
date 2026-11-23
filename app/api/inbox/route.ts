import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/api/server';
import { InboxService } from '@/lib/services/InboxService';
import { parseOwner } from '@/lib/inbox/signature';
import type { InboxView } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const service = new InboxService(createServerClientFromRequest(request));
    const { searchParams } = new URL(request.url);

    const limit = searchParams.get('limit');
    const result = await service.list({
      view: (searchParams.get('view') as InboxView | null) ?? undefined,
      owner: parseOwner(searchParams.get('owner')) ?? undefined,
      before: searchParams.get('before') ?? undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch inbox';
    console.error('Error fetching inbox:', message);
    return NextResponse.json({ error: message }, { status: / must be /.test(message) ? 400 : 500 });
  }
}
