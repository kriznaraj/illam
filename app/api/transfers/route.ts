import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { TransferService } from '@/lib/services/TransferService';
import type { TransferStatus } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const service = new TransferService(createServerClientFromRequest(request));
    const status = request.nextUrl.searchParams.get('status') as TransferStatus | null;
    const transfers = await service.list(status ?? undefined);
    return NextResponse.json(transfers, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch transfers';
    console.error('Error fetching transfers:', message);
    return NextResponse.json({ error: message }, { status: / must be /.test(message) ? 400 : 500 });
  }
}
